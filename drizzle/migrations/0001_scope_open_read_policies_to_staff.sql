CREATE OR REPLACE FUNCTION public.has_any_app_role(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
$$;
GRANT EXECUTE ON FUNCTION public.has_any_app_role(uuid) TO authenticated;

ALTER POLICY "authenticated read operators" ON public.operators USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "auth read order_coli_stages" ON public.order_coli_stages USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "read coli stages auth" ON public.structure_coli_stages USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "stage_day_assignment read auth" ON public.stage_day_assignment USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "auth read quality_checks" ON public.quality_checks USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "auth read breaches" ON public.sla_breaches USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "auth read sla prod" ON public.stage_sla_product USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "auth read quality_check_items" ON public.quality_check_items USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "shell_batch_logs read auth" ON public.shell_batch_logs USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "shell_batch_logs write auth" ON public.shell_batch_logs USING (public.has_any_app_role(auth.uid())) WITH CHECK (public.has_any_app_role(auth.uid()));
ALTER POLICY "stage_lead_offsets read auth" ON public.stage_lead_offsets USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "fabric_consumptions_select" ON public.fabric_consumptions USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "fabric_catalog_read" ON public.fabric_catalog USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "fabric_catalog_write" ON public.fabric_catalog
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));
ALTER POLICY "rework_events_read" ON public.rework_events USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "authenticated read operator_stages" ON public.operator_stages USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "picking_dispatches_read_auth" ON public.picking_dispatches USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "auth read order_colis" ON public.order_colis USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "auth read sla cat" ON public.stage_sla_category USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "shell_batches read auth" ON public.shell_batches USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "shell_batches write auth" ON public.shell_batches USING (public.has_any_app_role(auth.uid())) WITH CHECK (public.has_any_app_role(auth.uid()));
ALTER POLICY "authenticated read stage_time_logs" ON public.stage_time_logs USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "read routes auth" ON public.structure_coli_routes USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "authenticated read stages" ON public.order_stages USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "authenticated read orders" ON public.production_orders USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "auth read sla model" ON public.stage_sla_model USING (public.has_any_app_role(auth.uid()));