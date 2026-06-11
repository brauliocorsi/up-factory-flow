REVOKE EXECUTE ON FUNCTION public.shell_needs_grouped() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_shell_batch(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.shell_needs_grouped() FROM anon;
REVOKE EXECUTE ON FUNCTION public.finalize_shell_batch(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.shell_needs_grouped() TO authenticated;
GRANT EXECUTE ON FUNCTION public.shell_needs_grouped() TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_shell_batch(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_shell_batch(uuid, text) TO service_role;