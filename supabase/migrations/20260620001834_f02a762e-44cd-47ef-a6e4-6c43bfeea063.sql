CREATE OR REPLACE FUNCTION public.get_backlog()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_estof_off int;
  v_estru_off int;
  v_today date := current_date;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT (public.has_role(v_uid,'admin'::public.app_role)
       OR public.has_role(v_uid,'escritorio'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT days_before_estofo INTO v_estof_off
    FROM public.stage_lead_offsets WHERE stage = 'estofagem';
  v_estof_off := COALESCE(v_estof_off, 0);
  SELECT days_before_estofo INTO v_estru_off
    FROM public.stage_lead_offsets WHERE stage = 'estrutura';
  v_estru_off := COALESCE(v_estru_off, 0);

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.due_date ASC NULLS LAST, t.customer_order), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT
      po.id                AS order_id,
      po.order_number,
      po.customer_order,
      po.product_description,
      m.name               AS model_name,
      po.measure,
      po.structure_type,
      po.color,
      po.fabric_type,
      po.fabric_ref,
      po.due_date,
      CASE WHEN po.due_date IS NULL THEN NULL
           ELSE public.add_business_days(public.prev_business_day(po.due_date), -v_estru_off) END AS target_estrutura,
      CASE WHEN po.due_date IS NULL THEN NULL
           ELSE public.add_business_days(public.prev_business_day(po.due_date), -v_estof_off) END AS target_estof,
      CASE
        WHEN po.due_date IS NULL THEN 'ok'
        WHEN v_today > public.add_business_days(public.prev_business_day(po.due_date), -v_estof_off)
             OR v_today > po.due_date THEN 'risco_saida'
        WHEN v_today > public.add_business_days(public.prev_business_day(po.due_date), -v_estru_off) THEN 'atrasada_folga'
        ELSE 'ok'
      END AS status
    FROM public.production_orders po
    LEFT JOIN public.models m ON m.id = po.model_id
    WHERE po.status = 'pendente'
  ) t;

  RETURN v_result;
END;
$$;

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
      public.add_business_days(public.prev_business_day(po.due_date), -v_corte_off) AS target_corte,
      public.add_business_days(public.prev_business_day(po.due_date), -v_estru_off) AS target_estrutura
    FROM public.production_orders po
    WHERE po.status = 'pendente' AND po.due_date IS NOT NULL
  ),
  g_corte AS (
    SELECT
      'corte'::text AS kind,
      jsonb_build_object('model_id', model_id, 'measure', measure, 'fabric_type', fabric_type) AS key,
      array_agg(id) AS order_ids,
      COUNT(*)::int AS count,
      MIN(target_corte) AS earliest_target,
      MIN(due_date) AS earliest_due_date
    FROM base
    WHERE target_corte IS NOT NULL AND target_corte <= v_horizon AND model_id IS NOT NULL
    GROUP BY model_id, measure, fabric_type
  ),
  g_estru AS (
    SELECT
      'estrutura'::text AS kind,
      jsonb_build_object('structure_type', structure_type, 'measure', measure) AS key,
      array_agg(id) AS order_ids,
      COUNT(*)::int AS count,
      MIN(target_estrutura) AS earliest_target,
      MIN(due_date) AS earliest_due_date
    FROM base
    WHERE target_estrutura IS NOT NULL AND target_estrutura <= v_horizon AND structure_type IS NOT NULL
    GROUP BY structure_type, measure
  ),
  unioned AS ( SELECT * FROM g_corte UNION ALL SELECT * FROM g_estru )
  SELECT COALESCE(jsonb_agg(row_to_json(u) ORDER BY u.earliest_target ASC, u.count DESC), '[]'::jsonb)
    INTO v_result
  FROM unioned u;

  RETURN v_result;
END;
$$;