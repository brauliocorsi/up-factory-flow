DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ref_categories','ref_structures','ref_measures','ref_fabric_types','ref_fabric_refs','ref_colors',
    'models','model_packages','operators','import_mappings',
    'production_orders','order_stages',
    'shells','covers','fabric_rolls','product_recipe','stock_movements','semi_finished_stock',
    'user_roles'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;