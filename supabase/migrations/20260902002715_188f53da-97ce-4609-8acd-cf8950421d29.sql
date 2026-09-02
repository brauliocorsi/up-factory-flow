CREATE OR REPLACE FUNCTION public.get_public_factory_panel()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_local timestamp := timezone('Europe/Lisbon', now());
  v_day_start timestamptz := timezone('Europe/Lisbon', date_trunc('day', timezone('Europe/Lisbon', now())));
  v_day_end timestamptz := v_day_start + interval '1 day';
  v_today date := (timezone('Europe/Lisbon', now()))::date;
  v_prod_sec bigint := 0;
  v_running_sec bigint := 0;
  v_active_ops int := 0;
  v_due_total int := 0;
  v_due_done int := 0;
  v_sla_expected int := 0;
  v_sla_actual int := 0;
  v_stages_done int := 0;
  v_blocks jsonb;
  v_operators jsonb;
BEGIN
  SELECT COALESCE(SUM(os.productive_seconds), 0), COUNT(*)
    INTO v_prod_sec, v_stages_done
  FROM order_stages os
  WHERE os.status = 'concluida'
    AND os.finished_at >= v_day_start AND os.finished_at < v_day_end;

  -- tempo já acumulado em etapas ainda em curso (inclui o tempo a decorrer)
  SELECT COALESCE(SUM(
           os.productive_seconds
           + CASE WHEN NOT os.is_paused
                  THEN GREATEST(0, EXTRACT(EPOCH FROM (v_now - COALESCE(l.last_event_at, os.started_at, v_now)))::int)
                  ELSE 0 END
         ), 0)
    INTO v_running_sec
  FROM order_stages os
  LEFT JOIN (
    SELECT order_stage_id, MAX(event_at) AS last_event_at
    FROM stage_time_logs GROUP BY order_stage_id
  ) l ON l.order_stage_id = os.id
  WHERE os.status = 'em_curso';

  SELECT COUNT(DISTINCT os.operator_id)
    INTO v_active_ops
  FROM order_stages os
  WHERE os.status = 'em_curso' AND os.operator_id IS NOT NULL AND NOT os.is_paused;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE po.status IN ('concluida', 'em_armazem'))
    INTO v_due_total, v_due_done
  FROM production_orders po
  WHERE po.due_date = v_today AND po.status <> 'cancelada';

  SELECT COALESCE(SUM(COALESCE(get_expected_minutes(os.order_id, os.stage), 0)), 0),
         COALESCE(SUM(ROUND(os.productive_seconds / 60.0)), 0)
    INTO v_sla_expected, v_sla_actual
  FROM order_stages os
  WHERE os.status = 'concluida'
    AND os.finished_at >= v_day_start AND os.finished_at < v_day_end;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('block', b.idx, 'minutes', b.mins) ORDER BY b.idx), '[]'::jsonb)
    INTO v_blocks
  FROM (
    SELECT bl.idx,
           COALESCE(ROUND(SUM(os.productive_seconds) / 60.0), 0)::int AS mins
    FROM (VALUES (0, 8.0, 10.0), (1, 10.25, 12.0), (2, 13.5, 16.0), (3, 16.25, 17.5)) AS bl(idx, h_from, h_to)
    LEFT JOIN order_stages os
      ON os.status = 'concluida'
     AND os.finished_at >= v_day_start AND os.finished_at < v_day_end
     AND (EXTRACT(HOUR FROM timezone('Europe/Lisbon', os.finished_at))
          + EXTRACT(MINUTE FROM timezone('Europe/Lisbon', os.finished_at)) / 60.0) >= bl.h_from
     AND (EXTRACT(HOUR FROM timezone('Europe/Lisbon', os.finished_at))
          + EXTRACT(MINUTE FROM timezone('Europe/Lisbon', os.finished_at)) / 60.0) < bl.h_to
    GROUP BY bl.idx
  ) b;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'operator_name'), '[]'::jsonb)
    INTO v_operators
  FROM (
    SELECT DISTINCT ON (os.operator_id)
      jsonb_build_object(
        'operator_name', op.name,
        'order_number', po.order_number,
        'stage', os.stage,
        'is_paused', os.is_paused,
        'started_at', os.started_at,
        'last_resume_at', COALESCE(l.last_event_at, os.started_at),
        'productive_seconds', os.productive_seconds
      ) AS x
    FROM order_stages os
    JOIN operators op ON op.id = os.operator_id
    JOIN production_orders po ON po.id = os.order_id
    LEFT JOIN (
      SELECT order_stage_id, MAX(event_at) AS last_event_at
      FROM stage_time_logs GROUP BY order_stage_id
    ) l ON l.order_stage_id = os.id
    WHERE os.status = 'em_curso'
      AND os.operator_id IS NOT NULL
      AND po.status <> 'cancelada'
    ORDER BY os.operator_id, os.is_paused ASC, os.started_at DESC NULLS LAST
  ) s;

  RETURN jsonb_build_object(
    'server_time', v_now,
    'local_time', to_char(v_local, 'YYYY-MM-DD"T"HH24:MI:SS'),
    'productive_minutes_today', ROUND((v_prod_sec + v_running_sec) / 60.0)::int,
    'stages_done_today', v_stages_done,
    'active_operators', v_active_ops,
    'orders_due_today', v_due_total,
    'orders_due_done', v_due_done,
    'sla_expected_minutes', v_sla_expected,
    'sla_actual_minutes', v_sla_actual,
    'blocks', v_blocks,
    'operators', v_operators
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_factory_panel() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_factory_panel() FROM anon;
REVOKE ALL ON FUNCTION public.get_public_factory_panel() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_factory_panel() TO service_role;