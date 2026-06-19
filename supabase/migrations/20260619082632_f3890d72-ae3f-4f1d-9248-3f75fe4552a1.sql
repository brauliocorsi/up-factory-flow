
-- 1) Backfill existing NULL coli_barcode
UPDATE public.order_colis oc
SET coli_barcode = COALESCE(NULLIF(btrim(po.barcode), ''), po.order_number) || '-C' || oc.coli_number
FROM public.production_orders po
WHERE oc.order_id = po.id
  AND oc.coli_barcode IS NULL;

-- 2) Enforce NOT NULL going forward
ALTER TABLE public.order_colis ALTER COLUMN coli_barcode SET NOT NULL;

-- 3) Recreate create_order_colis with non-null barcode generation
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
  v_coli_id uuid;
  v_created int := 0;
  v_route_found boolean := false;
  v_stages public.production_stage[] := ARRAY[
    'estrutura','corte','costura','branco','estofagem','qualidade','embalagem','picagem'
  ]::public.production_stage[];
  st public.production_stage;
BEGIN
  IF EXISTS (SELECT 1 FROM public.order_colis WHERE order_id = _order_id) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true);
  END IF;

  SELECT barcode, order_number INTO v_barcode, v_order_number
    FROM public.production_orders WHERE id = _order_id;

  v_base := COALESCE(NULLIF(btrim(v_barcode), ''), v_order_number);
  IF v_base IS NULL OR v_base = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Encomenda sem barcode nem order_number');
  END IF;

  SELECT category_code, structure_code INTO v_cat, v_struct
    FROM public.get_order_route_keys(_order_id);

  FOR r IN
    SELECT id, coli_number, coli_name
      FROM public.structure_coli_routes
     WHERE category_code = v_cat AND structure_code = v_struct
     ORDER BY coli_number
  LOOP
    v_route_found := true;
    INSERT INTO public.order_colis(order_id, coli_number, coli_name, coli_barcode)
    VALUES (_order_id, r.coli_number, r.coli_name, v_base || '-C' || r.coli_number)
    RETURNING id INTO v_coli_id;

    INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage)
    SELECT v_coli_id, _order_id, scs.stage
      FROM public.structure_coli_stages scs
     WHERE scs.route_id = r.id AND scs.included = true;

    v_created := v_created + 1;
  END LOOP;

  IF NOT v_route_found THEN
    INSERT INTO public.order_colis(order_id, coli_number, coli_name, coli_barcode)
    VALUES (_order_id, 1, 'Produto completo', v_base || '-C1')
    RETURNING id INTO v_coli_id;
    FOREACH st IN ARRAY v_stages LOOP
      INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage)
      VALUES (v_coli_id, _order_id, st);
    END LOOP;
    v_created := 1;
  END IF;

  RETURN jsonb_build_object('ok', true, 'created', v_created, 'route_found', v_route_found);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;
