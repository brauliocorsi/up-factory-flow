CREATE OR REPLACE FUNCTION public.stage_prerequisites(_stage public.production_stage)
RETURNS public.production_stage[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
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

REVOKE ALL ON FUNCTION public.assert_previous_stages_done(uuid, public.production_stage) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_previous_stages_done(uuid, public.production_stage) TO service_role;