CREATE OR REPLACE FUNCTION public.get_order_progress(_order_number text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.production_orders%ROWTYPE;
  v_stages jsonb;
  v_current jsonb;
BEGIN
  SELECT * INTO v_order FROM public.production_orders WHERE order_number = _order_number;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Encomenda % nao encontrada', _order_number USING ERRCODE = 'P0002';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'stage', s.stage,
    'status', s.status,
    'started_at', s.started_at,
    'finished_at', s.finished_at
  ) ORDER BY public.stage_order_index(s.stage))
  INTO v_stages
  FROM public.order_stages s
  WHERE s.order_id = v_order.id;

  SELECT jsonb_build_object('stage', s.stage, 'status', s.status)
  INTO v_current
  FROM public.order_stages s
  WHERE s.order_id = v_order.id
    AND s.status IN ('em_curso','bloqueada')
  ORDER BY public.stage_order_index(s.stage)
  LIMIT 1;

  RETURN jsonb_build_object(
    'order_number', v_order.order_number,
    'status', v_order.status,
    'product_description', v_order.product_description,
    'structure_type', v_order.structure_type,
    'measure', v_order.measure,
    'color', v_order.color,
    'current_stage', v_current,
    'stages', COALESCE(v_stages, '[]'::jsonb)
  );
END;
$$;