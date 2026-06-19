-- Create stage_sla_model: intermediate SLA inheritance level (category + model)
CREATE TABLE public.stage_sla_model (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code text NOT NULL,
  model_code text NOT NULL,
  stage public.production_stage NOT NULL,
  expected_minutes int NOT NULL CHECK (expected_minutes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_code, model_code, stage)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stage_sla_model TO authenticated;
GRANT ALL ON public.stage_sla_model TO service_role;

ALTER TABLE public.stage_sla_model ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read sla model" ON public.stage_sla_model
  FOR SELECT USING (true);

CREATE POLICY "admin write sla model" ON public.stage_sla_model
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "block_operators" ON public.stage_sla_model
  AS RESTRICTIVE FOR ALL
  USING (NOT is_operator_only(auth.uid()))
  WITH CHECK (NOT is_operator_only(auth.uid()));

CREATE TRIGGER trg_stage_sla_model_set_updated_at
  BEFORE UPDATE ON public.stage_sla_model
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Update get_expected_minutes to include model-level resolution
CREATE OR REPLACE FUNCTION public.get_expected_minutes(_order_id uuid, _stage production_stage)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- 1) Product-level (most specific)
  IF v_cat IS NOT NULL AND v_model IS NOT NULL AND v_struct IS NOT NULL AND v_meas IS NOT NULL THEN
    SELECT expected_minutes INTO v_min FROM public.stage_sla_product
     WHERE category_code = v_cat AND model_code = v_model
       AND structure_code = v_struct AND measure_code = v_meas
       AND stage = _stage
     LIMIT 1;
    IF v_min IS NOT NULL THEN RETURN v_min; END IF;
  END IF;

  -- 2) Model-level (intermediate)
  IF v_cat IS NOT NULL AND v_model IS NOT NULL THEN
    SELECT expected_minutes INTO v_min FROM public.stage_sla_model
     WHERE category_code = v_cat AND model_code = v_model AND stage = _stage
     LIMIT 1;
    IF v_min IS NOT NULL THEN RETURN v_min; END IF;
  END IF;

  -- 3) Category-level (fallback)
  IF v_cat IS NOT NULL THEN
    SELECT expected_minutes INTO v_min FROM public.stage_sla_category
     WHERE category_code = v_cat AND stage = _stage
     LIMIT 1;
    IF v_min IS NOT NULL THEN RETURN v_min; END IF;
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_expected_minutes(uuid, production_stage) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_expected_minutes(uuid, production_stage) TO authenticated, service_role;