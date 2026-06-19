
-- ============================================================
-- PLANEAMENTO FASE A
-- ============================================================

-- 1) stage_lead_offsets
CREATE TABLE IF NOT EXISTS public.stage_lead_offsets (
  stage public.production_stage PRIMARY KEY,
  days_before_estofo int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.stage_lead_offsets TO authenticated;
GRANT ALL ON public.stage_lead_offsets TO service_role;

ALTER TABLE public.stage_lead_offsets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stage_lead_offsets read auth"
  ON public.stage_lead_offsets FOR SELECT TO authenticated USING (true);
CREATE POLICY "stage_lead_offsets admin write"
  ON public.stage_lead_offsets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seeds default
INSERT INTO public.stage_lead_offsets(stage, days_before_estofo) VALUES
  ('estrutura', 2), ('corte', 2), ('branco', 1), ('costura', 1),
  ('estofagem', 0), ('qualidade', 0), ('embalagem', 0), ('picagem', 0)
ON CONFLICT (stage) DO NOTHING;

-- 2) stage_day_assignment
CREATE TABLE IF NOT EXISTS public.stage_day_assignment (
  operator_id uuid NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  stage public.production_stage NOT NULL,
  work_date date NOT NULL,
  present boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operator_id, stage, work_date)
);

CREATE INDEX IF NOT EXISTS idx_sda_stage_date ON public.stage_day_assignment(stage, work_date);

GRANT SELECT ON public.stage_day_assignment TO authenticated;
GRANT ALL ON public.stage_day_assignment TO service_role;

ALTER TABLE public.stage_day_assignment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stage_day_assignment read auth"
  ON public.stage_day_assignment FOR SELECT TO authenticated USING (true);
CREATE POLICY "stage_day_assignment admin write"
  ON public.stage_day_assignment FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3) app_settings.daily_minutes
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS daily_minutes int NOT NULL DEFAULT 450;

-- 4) Funções utilitárias

CREATE OR REPLACE FUNCTION public.prev_business_day(_d date)
RETURNS date
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v date := _d;
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  WHILE EXTRACT(ISODOW FROM v) > 5 LOOP
    v := v - 1;
  END LOOP;
  RETURN v;
END;
$$;

-- _n pode ser negativo (recuar) ou positivo (avançar). Salta sáb/dom.
CREATE OR REPLACE FUNCTION public.add_business_days(_d date, _n int)
RETURNS date
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v date := _d;
  step int;
  remaining int;
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  IF _n = 0 THEN
    RETURN public.prev_business_day(v);
  END IF;
  step := CASE WHEN _n > 0 THEN 1 ELSE -1 END;
  remaining := abs(_n);
  WHILE remaining > 0 LOOP
    v := v + step;
    IF EXTRACT(ISODOW FROM v) <= 5 THEN
      remaining := remaining - 1;
    END IF;
  END LOOP;
  RETURN v;
END;
$$;

-- 5) get_stage_target_dates(_order_id)
-- Devolve, por etapa: target_date e status (ok | atrasada_folga | risco_saida)
CREATE OR REPLACE FUNCTION public.get_stage_target_dates(_order_id uuid)
RETURNS TABLE(stage public.production_stage, target_date date, status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_due date;
  v_base date;
  v_today date := current_date;
  v_estof date;
BEGIN
  SELECT due_date INTO v_due FROM public.production_orders WHERE id = _order_id;
  IF v_due IS NULL THEN RETURN; END IF;

  v_base := public.prev_business_day(v_due);

  -- Calcular target_estof primeiro (offset 0 por defeito, mas respeitar o que estiver na tabela)
  SELECT public.add_business_days(v_base, -COALESCE(o.days_before_estofo, 0))
    INTO v_estof
  FROM public.stage_lead_offsets o WHERE o.stage = 'estofagem';
  v_estof := COALESCE(v_estof, v_base);

  RETURN QUERY
  SELECT
    s.stage,
    public.add_business_days(v_base, -COALESCE(s.days_before_estofo, 0)) AS target_date,
    CASE
      WHEN v_today > v_estof OR v_today > v_due THEN 'risco_saida'
      WHEN v_today > public.add_business_days(v_base, -COALESCE(s.days_before_estofo, 0)) THEN 'atrasada_folga'
      ELSE 'ok'
    END AS status
  FROM public.stage_lead_offsets s;
END;
$$;

-- 6) get_stage_queue(_stage) — fila ordenada por target_date
CREATE OR REPLACE FUNCTION public.get_stage_queue(_stage public.production_stage)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset int;
  v_estof_offset int;
  v_today date := current_date;
  v_result jsonb;
