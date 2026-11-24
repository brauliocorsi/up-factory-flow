DROP POLICY IF EXISTS "auth read quality_template_items" ON public.quality_template_items;
CREATE POLICY "auth read quality_template_items" ON public.quality_template_items FOR SELECT TO authenticated USING (public.has_any_app_role(auth.uid()));
DROP POLICY IF EXISTS "auth read quality_templates" ON public.quality_templates;
CREATE POLICY "auth read quality_templates" ON public.quality_templates FOR SELECT TO authenticated USING (public.has_any_app_role(auth.uid()));