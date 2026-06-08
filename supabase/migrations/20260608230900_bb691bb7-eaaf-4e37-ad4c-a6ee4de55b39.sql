
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_default_stages() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.order_stages_before_update() FROM PUBLIC, anon, authenticated;
