CREATE OR REPLACE FUNCTION public.assert_previous_stages_done(_order_id uuid, _stage public.production_stage)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending text;
BEGIN
  SELECT string_agg(os.stage::text, ', ' ORDER BY public.stage_order_index(os.stage))
    INTO v_pending
    FROM public.order_stages os
   WHERE os.order_id = _order_id
     AND public.stage_order_index(os.stage) < public.stage_order_index(_stage)
     AND os.status <> 'concluida';

  IF v_pending IS NOT NULL THEN
    RAISE EXCEPTION 'Não é possível iniciar %: a(s) etapa(s) anterior(es) ainda não estão concluídas (%)', _stage, v_pending;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_previous_stages_done(uuid, public.production_stage) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_previous_stages_done(uuid, public.production_stage) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_stage_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('em_curso','concluida')
     AND OLD.status = 'pendente'
     AND NOT COALESCE(NEW.is_rework, false) THEN
    PERFORM public.assert_previous_stages_done(NEW.order_id, NEW.stage);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aa_order_stages_enforce_sequence ON public.order_stages;
CREATE TRIGGER aa_order_stages_enforce_sequence
BEFORE UPDATE ON public.order_stages
FOR EACH ROW EXECUTE FUNCTION public.enforce_stage_sequence();

CREATE OR REPLACE FUNCTION public.enforce_coli_stage_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('em_curso','concluida') AND OLD.status = 'pendente' THEN
    PERFORM public.assert_previous_stages_done(NEW.order_id, NEW.stage);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aa_order_coli_stages_enforce_sequence ON public.order_coli_stages;
CREATE TRIGGER aa_order_coli_stages_enforce_sequence
BEFORE UPDATE ON public.order_coli_stages
FOR EACH ROW EXECUTE FUNCTION public.enforce_coli_stage_sequence();