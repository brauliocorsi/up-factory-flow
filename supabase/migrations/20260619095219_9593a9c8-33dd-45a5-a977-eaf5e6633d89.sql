
ALTER FUNCTION public.stage_order_index(production_stage) SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.find_matching_cover_state(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_expected_minutes(uuid, production_stage) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.scan_picking_coli(uuid, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_shell_batch_event(uuid, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.start_shell_batch(uuid, text, integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_order_route_keys(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_order_stage_from_colis(uuid, production_stage) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_coli_stage_event(uuid, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_order_colis(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_operator_only(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.order_stages_after_picagem_finished() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.order_stages_after_embalagem_finished() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.order_stages_after_complete_sla() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.production_orders_after_insert_colis() FROM anon, PUBLIC;

DROP POLICY IF EXISTS "auth write sla cat" ON public.stage_sla_category;
CREATE POLICY "admin write sla cat" ON public.stage_sla_category
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "auth write sla prod" ON public.stage_sla_product;
CREATE POLICY "admin write sla prod" ON public.stage_sla_product
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "auth write quality_checks" ON public.quality_checks;
CREATE POLICY "insert quality_checks" ON public.quality_checks
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.operators o WHERE o.user_id = auth.uid() AND o.id = operator_id)
    OR operator_id IS NULL
  );
CREATE POLICY "admin update quality_checks" ON public.quality_checks
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin delete quality_checks" ON public.quality_checks
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "auth write quality_check_items" ON public.quality_check_items;
CREATE POLICY "insert quality_check_items" ON public.quality_check_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.quality_checks qc
      JOIN public.operators o ON o.id = qc.operator_id
      WHERE qc.id = check_id AND o.user_id = auth.uid()
    )
  );
CREATE POLICY "admin update quality_check_items" ON public.quality_check_items
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin delete quality_check_items" ON public.quality_check_items
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "auth insert breaches" ON public.sla_breaches;
CREATE POLICY "admin insert breaches" ON public.sla_breaches
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin update breaches" ON public.sla_breaches
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin delete breaches" ON public.sla_breaches
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
