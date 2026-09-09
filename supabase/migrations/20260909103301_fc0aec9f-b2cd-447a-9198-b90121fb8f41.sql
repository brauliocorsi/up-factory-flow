
CREATE OR REPLACE FUNCTION public.get_week_capacity_plan(_from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := current_date;
  v_daily int;
  v_result jsonb;
BEGIN
  SELECT COALESCE(daily_minutes, 450) INTO v_daily
    FROM public.app_settings ORDER BY id LIMIT 1;
  v_daily := COALESCE(v_daily, 450);

  WITH stages AS (
    SELECT unnest(ARRAY[
      'estrutura','corte','costura','branco','estofagem','qualidade','embalagem'
    ]::public.production_stage[]) AS stage
  ),
  days AS (
    SELECT d::date AS day
    FROM generate_series(_from::date, _to::date, interval '1 day') d
    WHERE EXTRACT(ISODOW FROM d) <= 5
  ),
  offsets AS (
    SELECT s.stage,
           COALESCE((SELECT days_before_estofo FROM public.stage_lead_offsets o WHERE o.stage = s.stage), 0) AS off
    FROM stages s
  ),
  queue AS (
    SELECT
      s.stage,
      po.id AS order_id,
      po.status AS order_status,
      public.add_business_days(public.prev_business_day(po.due_date), -o.off) AS target_date,
      COALESCE(public.get_expected_minutes(po.id, s.stage), 0) AS exp_min,
      public.get_expected_minutes(po.id, s.stage) IS NULL AS unknown_sla
    FROM stages s
    JOIN offsets o ON o.stage = s.stage
    JOIN public.order_stages os ON os.stage = s.stage AND os.status <> 'concluida'
    JOIN public.production_orders po ON po.id = os.order_id
    WHERE po.status IN ('pendente','em_producao')
      AND COALESCE(po.is_test, false) = false
      AND po.due_date IS NOT NULL
  ),
  capacity AS (
    SELECT
      s.stage,
      d.day,
      v_daily * (
        SELECT COUNT(*)::int FROM (
          SELECT op.operator_id
          FROM public.operator_stages op
          LEFT JOIN public.stage_day_assignment sda
            ON sda.operator_id = op.operator_id
           AND sda.stage = s.stage
           AND sda.work_date = d.day
          WHERE op.stage = s.stage
            AND COALESCE(sda.present, true)
        ) p
      ) AS capacity_minutes
    FROM stages s CROSS JOIN days d
  ),
  load AS (
    SELECT
      s.stage,
      d.day,
      COALESCE(SUM(CASE
        WHEN q.target_date = d.day THEN q.exp_min
        WHEN d.day = v_today AND q.target_date < v_today THEN q.exp_min
        ELSE 0
      END), 0)::int AS load_minutes,
      COALESCE(SUM(CASE
        WHEN q.order_status = 'em_producao' AND q.target_date = d.day THEN q.exp_min
        WHEN q.order_status = 'em_producao' AND d.day = v_today AND q.target_date < v_today THEN q.exp_min
        ELSE 0
      END), 0)::int AS load_firm_minutes,
      COUNT(CASE
        WHEN q.target_date = d.day THEN 1
        WHEN d.day = v_today AND q.target_date < v_today THEN 1
        ELSE NULL
      END)::int AS items_count,
      BOOL_OR(CASE
        WHEN (q.target_date = d.day OR (d.day = v_today AND q.target_date < v_today)) THEN q.unknown_sla
        ELSE false
      END) AS has_unknown
    FROM stages s
    CROSS JOIN days d
    LEFT JOIN queue q ON q.stage = s.stage
    GROUP BY s.stage, d.day
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'stage', c.stage,
    'date', c.day,
    'capacity_minutes', c.capacity_minutes,
    'load_minutes', COALESCE(l.load_minutes, 0),
    'load_firm_minutes', COALESCE(l.load_firm_minutes, 0),
    'items_count', COALESCE(l.items_count, 0),
    'has_unknown', COALESCE(l.has_unknown, false),
    'includes_overdue', (c.day = v_today),
    'over_minutes', GREATEST(0, COALESCE(l.load_minutes, 0) - c.capacity_minutes)
  ) ORDER BY c.stage, c.day), '[]'::jsonb)
  INTO v_result
  FROM capacity c
  LEFT JOIN load l ON l.stage = c.stage AND l.day = c.day;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_week_capacity_plan(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_week_capacity_plan(date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_week_capacity_plan(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_week_capacity_plan(date, date) TO service_role;

CREATE OR REPLACE FUNCTION public.get_day_stage_orders(_stage public.production_stage, _date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := current_date;
  v_off int;
  v_result jsonb;
BEGIN
  SELECT COALESCE(days_before_estofo, 0) INTO v_off
    FROM public.stage_lead_offsets WHERE stage = _stage;
  v_off := COALESCE(v_off, 0);

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'due_date', x->>'order_number'), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'order_id', po.id,
      'order_number', po.order_number,
      'customer_order', po.customer_order,
      'product_description', po.product_description,
      'model_name', m.name,
      'measure', po.measure,
      'due_date', po.due_date,
      'target_date', public.add_business_days(public.prev_business_day(po.due_date), -v_off),
      'order_status', po.status,
      'stage_status', os.status,
      'expected_minutes', public.get_expected_minutes(po.id, _stage),
      'overdue', public.add_business_days(public.prev_business_day(po.due_date), -v_off) < v_today
    ) AS x
    FROM public.order_stages os
    JOIN public.production_orders po ON po.id = os.order_id
    LEFT JOIN public.models m ON m.id = po.model_id
    WHERE os.stage = _stage
      AND os.status <> 'concluida'
      AND po.status IN ('pendente','em_producao')
      AND COALESCE(po.is_test, false) = false
      AND po.due_date IS NOT NULL
      AND (
        public.add_business_days(public.prev_business_day(po.due_date), -v_off) = _date
        OR (_date = v_today AND public.add_business_days(public.prev_business_day(po.due_date), -v_off) < v_today)
      )
  ) s;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_day_stage_orders(public.production_stage, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_day_stage_orders(public.production_stage, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_day_stage_orders(public.production_stage, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_day_stage_orders(public.production_stage, date) TO service_role;
