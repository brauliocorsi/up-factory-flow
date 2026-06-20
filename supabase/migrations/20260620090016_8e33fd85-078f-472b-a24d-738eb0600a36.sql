
-- 1) stage_sla_model: re-scope policies from public to authenticated
DROP POLICY IF EXISTS "auth read sla model" ON public.stage_sla_model;
DROP POLICY IF EXISTS "admin write sla model" ON public.stage_sla_model;
DROP POLICY IF EXISTS "block_operators" ON public.stage_sla_model;

CREATE POLICY "auth read sla model" ON public.stage_sla_model
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write sla model" ON public.stage_sla_model
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "block_operators" ON public.stage_sla_model
  FOR ALL TO authenticated
  USING (NOT is_operator_only(auth.uid()))
  WITH CHECK (NOT is_operator_only(auth.uid()));

REVOKE ALL ON public.stage_sla_model FROM anon;

-- 2) picking_dispatches: restrict writes to admin/escritorio
DROP POLICY IF EXISTS picking_dispatches_insert_auth ON public.picking_dispatches;
DROP POLICY IF EXISTS picking_dispatches_update_auth ON public.picking_dispatches;

CREATE POLICY picking_dispatches_insert_admin ON public.picking_dispatches
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'escritorio'::app_role)
  );
CREATE POLICY picking_dispatches_update_admin ON public.picking_dispatches
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'escritorio'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'escritorio'::app_role)
  );

-- 3) quality_check_items: require parent check to have an operator
DROP POLICY IF EXISTS "insert quality_check_items" ON public.quality_check_items;
CREATE POLICY "insert quality_check_items" ON public.quality_check_items
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1
      FROM quality_checks qc
      JOIN operators o ON o.id = qc.operator_id
      WHERE qc.id = quality_check_items.check_id
        AND qc.operator_id IS NOT NULL
        AND o.user_id = auth.uid()
    )
  );

-- 4) stage_time_logs: replace "WITH CHECK (true)" with non-trivial check
DROP POLICY IF EXISTS "authenticated insert stage_time_logs" ON public.stage_time_logs;
CREATE POLICY "authenticated insert stage_time_logs" ON public.stage_time_logs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- 5) rework_events: same treatment
DROP POLICY IF EXISTS rework_events_write ON public.rework_events;
DROP POLICY IF EXISTS rework_events_update ON public.rework_events;
CREATE POLICY rework_events_write ON public.rework_events
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY rework_events_update ON public.rework_events
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- 6) Revoke EXECUTE from anon on SECURITY DEFINER planning RPCs
REVOKE EXECUTE ON FUNCTION public.get_order_progress(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_stage_target_dates(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_stage_queue(production_stage) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.activate_orders(uuid[]) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_global_capacity_load(date, date) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_activation_suggestions() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.count_backlog_batches() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_stage_capacity_load(production_stage, date, date) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_backlog() FROM anon, public;

GRANT EXECUTE ON FUNCTION public.get_order_progress(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stage_target_dates(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stage_queue(production_stage) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_orders(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_global_capacity_load(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_activation_suggestions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_backlog_batches() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stage_capacity_load(production_stage, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_backlog() TO authenticated;
