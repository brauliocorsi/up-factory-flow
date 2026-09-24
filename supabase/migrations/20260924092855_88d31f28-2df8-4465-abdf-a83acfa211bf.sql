CREATE OR REPLACE FUNCTION public.get_public_factory_panel()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  WITH running AS (
    SELECT os.operator_id, po.order_number, os.stage::text AS stage, po.id AS order_id,
           NULL::int AS coli_number, NULL::int AS coli_total, os.id AS item_id,
           COALESCE(os.is_paused,false) AS is_paused, os.started_at,
           COALESCE(l.last_event_at, os.started_at) AS last_resume_at,
           COALESCE(os.productive_seconds,0) AS productive_seconds, NULL::uuid AS ocs_id
    FROM order_stages os
    JOIN production_orders po ON po.id = os.order_id
    LEFT JOIN (SELECT order_stage_id, MAX(event_at) AS last_event_at FROM stage_time_logs GROUP BY order_stage_id) l ON l.order_stage_id = os.id
    WHERE os.status = 'em_curso' AND os.operator_id IS NOT NULL AND po.status <> 'cancelada'
      AND NOT EXISTS (SELECT 1 FROM order_coli_stages c WHERE c.order_id=os.order_id AND c.stage=os.stage)
    UNION ALL
    SELECT ocs.operator_id, po.order_number, ocs.stage::text, po.id,
           oc.coli_number, (SELECT count(*)::int FROM order_colis x WHERE x.order_id=po.id), ocs.id,
           COALESCE(ocs.is_paused,false), ocs.started_at,
           COALESCE(ocs.last_resume_at, ocs.started_at),
           COALESCE(ocs.productive_seconds,0), ocs.id
    FROM order_coli_stages ocs
    JOIN production_orders po ON po.id = ocs.order_id
    JOIN order_colis oc ON oc.id = ocs.order_coli_id
    WHERE ocs.status = 'em_curso' AND ocs.operator_id IS NOT NULL AND po.status <> 'cancelada'
  ), items AS (
    SELECT r.*, (SELECT COALESCE(pr.label,'Sem motivo') FROM stage_pauses sp LEFT JOIN pause_reasons pr ON pr.id=sp.reason_id
                  WHERE sp.order_coli_stage_id=r.ocs_id AND sp.ended_at IS NULL ORDER BY sp.started_at DESC LIMIT 1) AS pause_reason
    FROM running r
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'operator_name'), '[]'::jsonb)
    INTO v_operators
  FROM (
    SELECT jsonb_build_object(
        'operator_name', op.name,
        'order_number', f.order_number,
        'stage', f.stage,
        'is_paused', bool_and(i.is_paused),
        'started_at', f.started_at,
        'last_resume_at', f.last_resume_at,
        'productive_seconds', f.productive_seconds,
        'order_count', count(DISTINCT i.order_id)::int,
        'orders', jsonb_agg(jsonb_build_object(
            'id', i.item_id, 'order_number', i.order_number, 'stage', i.stage,
            'coli_number', i.coli_number, 'coli_total', i.coli_total,
            'is_paused', i.is_paused, 'pause_reason', i.pause_reason,
            'last_resume_at', i.last_resume_at, 'productive_seconds', i.productive_seconds)
          ORDER BY i.is_paused, i.started_at DESC NULLS LAST)
      ) AS x
    FROM items i
    JOIN operators op ON op.id = i.operator_id
    CROSS JOIN LATERAL (SELECT * FROM items i2 WHERE i2.operator_id=i.operator_id ORDER BY i2.is_paused, i2.started_at DESC NULLS LAST LIMIT 1) f
    GROUP BY op.id, op.name, f.order_number, f.stage, f.started_at, f.last_resume_at, f.productive_seconds
  ) s;

  SELECT COUNT(*) INTO v_active_ops FROM jsonb_array_elements(v_operators) e
   WHERE (e->>'is_paused')::boolean IS FALSE;

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
    'operators', v_operators,
    'idle_today', public.idle_report_impl(v_today, v_today)
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_public_factory_panel() FROM PUBLIC, anon, authenticated;