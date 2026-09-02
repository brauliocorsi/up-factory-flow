CREATE OR REPLACE FUNCTION public.get_stage_groups(_stage production_stage)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF _stage NOT IN ('corte','estrutura') THEN
    RAISE EXCEPTION 'Agrupamento só suportado para corte e estrutura';
  END IF;

  IF _stage = 'corte' THEN
    SELECT COALESCE(jsonb_agg(g ORDER BY (g->>'total_pieces')::int DESC), '[]'::jsonb)
      INTO v_result
    FROM (
      SELECT jsonb_build_object(
        'key', concat_ws('|',
                 COALESCE(m.code,''),
                 COALESCE(po.measure,''),
                 COALESCE(po.fabric_type,'')),
        'stage', 'corte',
        'model_code', m.code,
        'model_name', m.name,
        'measure', po.measure,
        'fabric_type', po.fabric_type,
        'directional', COALESCE(ft.directional, false),
        'total_pieces', COUNT(*)::int,
        'client_count', COUNT(*) FILTER (WHERE NOT COALESCE(po.is_stock_production,false))::int,
        'stock_count',  COUNT(*) FILTER (WHERE COALESCE(po.is_stock_production,false))::int,
        'items', jsonb_agg(jsonb_build_object(
                   'order_stage_id', os.id,
                   'order_id', po.id,
                   'order_number', po.order_number,
                   'product_description', po.product_description,
                   'color', po.color,
                   'fabric_ref', po.fabric_ref,
                   'is_stock_production', COALESCE(po.is_stock_production, false),
                   'status', os.status,
                   'is_paused', COALESCE(os.is_paused,false),
                   'productive_seconds', COALESCE(os.productive_seconds,0),
                   'paused_seconds', COALESCE(os.paused_seconds,0),
                   'started_at', os.started_at,
                   'operator_code', (SELECT code FROM public.operators WHERE id = os.operator_id),
                   'current_segment_started_at', (
                      SELECT MAX(stl.event_at) FROM public.stage_time_logs stl
                      WHERE stl.order_stage_id = os.id AND stl.event IN ('iniciar','retomar')
                   )
                 ) ORDER BY po.due_date NULLS LAST, po.order_number)
      ) AS g
      FROM public.order_stages os
      JOIN public.production_orders po ON po.id = os.order_id
      LEFT JOIN public.models m ON m.id = po.model_id
      LEFT JOIN public.ref_fabric_types ft
        ON ft.code = po.fabric_type OR ft.name = po.fabric_type
      WHERE os.stage = 'corte'
        AND os.status <> 'concluida'
        AND po.status NOT IN ('cancelada','concluida','em_armazem')
      GROUP BY m.code, m.name, po.measure, po.fabric_type, ft.directional
    ) sub;
  ELSE
    SELECT COALESCE(jsonb_agg(g ORDER BY (g->>'total_pieces')::int DESC), '[]'::jsonb)
      INTO v_result
    FROM (
      SELECT jsonb_build_object(
        'key', concat_ws('|',
                 COALESCE(po.structure_type,''),
                 COALESCE(po.measure,'')),
        'stage', 'estrutura',
        'structure_type', po.structure_type,
        'measure', po.measure,
        'total_pieces', COUNT(*)::int,
        'client_count', COUNT(*) FILTER (WHERE NOT COALESCE(po.is_stock_production,false))::int,
        'stock_count',  COUNT(*) FILTER (WHERE COALESCE(po.is_stock_production,false))::int,
        'items', jsonb_agg(jsonb_build_object(
                   'order_stage_id', os.id,
                   'order_id', po.id,
                   'order_number', po.order_number,
                   'product_description', po.product_description,
                   'model_name', (SELECT name FROM public.models WHERE id = po.model_id),
                   'is_stock_production', COALESCE(po.is_stock_production, false),
                   'status', os.status,
                   'is_paused', COALESCE(os.is_paused,false),
                   'productive_seconds', COALESCE(os.productive_seconds,0),
                   'paused_seconds', COALESCE(os.paused_seconds,0),
                   'started_at', os.started_at,
                   'operator_code', (SELECT code FROM public.operators WHERE id = os.operator_id),
                   'current_segment_started_at', (
                      SELECT MAX(stl.event_at) FROM public.stage_time_logs stl
                      WHERE stl.order_stage_id = os.id AND stl.event IN ('iniciar','retomar')
                   )
                 ) ORDER BY po.due_date NULLS LAST, po.order_number)
      ) AS g
      FROM public.order_stages os
      JOIN public.production_orders po ON po.id = os.order_id
      WHERE os.stage = 'estrutura'
        AND os.status <> 'concluida'
        AND po.status NOT IN ('cancelada','concluida','em_armazem')
      GROUP BY po.structure_type, po.measure
    ) sub;
  END IF;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

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

  -- Operadores em curso: junta trabalho ao nível da encomenda e ao nível
  -- do coli. Mostra apenas UMA linha por operador (a mais relevante),
  -- indicando quantas encomendas tem em curso.
  WITH running AS (
    SELECT os.operator_id, po.order_number, os.stage::text AS stage, po.id AS order_id,
           COALESCE(os.is_paused,false) AS is_paused, os.started_at,
           COALESCE(l.last_event_at, os.started_at) AS last_resume_at,
           COALESCE(os.productive_seconds,0) AS productive_seconds
    FROM order_stages os
    JOIN production_orders po ON po.id = os.order_id
    LEFT JOIN (
      SELECT order_stage_id, MAX(event_at) AS last_event_at
      FROM stage_time_logs GROUP BY order_stage_id
    ) l ON l.order_stage_id = os.id
    WHERE os.status = 'em_curso' AND os.operator_id IS NOT NULL AND po.status <> 'cancelada'
    UNION ALL
    SELECT ocs.operator_id, po.order_number, ocs.stage::text AS stage, po.id AS order_id,
           COALESCE(ocs.is_paused,false) AS is_paused, ocs.started_at,
           COALESCE(ocs.last_resume_at, ocs.started_at) AS last_resume_at,
           COALESCE(ocs.productive_seconds,0) AS productive_seconds
    FROM order_coli_stages ocs
    JOIN production_orders po ON po.id = ocs.order_id
    WHERE ocs.status = 'em_curso' AND ocs.operator_id IS NOT NULL AND po.status <> 'cancelada'
  ), counted AS (
    SELECT r.*, COUNT(DISTINCT r.order_id) OVER (PARTITION BY r.operator_id) AS order_count
    FROM running r
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'operator_name'), '[]'::jsonb)
    INTO v_operators
  FROM (
    SELECT DISTINCT ON (c.operator_id)
      jsonb_build_object(
        'operator_name', op.name,
        'order_number', c.order_number,
        'stage', c.stage,
        'is_paused', c.is_paused,
        'started_at', c.started_at,
        'last_resume_at', c.last_resume_at,
        'productive_seconds', c.productive_seconds,
        'order_count', c.order_count::int
      ) AS x
    FROM counted c
    JOIN operators op ON op.id = c.operator_id
    ORDER BY c.operator_id, c.is_paused ASC, c.started_at DESC NULLS LAST
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
    'operators', v_operators
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_public_factory_panel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_factory_panel() TO service_role;
REVOKE ALL ON FUNCTION public.get_stage_groups(production_stage) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_stage_groups(production_stage) TO authenticated, service_role;