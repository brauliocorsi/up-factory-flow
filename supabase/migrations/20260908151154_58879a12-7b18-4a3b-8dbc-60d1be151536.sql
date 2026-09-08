DO $$
DECLARE t text;
  read_tables text[] := ARRAY[
    'models','ref_categories','ref_colors','ref_fabric_refs','ref_fabric_types',
    'ref_measures','ref_structures','quality_templates','quality_template_items',
    'model_packages','fabric_rolls','app_settings'
  ];
BEGIN
  FOREACH t IN ARRAY read_tables LOOP
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='block_operators') THEN
      EXECUTE format('DROP POLICY block_operators ON public.%I', t);
      EXECUTE format('CREATE POLICY block_operators_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT public.is_operator_only(auth.uid()))', t);
      EXECUTE format('CREATE POLICY block_operators_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_operator_only(auth.uid())) WITH CHECK (NOT public.is_operator_only(auth.uid()))', t);
      EXECUTE format('CREATE POLICY block_operators_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_operator_only(auth.uid()))', t);
    END IF;
  END LOOP;

  -- Picadores: apenas a configuração de identificação passa a ser legível
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='app_settings' AND policyname='block_pickers') THEN
    DROP POLICY block_pickers ON public.app_settings;
    CREATE POLICY block_pickers_insert ON public.app_settings AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (NOT public.is_picker_only(auth.uid()));
    CREATE POLICY block_pickers_update ON public.app_settings AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (NOT public.is_picker_only(auth.uid())) WITH CHECK (NOT public.is_picker_only(auth.uid()));
    CREATE POLICY block_pickers_delete ON public.app_settings AS RESTRICTIVE FOR DELETE TO authenticated
      USING (NOT public.is_picker_only(auth.uid()));
  END IF;
END $$;