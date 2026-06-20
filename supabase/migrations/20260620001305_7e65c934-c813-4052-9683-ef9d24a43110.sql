-- ============================================================
-- Planeamento Fase B
-- Apenas funções novas. Sem tabelas novas. Não toca em Fase A.
-- ============================================================

-- ------------------------------------------------------------
-- 1) get_backlog()
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_backlog()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estof_off int;
  v_estru_off int;
  v_today date := current_date;
  v_result jsonb;
BEGIN
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

GRANT EXECUTE ON FUNCTION public.get_backlog() TO authenticated;

-- ------------------------------------------------------------
-- 2) get_activation_suggestions()
-- Janela: prazo da 1ª etapa relevante <= hoje + 5 dias úteis.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_activation_suggestions()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_corte_off int;
  v_estru_off int;
  v_today date := current_date;
  v_horizon date;
  v_result jsonb;
BEGIN
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
    WHERE target_corte IS NOT NULL
      AND target_corte <= v_horizon
      AND model_id IS NOT NULL
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
    WHERE target_estrutura IS NOT NULL
      AND target_estrutura <= v_horizon
      AND structure_type IS NOT NULL
    GROUP BY structure_type, measure
  ),
  unioned AS (
    SELECT * FROM g_corte
    UNION ALL
    SELECT * FROM g_estru
  )
  SELECT COALESCE(jsonb_agg(row_to_json(u) ORDER BY u.earliest_target ASC, u.count DESC), '[]'::jsonb)
    INTO v_result
  FROM unioned u;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_activation_suggestions() TO authenticated;

-- ------------------------------------------------------------
-- 3) get_global_capacity_load(_from, _to)
-- Por etapa × dia: capacity, firm, shadow.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_global_capacity_load(_from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
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
      public.get_expected_minutes(po.id, s.stage) IS NULL AS unknown_sla,
      os.status AS stage_status
    FROM stages s
    JOIN offsets o ON o.stage = s.stage
    JOIN public.order_stages os ON os.stage = s.stage AND os.status <> 'concluida'
    JOIN public.production_orders po ON po.id = os.order_id
    WHERE po.status IN ('pendente','em_producao')
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
      -- FIRME: em_producao com target_date == dia, ou (no dia de hoje) target_date < hoje
      COALESCE(SUM(CASE
        WHEN q.order_status = 'em_producao' AND q.target_date = d.day THEN q.exp_min
        WHEN q.order_status = 'em_producao' AND d.day = v_today AND q.target_date < v_today THEN q.exp_min
        ELSE 0
      END), 0)::int AS load_firm_minutes,
      -- SOMBRA: apenas pendente, apenas dentro de [from,to], sem atraso acumulado
      COALESCE(SUM(CASE
        WHEN q.order_status = 'pendente'
             AND q.target_date = d.day
             AND q.target_date BETWEEN _from AND _to
        THEN q.exp_min ELSE 0
      END), 0)::int AS load_shadow_minutes,
      COUNT(*) FILTER (
        WHERE q.order_status = 'em_producao'
          AND (q.target_date = d.day OR (d.day = v_today AND q.target_date < v_today))
      )::int AS items_firm,
      COUNT(*) FILTER (
        WHERE q.order_status = 'pendente'
          AND q.target_date = d.day
          AND q.target_date BETWEEN _from AND _to
      )::int AS items_shadow,
      BOOL_OR(q.unknown_sla AND (
        (q.order_status = 'em_producao' AND (q.target_date = d.day OR (d.day = v_today AND q.target_date < v_today)))
        OR (q.order_status = 'pendente' AND q.target_date = d.day AND q.target_date BETWEEN _from AND _to)
      )) AS has_unknown
    FROM stages s CROSS JOIN days d
    LEFT JOIN queue q ON q.stage = s.stage
    GROUP BY s.stage, d.day
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'stage', c.stage,
    'date', c.day,
    'capacity_minutes', c.capacity_minutes,
    'load_firm_minutes', l.load_firm_minutes,
    'load_shadow_minutes', l.load_shadow_minutes,
    'items_firm', l.items_firm,
    'items_shadow', l.items_shadow,
    'has_unknown', COALESCE(l.has_unknown, false),
    'includes_overdue', c.day = v_today
  ) ORDER BY c.stage, c.day), '[]'::jsonb) INTO v_result
  FROM capacity c
  JOIN load l ON l.stage = c.stage AND l.day = c.day;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_global_capacity_load(date, date) TO authenticated;

-- ------------------------------------------------------------
-- 4) activate_orders(_order_ids)
-- Admin ou escritório. Idempotente.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_orders(_order_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_activated uuid[] := ARRAY[]::uuid[];
  v_skipped uuid[] := ARRAY[]::uuid[];
  v_failed jsonb := '[]'::jsonb;
  v_id uuid;
  v_status text;
  v_res jsonb;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF NOT (public.has_role(v_uid, 'admin'::public.app_role)
          OR public.has_role(v_uid, 'escritorio'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOREACH v_id IN ARRAY _order_ids LOOP
    BEGIN
      SELECT status INTO v_status FROM public.production_orders WHERE id = v_id FOR UPDATE;
      IF v_status IS NULL THEN
        v_failed := v_failed || jsonb_build_object('order_id', v_id, 'reason', 'not_found');
        CONTINUE;
      END IF;
      IF v_status = 'em_producao' THEN
        v_skipped := array_append(v_skipped, v_id);
        CONTINUE;
      END IF;
      IF v_status <> 'pendente' THEN
        v_failed := v_failed || jsonb_build_object('order_id', v_id, 'reason', 'invalid_status:' || v_status);
        CONTINUE;
      END IF;

      BEGIN
        v_res := public.try_reserve_for_order(v_id);
      EXCEPTION WHEN OTHERS THEN
        v_failed := v_failed || jsonb_build_object('order_id', v_id, 'reason', SQLERRM);
        CONTINUE;
      END;

      UPDATE public.production_orders SET status = 'em_producao' WHERE id = v_id;
      v_activated := array_append(v_activated, v_id);
    EXCEPTION WHEN OTHERS THEN
      v_reason := SQLERRM;
      v_failed := v_failed || jsonb_build_object('order_id', v_id, 'reason', v_reason);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'activated', to_jsonb(v_activated),
    'skipped',   to_jsonb(v_skipped),
    'failed',    v_failed
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_orders(uuid[]) TO authenticated;
