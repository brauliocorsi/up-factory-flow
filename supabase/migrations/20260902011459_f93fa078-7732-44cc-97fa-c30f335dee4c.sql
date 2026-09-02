DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shells','covers','fabric_rolls','semi_finished_stock','finished_goods','stock_movements','picking_dispatches','order_colis','order_coli_stages','production_orders','order_stages','stage_time_logs','shell_batches','rework_events']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
  END LOOP;
END $$;