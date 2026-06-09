
-- Lock down SECURITY DEFINER functions: revoke broad EXECUTE, then grant only where needed.

-- Revoke from PUBLIC (covers anon + authenticated by default)
REVOKE EXECUTE ON FUNCTION public.try_reserve_for_order(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.find_matching_cover(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_order_recipe(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.preview_cancel_order(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_order_with_recovery(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_default_stages() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.order_stages_before_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.order_stages_after_complete_consume() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.production_orders_after_insert_reserve() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;

-- Re-grant where the application actually needs it:
-- has_role is invoked inside RLS policies by authenticated users.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- Cancel flow is invoked via RPC by authenticated admin users; RLS on production_orders still applies via inner statements.
GRANT EXECUTE ON FUNCTION public.preview_cancel_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order_with_recovery(uuid) TO authenticated;

-- Triggers run as the function owner regardless of caller EXECUTE — no grant needed.