BEGIN
  SELECT days_before_estofo INTO v_offset FROM public.stage_lead_offsets WHERE stage = _stage;
  v_offset := COALESCE(v_offset, 0);
  SELECT days_before_estofo INTO v_estof_offset FROM public.stage_lead_offsets WHERE stage = 'estofagem';
  v_estof_offset := COALESCE(v_estof_offset, 0);

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.target_date ASC NULLS LAST, t.order_number), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT
      po.id AS order_id,
      os.id AS order_stage_id,
      po.order_number,
      po.customer_order,
      po.product_description,
      po.structure_type,
      po.measure,
      po.color,
      po.due_date,
      public.add_business_days(public.prev_business_day(po.due_date), -v_offset) AS target_date,
      public.add_business_days(public.prev_business_day(po.due_date), -v_estof_offset) AS target_estof,
      public.get_expected_minutes(po.id, _stage) AS expected_minutes,
      os.status AS stage_status,
      CASE
        WHEN po.due_date IS NULL THEN 'ok'
        WHEN v_today > public.add_business_days(public.prev_business_day(po.due_date), -v_estof_offset)
             OR v_today > po.due_date THEN 'risco_saida'
        WHEN v_today > public.add_business_days(public.prev_business_day(po.due_date), -v_offset) THEN 'atrasada_folga'
        ELSE 'ok'
      END AS status
    FROM public.order_stages os
    JOIN public.production_orders po ON po.id = os.order_id
    WHERE os.stage = _stage
      AND os.status <> 'concluida'
      AND po.status IN ('pendente','em_producao')
  ) t;

  RETURN v_result;
END;
$$;

-- 7) get_stage_capacity_load(_stage, _from, _to)
CREATE OR REPLACE FUNCTION public.get_stage_capacity_load(
  _stage public.production_stage, _from date, _to date
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset int;
  v_today date := current_date;
  v_daily int;
  v_result jsonb;
BEGIN
  SELECT days_before_estofo INTO v_offset FROM public.stage_lead_offsets WHERE stage = _stage;
  v_offset := COALESCE(v_offset, 0);
  SELECT COALESCE(daily_minutes, 450) INTO v_daily FROM public.app_settings ORDER BY id LIMIT 1;
  v_daily := COALESCE(v_daily, 450);

  -- Pre-calcular fila com target_date
  WITH queue AS (
    SELECT
      po.id AS order_id,
      public.add_business_days(public.prev_business_day(po.due_date), -v_offset) AS target_date,
      COALESCE(public.get_expected_minutes(po.id, _stage), 0) AS exp_min,
      public.get_expected_minutes(po.id, _stage) IS NULL AS unknown_sla
    FROM public.order_stages os
    JOIN public.production_orders po ON po.id = os.order_id
    WHERE os.stage = _stage
      AND os.status <> 'concluida'
      AND po.status IN ('pendente','em_producao')
      AND po.due_date IS NOT NULL
  ),
  days AS (
    SELECT d::date AS day
    FROM generate_series(_from::date, _to::date, interval '1 day') d
    WHERE EXTRACT(ISODOW FROM d) <= 5
  ),
  capacity AS (
    SELECT
      d.day,
      v_daily * (
        SELECT COUNT(*)::int FROM (
          -- Para cada operador atribuído à etapa, ver se está presente nesse dia.
          -- Default: presente, a menos que exista linha com present=false.
          SELECT os.operator_id
          FROM public.operator_stages os
          LEFT JOIN public.stage_day_assignment sda
            ON sda.operator_id = os.operator_id
           AND sda.stage = _stage
           AND sda.work_date = d.day
          WHERE os.stage = _stage
            AND COALESCE(sda.present, true)
        ) p
      ) AS capacity_minutes
    FROM days d
  ),
  load AS (
    SELECT
      d.day,
      COALESCE(SUM(
        CASE
          WHEN q.target_date = d.day THEN q.exp_min
          WHEN d.day = v_today AND q.target_date < v_today THEN q.exp_min
          ELSE 0
        END
      ), 0)::int AS load_minutes,
      COUNT(*) FILTER (
        WHERE q.target_date = d.day
           OR (d.day = v_today AND q.target_date < v_today)
      )::int AS items_count,
      BOOL_OR(q.unknown_sla AND (
        q.target_date = d.day
        OR (d.day = v_today AND q.target_date < v_today)
      )) AS has_unknown
    FROM days d
    LEFT JOIN queue q ON true
    GROUP BY d.day
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', c.day,
    'capacity_minutes', c.capacity_minutes,
    'load_minutes', l.load_minutes,
    'items_count', l.items_count,
    'has_unknown', COALESCE(l.has_unknown, false),
    'includes_overdue', c.day = v_today
  ) ORDER BY c.day), '[]'::jsonb) INTO v_result
  FROM capacity c
  JOIN load l ON l.day = c.day;

  RETURN v_result;
END;
$$;
