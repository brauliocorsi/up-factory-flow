ALTER POLICY "rework_events_write" ON public.rework_events WITH CHECK (public.has_any_app_role(auth.uid()));
ALTER POLICY "rework_events_update" ON public.rework_events USING (public.has_any_app_role(auth.uid())) WITH CHECK (public.has_any_app_role(auth.uid()));
ALTER POLICY "campanha leitura" ON public.stage_time_campaign TO authenticated USING (public.has_any_app_role(auth.uid()));
ALTER POLICY "auth read quality-photos" ON storage.objects USING (bucket_id = 'quality-photos' AND public.has_any_app_role(auth.uid()));
ALTER POLICY "auth upload quality-photos" ON storage.objects WITH CHECK (bucket_id = 'quality-photos' AND public.has_any_app_role(auth.uid()));