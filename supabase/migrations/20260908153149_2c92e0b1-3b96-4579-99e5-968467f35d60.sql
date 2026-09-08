DROP FUNCTION IF EXISTS public.send_to_rework(uuid, public.production_stage, public.production_stage, text, uuid, text);

REVOKE ALL ON FUNCTION public.send_to_rework(uuid, public.production_stage, public.production_stage, text, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_to_rework(uuid, public.production_stage, public.production_stage, text, uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_to_rework(uuid, public.production_stage, public.production_stage, text, uuid, text, uuid) TO authenticated;