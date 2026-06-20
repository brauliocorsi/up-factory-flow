-- Phase C: bater todos os grupos do backlog (>=2), marcar urgent, e resumo
CREATE OR REPLACE FUNCTION public.get_activation_suggestions()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_corte_off int;
  v_estru_off int;
  v_today date := current_date;
  v_horizon date;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT (public.has_role(v_uid,'admin'::public.app_role)
       OR public.has_role(v_uid,'escritorio'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT days_before_estofo INTO v_corte_off
    FROM public.stage_lead_offsets WHERE stage = 'corte';
  v_corte_off := COALESCE(v_corte_off, 0);
  SELECT days_before_estofo INTO v_estru_off
    FROM public.stage_lead_offsets WHERE stage = 'estrutura';
  v_estru_off := COALESCE(v_estru_off, 0);

  v_horizon := public.add_business_days(v_today, 5);

  WITH base AS (
    SELECT
      po.id,
      po.model_id,
      po.measure,
      po.fabric_type,
      po.structure_type,
      po.due_date,
      CASE WHEN po.due_date IS NULL THEN NULL
           ELSE public.add_business_days(public.prev_business_day(po.due_date), -v_corte_off) END AS target_corte,
      CASE WHEN po.due_date IS NULL THEN NULL
           ELSE public.add_business_days(public.prev_business_day(po.due_date), -v_estru_off) END AS target_estrutura
    FROM public.production_orders po
    WHERE po.status = 'pendente'
  ),
  g_corte AS (
    SELECT
      'corte'::text AS kind,
      jsonb_build_object('model_id', model_id, 'measure', measure, 'fabric_type', fabric_type) AS key,
      array_agg(id) AS order_ids,
      COUNT(*)::int AS count,
      MIN(target_corte) AS earliest_target,
      MIN(due_date) AS earliest_due_date,
      (MIN(target_corte) IS NOT NULL AND MIN(target_corte) <= v_horizon) AS urgent
    FROM base
    WHERE model_id IS NOT NULL
    GROUP BY model_id, measure, fabric_type
    HAVING COUNT(*) >= 2
  ),
  g_estru AS (
    SELECT
      'estrutura'::text AS kind,
      jsonb_build_object('structure_type', structure_type, 'measure', measure) AS key,
      array_agg(id) AS order_ids,
      COUNT(*)::int AS count,
      MIN(target_estrutura) AS earliest_target,
      MIN(due_date) AS earliest_due_date,
      (MIN(target_estrutura) IS NOT NULL AND MIN(target_estrutura) <= v_horizon) AS urgent
    FROM base
    WHERE structure_type IS NOT NULL
    GROUP BY structure_type, measure
    HAVING COUNT(*) >= 2
  ),
  unioned AS ( SELECT * FROM g_corte UNION ALL SELECT * FROM g_estru )
  SELECT COALESCE(jsonb_agg(row_to_json(u) ORDER BY u.urgent DESC, u.earliest_due_date ASC NULLS LAST, u.count DESC), '[]'::jsonb)
    INTO v_result
  FROM unioned u;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_activation_suggestions() TO authenticated;

-- Resumo para badge global
CREATE OR REPLACE FUNCTION public.count_backlog_batches()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_corte_off int;
  v_estru_off int;
  v_today date := current_date;
  v_horizon date;
  v_total_groups int := 0;
  v_total_orders int := 0;
  v_urgent_groups int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT (public.has_role(v_uid,'admin'::public.app_role)
       OR public.has_role(v_uid,'escritorio'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT days_before_estofo INTO v_corte_off FROM public.stage_lead_offsets WHERE stage = 'corte';
  v_corte_off := COALESCE(v_corte_off, 0);
  SELECT days_before_estofo INTO v_estru_off FROM public.stage_lead_offsets WHERE stage = 'estrutura';
  v_estru_off := COALESCE(v_estru_off, 0);
  v_horizon := public.add_business_days(v_today, 5);

  WITH base AS (
    SELECT po.id, po.model_id, po.measure, po.fabric_type, po.structure_type, po.due_date,
      CASE WHEN po.due_date IS NULL THEN NULL
           ELSE public.add_business_days(public.prev_business_day(po.due_date), -v_corte_off) END AS target_corte,
      CASE WHEN po.due_date IS NULL THEN NULL
           ELSE public.add_business_days(public.prev_business_day(po.due_date), -v_estru_off) END AS target_estrutura
    FROM public.production_orders po
    WHERE po.status = 'pendente'
  ),
  g AS (
    SELECT COUNT(*)::int AS cnt,
           (MIN(target_corte) IS NOT NULL AND MIN(target_corte) <= v_horizon) AS urgent
      FROM base WHERE model_id IS NOT NULL
      GROUP BY model_id, measure, fabric_type HAVING COUNT(*) >= 2
    UNION ALL
    SELECT COUNT(*)::int AS cnt,
           (MIN(target_estrutura) IS NOT NULL AND MIN(target_estrutura) <= v_horizon) AS urgent
      FROM base WHERE structure_type IS NOT NULL
      GROUP BY structure_type, measure HAVING COUNT(*) >= 2
  )
  SELECT COUNT(*)::int, COALESCE(SUM(cnt),0)::int, COALESCE(SUM(CASE WHEN urgent THEN 1 ELSE 0 END),0)::int
    INTO v_total_groups, v_total_orders, v_urgent_groups
  FROM g;

  RETURN jsonb_build_object(
    'total_groups', v_total_groups,
    'total_orders_in_groups', v_total_orders,
    'urgent_groups', v_urgent_groups
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.count_backlog_batches() TO authenticated;