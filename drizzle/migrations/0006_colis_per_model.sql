CREATE OR REPLACE FUNCTION public.create_order_colis(_order_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_cat text; v_struct text; v_barcode text; v_gc text; v_order_number text; v_base text; v_model uuid;
  r RECORD; c RECORD; v_coli_id uuid; v_route_id uuid;
  v_created int := 0; v_stages_added int := 0;
  v_route_found boolean := false; v_route_empty boolean := false; v_inserted int;
  v_stages public.production_stage[] := ARRAY['estrutura','corte','costura','branco','estofagem','qualidade','embalagem','picagem']::public.production_stage[];
  st public.production_stage;
BEGIN
  SELECT barcode, gc_code, order_number, model_id INTO v_barcode, v_gc, v_order_number, v_model
    FROM public.production_orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Encomenda não encontrada'; END IF;
  v_base := COALESCE(NULLIF(upper(btrim(v_gc)), ''), NULLIF(btrim(v_barcode), ''), v_order_number);
  IF v_base IS NULL OR v_base = '' THEN
    RAISE EXCEPTION 'Não foi possível criar volumes: encomenda sem código nem número';
  END IF;
  SELECT category_code, structure_code INTO v_cat, v_struct FROM public.get_order_route_keys(_order_id);

  FOR r IN
    SELECT * FROM (
      SELECT DISTINCT ON (mp.package_number) NULL::uuid AS id, mp.package_number AS coli_number, mp.package_name AS coli_name
        FROM public.model_packages mp WHERE v_model IS NOT NULL AND mp.model_id = v_model
       ORDER BY mp.package_number, mp.updated_at DESC
    ) mp
    UNION ALL
    SELECT scr.id, scr.coli_number, scr.coli_name FROM public.structure_coli_routes scr
     WHERE scr.category_code = v_cat AND scr.structure_code = v_struct
       AND NOT EXISTS (SELECT 1 FROM public.model_packages x WHERE v_model IS NOT NULL AND x.model_id = v_model)
    ORDER BY 2
  LOOP
    v_route_found := true;
    v_route_id := r.id;
    IF v_route_id IS NULL THEN
      SELECT scr.id INTO v_route_id FROM public.structure_coli_routes scr
       WHERE scr.category_code = v_cat AND scr.structure_code = v_struct AND scr.coli_number = r.coli_number;
    END IF;
    SELECT id INTO v_coli_id FROM public.order_colis WHERE order_id = _order_id AND coli_number = r.coli_number;
    IF v_coli_id IS NULL THEN
      INSERT INTO public.order_colis(order_id, coli_number, coli_name, coli_barcode)
      VALUES (_order_id, r.coli_number, r.coli_name, v_base || '-C' || r.coli_number)
      ON CONFLICT (order_id, coli_number) DO NOTHING RETURNING id INTO v_coli_id;
      IF v_coli_id IS NULL THEN
        SELECT id INTO v_coli_id FROM public.order_colis WHERE order_id = _order_id AND coli_number = r.coli_number;
      ELSE v_created := v_created + 1; END IF;
    END IF;
    IF v_route_id IS NOT NULL THEN
      INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage)
      SELECT v_coli_id, _order_id, scs.stage FROM public.structure_coli_stages scs
       WHERE scs.route_id = v_route_id AND scs.included = true
      ON CONFLICT (order_coli_id, stage) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT; v_stages_added := v_stages_added + v_inserted;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.order_coli_stages WHERE order_coli_id = v_coli_id) THEN
      v_route_empty := true;
      FOREACH st IN ARRAY v_stages LOOP
        INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage) VALUES (v_coli_id, _order_id, st)
        ON CONFLICT (order_coli_id, stage) DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT; v_stages_added := v_stages_added + v_inserted;
      END LOOP;
    END IF;
  END LOOP;

  IF NOT v_route_found THEN
    SELECT id INTO v_coli_id FROM public.order_colis WHERE order_id = _order_id AND coli_number = 1;
    IF v_coli_id IS NULL THEN
      INSERT INTO public.order_colis(order_id, coli_number, coli_name, coli_barcode)
      VALUES (_order_id, 1, 'Produto completo', v_base)
      ON CONFLICT (order_id, coli_number) DO NOTHING RETURNING id INTO v_coli_id;
      IF v_coli_id IS NULL THEN
        SELECT id INTO v_coli_id FROM public.order_colis WHERE order_id = _order_id AND coli_number = 1;
      ELSE v_created := v_created + 1; END IF;
    END IF;
    FOREACH st IN ARRAY v_stages LOOP
      INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage) VALUES (v_coli_id, _order_id, st)
      ON CONFLICT (order_coli_id, stage) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT; v_stages_added := v_stages_added + v_inserted;
    END LOOP;
  END IF;

  FOR c IN SELECT oc.id FROM public.order_colis oc WHERE oc.order_id = _order_id
       AND NOT EXISTS (SELECT 1 FROM public.order_coli_stages s WHERE s.order_coli_id = oc.id)
  LOOP
    v_route_empty := true;
    FOREACH st IN ARRAY v_stages LOOP
      INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage) VALUES (c.id, _order_id, st)
      ON CONFLICT (order_coli_id, stage) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT; v_stages_added := v_stages_added + v_inserted;
    END LOOP;
  END LOOP;

  IF v_created > 0 THEN PERFORM public.refresh_order_coli_barcodes(_order_id); END IF;
  RETURN jsonb_build_object('ok', true, 'created', v_created, 'stages_added', v_stages_added,
    'route_found', v_route_found, 'route_without_stages', v_route_empty);
END;
$function$;