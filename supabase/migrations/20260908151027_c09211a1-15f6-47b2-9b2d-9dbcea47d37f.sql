CREATE OR REPLACE FUNCTION public.create_order_colis(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cat text; v_struct text;
  v_barcode text;
  v_order_number text;
  v_base text;
  r RECORD;
  c RECORD;
  v_coli_id uuid;
  v_created int := 0;
  v_stages_added int := 0;
  v_route_found boolean := false;
  v_route_empty boolean := false;
  v_inserted int;
  v_stages public.production_stage[] := ARRAY[
    'estrutura','corte','costura','branco','estofagem','qualidade','embalagem','picagem'
  ]::public.production_stage[];
  st public.production_stage;
BEGIN
  SELECT barcode, order_number INTO v_barcode, v_order_number
    FROM public.production_orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Encomenda não encontrada';
  END IF;

  v_base := COALESCE(NULLIF(btrim(v_barcode), ''), v_order_number);
  IF v_base IS NULL OR v_base = '' THEN
    RAISE EXCEPTION 'Não foi possível criar volumes: encomenda sem código nem número';
  END IF;

  SELECT category_code, structure_code INTO v_cat, v_struct
    FROM public.get_order_route_keys(_order_id);

  -- 1) Garantir um volume por cada volume configurado na rota (sem apagar nada)
  FOR r IN
    SELECT id, coli_number, coli_name
      FROM public.structure_coli_routes
     WHERE category_code = v_cat AND structure_code = v_struct
     ORDER BY coli_number
  LOOP
    v_route_found := true;

    SELECT id INTO v_coli_id
      FROM public.order_colis
     WHERE order_id = _order_id AND coli_number = r.coli_number;

    IF v_coli_id IS NULL THEN
      INSERT INTO public.order_colis(order_id, coli_number, coli_name, coli_barcode)
      VALUES (_order_id, r.coli_number, r.coli_name, v_base || '-C' || r.coli_number)
      ON CONFLICT (order_id, coli_number) DO NOTHING
      RETURNING id INTO v_coli_id;

      IF v_coli_id IS NULL THEN
        SELECT id INTO v_coli_id FROM public.order_colis
         WHERE order_id = _order_id AND coli_number = r.coli_number;
      ELSE
        v_created := v_created + 1;
      END IF;
    END IF;

    -- 2) Garantir etapas do volume (só acrescenta as que faltam)
    INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage)
    SELECT v_coli_id, _order_id, scs.stage
      FROM public.structure_coli_stages scs
     WHERE scs.route_id = r.id AND scs.included = true
    ON CONFLICT (order_coli_id, stage) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_stages_added := v_stages_added + v_inserted;

    IF NOT EXISTS (SELECT 1 FROM public.order_coli_stages WHERE order_coli_id = v_coli_id) THEN
      -- configuração da rota vazia: usar rota completa e assinalar a falta
      v_route_empty := true;
      FOREACH st IN ARRAY v_stages LOOP
        INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage)
        VALUES (v_coli_id, _order_id, st)
        ON CONFLICT (order_coli_id, stage) DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        v_stages_added := v_stages_added + v_inserted;
      END LOOP;
    END IF;
  END LOOP;

  -- 3) Sem rota configurada: um volume único com a rota completa
  IF NOT v_route_found THEN
    SELECT id INTO v_coli_id FROM public.order_colis
     WHERE order_id = _order_id AND coli_number = 1;

    IF v_coli_id IS NULL THEN
      INSERT INTO public.order_colis(order_id, coli_number, coli_name, coli_barcode)
      VALUES (_order_id, 1, 'Produto completo', v_base || '-C1')
      ON CONFLICT (order_id, coli_number) DO NOTHING
      RETURNING id INTO v_coli_id;
      IF v_coli_id IS NULL THEN
        SELECT id INTO v_coli_id FROM public.order_colis
         WHERE order_id = _order_id AND coli_number = 1;
      ELSE
        v_created := v_created + 1;
      END IF;
    END IF;

    FOREACH st IN ARRAY v_stages LOOP
      INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage)
      VALUES (v_coli_id, _order_id, st)
      ON CONFLICT (order_coli_id, stage) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_stages_added := v_stages_added + v_inserted;
    END LOOP;
  END IF;

  -- 4) Volumes existentes fora da rota que ficaram sem etapas
  FOR c IN
    SELECT oc.id FROM public.order_colis oc
     WHERE oc.order_id = _order_id
       AND NOT EXISTS (SELECT 1 FROM public.order_coli_stages s WHERE s.order_coli_id = oc.id)
  LOOP
    v_route_empty := true;
    FOREACH st IN ARRAY v_stages LOOP
      INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage)
      VALUES (c.id, _order_id, st)
      ON CONFLICT (order_coli_id, stage) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_stages_added := v_stages_added + v_inserted;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'created', v_created,
    'stages_added', v_stages_added,
    'route_found', v_route_found,
    'route_without_stages', v_route_empty
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_order_colis(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_order_colis(uuid) FROM authenticated;