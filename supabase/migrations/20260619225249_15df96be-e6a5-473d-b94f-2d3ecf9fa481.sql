
ALTER TABLE public.production_orders ADD COLUMN IF NOT EXISTS customer_order text;
CREATE INDEX IF NOT EXISTS idx_production_orders_customer_order ON public.production_orders(customer_order);
ALTER TABLE public.production_orders ALTER COLUMN entry_date DROP NOT NULL;

DROP FUNCTION IF EXISTS public.get_order_progress(text);

CREATE OR REPLACE FUNCTION public.get_order_progress(_query text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_items jsonb;
  v_first public.production_orders%ROWTYPE;
BEGIN
  SELECT array_agg(id) INTO v_ids
  FROM public.production_orders
  WHERE customer_order = _query OR order_number = _query;

  IF v_ids IS NULL OR array_length(v_ids,1) IS NULL THEN
    RAISE EXCEPTION 'Encomenda % nao encontrada', _query USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_first FROM public.production_orders
    WHERE id = ANY(v_ids)
    ORDER BY order_number
    LIMIT 1;

  SELECT jsonb_agg(item ORDER BY ord) INTO v_items FROM (
    SELECT
      po.order_number AS ord,
      jsonb_build_object(
        'order_number', po.order_number,
        'customer_order', po.customer_order,
        'product_description', po.product_description,
        'structure_type', po.structure_type,
        'measure', po.measure,
        'color', po.color,
        'status', po.status,
        'current_stage', (
          SELECT jsonb_build_object('stage', s.stage, 'status', s.status)
          FROM public.order_stages s
          WHERE s.order_id = po.id AND s.status IN ('em_curso','bloqueada')
          ORDER BY public.stage_order_index(s.stage)
          LIMIT 1
        ),
        'stages', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'stage', s.stage,
            'status', s.status,
            'started_at', s.started_at,
            'finished_at', s.finished_at,
            'order_idx', public.stage_order_index(s.stage)
          ) ORDER BY public.stage_order_index(s.stage))
          FROM public.order_stages s WHERE s.order_id = po.id
        ), '[]'::jsonb)
      ) AS item
    FROM public.production_orders po
    WHERE po.id = ANY(v_ids)
  ) t;

  RETURN jsonb_build_object(
    'customer_order', COALESCE(v_first.customer_order, v_first.order_number),
    'order_number', v_first.order_number,
    'product_description', v_first.product_description,
    'structure_type', v_first.structure_type,
    'measure', v_first.measure,
    'color', v_first.color,
    'status', v_first.status,
    'current_stage', (
      SELECT jsonb_build_object('stage', s.stage, 'status', s.status)
      FROM public.order_stages s
      WHERE s.order_id = v_first.id AND s.status IN ('em_curso','bloqueada')
      ORDER BY public.stage_order_index(s.stage)
      LIMIT 1
    ),
    'stages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'stage', s.stage,
        'status', s.status,
        'started_at', s.started_at,
        'finished_at', s.finished_at,
        'order_idx', public.stage_order_index(s.stage)
      ) ORDER BY public.stage_order_index(s.stage))
      FROM public.order_stages s WHERE s.order_id = v_first.id
    ), '[]'::jsonb),
    'items', COALESCE(v_items, '[]'::jsonb)
  );
END;
$$;
