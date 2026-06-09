
-- SHELLS
CREATE TABLE public.shells (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  structure_code text,
  category_code text,
  quantity int NOT NULL DEFAULT 0,
  reserved int NOT NULL DEFAULT 0,
  min_quantity int NOT NULL DEFAULT 0,
  location text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shells TO authenticated;
GRANT ALL ON public.shells TO service_role;
ALTER TABLE public.shells ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read shells" ON public.shells FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin/escritorio write shells" ON public.shells FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'escritorio'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'escritorio'));

-- COVERS
CREATE TABLE public.covers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  model_code text,
  structure_code text,
  measure_code text,
  fabric_type_code text,
  fabric_ref_code text,
  color_code text,
  quantity int NOT NULL DEFAULT 0,
  reserved int NOT NULL DEFAULT 0,
  min_quantity int NOT NULL DEFAULT 0,
  location text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.covers TO authenticated;
GRANT ALL ON public.covers TO service_role;
ALTER TABLE public.covers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read covers" ON public.covers FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin/escritorio write covers" ON public.covers FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'escritorio'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'escritorio'));

-- FABRIC ROLLS
CREATE TABLE public.fabric_rolls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fabric_ref_code text,
  color_code text,
  name text NOT NULL,
  meters numeric NOT NULL DEFAULT 0,
  min_meters numeric NOT NULL DEFAULT 0,
  location text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fabric_rolls TO authenticated;
GRANT ALL ON public.fabric_rolls TO service_role;
ALTER TABLE public.fabric_rolls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read fabric_rolls" ON public.fabric_rolls FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin/escritorio write fabric_rolls" ON public.fabric_rolls FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'escritorio'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'escritorio'));

-- PRODUCT RECIPE
CREATE TABLE public.product_recipe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code text NOT NULL,
  model_code text NOT NULL,
  structure_code text NOT NULL,
  measure_code text NOT NULL,
  shell_id uuid REFERENCES public.shells(id) ON DELETE SET NULL,
  cover_required boolean NOT NULL DEFAULT true,
  meters_per_unit numeric,
  foam_description text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(category_code, model_code, structure_code, measure_code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_recipe TO authenticated;
GRANT ALL ON public.product_recipe TO service_role;
ALTER TABLE public.product_recipe ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read product_recipe" ON public.product_recipe FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin/escritorio write product_recipe" ON public.product_recipe FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'escritorio'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'escritorio'));

-- STOCK MOVEMENTS (audit log de ajustes manuais)
CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type text NOT NULL CHECK (item_type IN ('shell','cover','fabric')),
  item_id uuid NOT NULL,
  delta numeric NOT NULL,
  reason text,
  user_id uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.stock_movements TO authenticated;
GRANT ALL ON public.stock_movements TO service_role;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read movements" ON public.stock_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin/escritorio insert movements" ON public.stock_movements FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'escritorio'));

-- Production for stock: extend production_orders
ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS is_stock_production boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stock_item_type text CHECK (stock_item_type IN ('shell','cover')),
  ADD COLUMN IF NOT EXISTS stock_item_id uuid,
  ADD COLUMN IF NOT EXISTS stock_quantity int;

-- Updated_at triggers
CREATE TRIGGER shells_updated_at BEFORE UPDATE ON public.shells FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER covers_updated_at BEFORE UPDATE ON public.covers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER fabric_rolls_updated_at BEFORE UPDATE ON public.fabric_rolls FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER product_recipe_updated_at BEFORE UPDATE ON public.product_recipe FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
