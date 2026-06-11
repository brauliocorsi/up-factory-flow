
-- Tempo previsto padrão por categoria
CREATE TABLE public.stage_sla_category (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code text NOT NULL,
  stage public.production_stage NOT NULL,
  expected_minutes int NOT NULL CHECK (expected_minutes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(category_code, stage)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stage_sla_category TO authenticated;
GRANT ALL ON public.stage_sla_category TO service_role;
ALTER TABLE public.stage_sla_category ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read sla cat" ON public.stage_sla_category FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write sla cat" ON public.stage_sla_category FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER sla_cat_updated BEFORE UPDATE ON public.stage_sla_category FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Override por produto
CREATE TABLE public.stage_sla_product (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code text NOT NULL,
  model_code text NOT NULL,
  structure_code text NOT NULL,
  measure_code text NOT NULL,
  stage public.production_stage NOT NULL,
  expected_minutes int NOT NULL CHECK (expected_minutes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(category_code, model_code, structure_code, measure_code, stage)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stage_sla_product TO authenticated;
GRANT ALL ON public.stage_sla_product TO service_role;
ALTER TABLE public.stage_sla_product ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read sla prod" ON public.stage_sla_product FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write sla prod" ON public.stage_sla_product FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER sla_prod_updated BEFORE UPDATE ON public.stage_sla_product FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Registo de excedentes
CREATE TABLE public.sla_breaches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.production_orders(id) ON DELETE CASCADE,
  stage public.production_stage NOT NULL,
  expected_minutes int NOT NULL,
  actual_productive_minutes int NOT NULL,
  over_minutes int NOT NULL,
  operator_id uuid REFERENCES public.operators(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.sla_breaches TO authenticated;
GRANT ALL ON public.sla_breaches TO service_role;
ALTER TABLE public.sla_breaches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read breaches" ON public.sla_breaches FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert breaches" ON public.sla_breaches FOR INSERT TO authenticated WITH CHECK (true);

-- Função: tempo previsto (override produto > padrão categoria > NULL)
CREATE OR REPLACE FUNCTION public.get_expected_minutes(_order_id uuid, _stage public.production_stage)
RETURNS int
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_model text; v_struct text; v_meas text; v_cat text; v_min int;
BEGIN
  BEGIN
    SELECT m.code, c.code, po.structure_type, po.measure
      INTO v_model, v_cat, v_struct, v_meas
    FROM public.production_orders po
    LEFT JOIN public.models m ON m.id = po.model_id
    LEFT JOIN public.ref_categories c ON c.id = m.category_id
    WHERE po.id = _order_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;

  IF v_cat IS NOT NULL AND v_model IS NOT NULL AND v_struct IS NOT NULL AND v_meas IS NOT NULL THEN
    SELECT expected_minutes INTO v_min FROM public.stage_sla_product
     WHERE category_code = v_cat AND model_code = v_model
       AND structure_code = v_struct AND measure_code = v_meas
       AND stage = _stage
     LIMIT 1;
    IF v_min IS NOT NULL THEN RETURN v_min; END IF;
  END IF;

  IF v_cat IS NOT NULL THEN
    SELECT expected_minutes INTO v_min FROM public.stage_sla_category
     WHERE category_code = v_cat AND stage = _stage
     LIMIT 1;
    IF v_min IS NOT NULL THEN RETURN v_min; END IF;
  END IF;

  RETURN NULL;
END;
$$;

-- Trigger: registar breach quando finaliza acima do previsto
CREATE OR REPLACE FUNCTION public.order_stages_after_complete_sla()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp int;
  v_act int;
BEGIN
  IF NEW.status = 'concluida' AND (OLD.status IS DISTINCT FROM 'concluida') THEN
    BEGIN
      v_exp := public.get_expected_minutes(NEW.order_id, NEW.stage);
    EXCEPTION WHEN OTHERS THEN
      v_exp := NULL;
    END;
    IF v_exp IS NOT NULL AND v_exp > 0 THEN
      v_act := CEIL(COALESCE(NEW.productive_seconds, 0) / 60.0)::int;
      IF v_act > v_exp THEN
        INSERT INTO public.sla_breaches(
          order_id, stage, expected_minutes, actual_productive_minutes, over_minutes, operator_id
        ) VALUES (NEW.order_id, NEW.stage, v_exp, v_act, v_act - v_exp, NEW.operator_id);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_stages_sla_breach ON public.order_stages;
CREATE TRIGGER order_stages_sla_breach
AFTER UPDATE ON public.order_stages
FOR EACH ROW EXECUTE FUNCTION public.order_stages_after_complete_sla();
