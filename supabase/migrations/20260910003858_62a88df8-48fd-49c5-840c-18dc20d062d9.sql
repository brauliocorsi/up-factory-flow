CREATE OR REPLACE FUNCTION public.assert_fabric_consumed(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.fabric_consumptions
     WHERE order_id = _order_id AND reverted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Corte bloqueado: registe primeiro o consumo de tecido (botão "Consumir tecido").';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_fabric_consumed(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.enforce_coli_stage_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IN ('em_curso','concluida')
     AND COALESCE(OLD.status::text, '') <> NEW.status::text THEN
    PERFORM public.assert_coli_previous_stages_done(NEW.order_coli_id, NEW.stage);
  END IF;

  IF NEW.stage = 'corte' AND NEW.status = 'concluida'
     AND COALESCE(OLD.status::text, '') <> 'concluida' THEN
    PERFORM public.assert_fabric_consumed(NEW.order_id);
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.order_stages_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branco_ok BOOLEAN;
  v_costura_ok BOOLEAN;
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_derived BOOLEAN;
BEGIN
  NEW.updated_at = now();

  SELECT EXISTS (SELECT 1 FROM public.order_coli_stages WHERE order_id = NEW.order_id) INTO v_derived;

  IF NOT v_derived AND NEW.stage = 'estofagem' AND NEW.status = 'em_curso' AND OLD.status <> 'em_curso' THEN
    SELECT (status='concluida' AND check_valid) INTO v_branco_ok
      FROM public.order_stages WHERE order_id = NEW.order_id AND stage = 'branco';
    SELECT (status='concluida' AND check_valid) INTO v_costura_ok
      FROM public.order_stages WHERE order_id = NEW.order_id AND stage = 'costura';
    IF NOT COALESCE(v_branco_ok,false) THEN v_missing := array_append(v_missing,'Branco'); END IF;
    IF NOT COALESCE(v_costura_ok,false) THEN v_missing := array_append(v_missing,'Costura'); END IF;
    IF array_length(v_missing,1) > 0 THEN
      RAISE EXCEPTION 'Estofagem bloqueada: é necessário concluir % primeiro.', array_to_string(v_missing,' e ');
    END IF;
  END IF;

  IF NEW.status = 'em_curso' AND OLD.status <> 'em_curso' AND NEW.started_at IS NULL THEN
    NEW.started_at = now();
  END IF;

  IF NEW.status = 'concluida' AND OLD.status <> 'concluida' THEN
    IF NEW.stage = 'corte' THEN
      PERFORM public.assert_fabric_consumed(NEW.order_id);
    END IF;
    IF NEW.finished_at IS NULL THEN NEW.finished_at = now(); END IF;
    IF NEW.started_at IS NOT NULL THEN
      NEW.duration_minutes = CEIL(EXTRACT(EPOCH FROM (NEW.finished_at - NEW.started_at))/60.0)::INT;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;