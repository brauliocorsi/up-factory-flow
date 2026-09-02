REVOKE ALL ON FUNCTION public.enforce_stage_sequence() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_stage_sequence() TO service_role;
REVOKE ALL ON FUNCTION public.enforce_coli_stage_sequence() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_coli_stage_sequence() TO service_role;
REVOKE ALL ON FUNCTION public.assert_previous_stages_done(uuid, public.production_stage) FROM PUBLIC, anon;