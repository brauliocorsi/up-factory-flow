CREATE OR REPLACE FUNCTION public.stage_prerequisites(_stage public.production_stage)
RETURNS public.production_stage[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _stage
    WHEN 'estrutura' THEN ARRAY[]::public.production_stage[]
    WHEN 'corte'     THEN ARRAY[]::public.production_stage[]
    WHEN 'branco'    THEN ARRAY['estrutura']::public.production_stage[]
    WHEN 'costura'   THEN ARRAY['corte']::public.production_stage[]
    WHEN 'estofagem' THEN ARRAY['estrutura','corte','costura','branco']::public.production_stage[]
    WHEN 'qualidade' THEN ARRAY['estrutura','corte','costura','branco','estofagem']::public.production_stage[]
    WHEN 'embalagem' THEN ARRAY['estrutura','corte','costura','branco','estofagem','qualidade']::public.production_stage[]
    WHEN 'picagem'   THEN ARRAY['estrutura','corte','costura','branco','estofagem','qualidade','embalagem']::public.production_stage[]
    ELSE ARRAY[]::public.production_stage[]
  END;
$$;

REVOKE ALL ON FUNCTION public.stage_prerequisites(public.production_stage) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stage_prerequisites(public.production_stage) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assert_previous_stages_done(_order_id uuid, _stage public.production_stage)
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pending text;
BEGIN
  SELECT string_agg(os.stage::text, ', ' ORDER BY public.stage_order_index(os.stage))
    INTO v_pending
    FROM public.order_stages os
   WHERE os.order_id = _order_id
     AND os.stage = ANY (public.stage_prerequisites(_stage))
     AND os.status <> 'concluida';

  IF v_pending IS NOT NULL THEN
    RAISE EXCEPTION 'Não é possível iniciar %: a(s) etapa(s) anterior(es) ainda não estão concluídas (%)', _stage, v_pending;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_previous_stages_done(uuid, public.production_stage) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_previous_stages_done(uuid, public.production_stage) TO authenticated, service_role;