
ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_item_type_check;
ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_item_type_check
  CHECK (item_type = ANY (ARRAY['shell','cover','fabric','fabric_roll','finished_good']));
