REVOKE EXECUTE ON FUNCTION public.my_operator_id(), public.i_am_leader() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.my_operator_id(), public.i_am_leader() TO authenticated;