
-- Reference tables
CREATE TABLE public.ref_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ref_categories TO authenticated;
GRANT ALL ON public.ref_categories TO service_role;
ALTER TABLE public.ref_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read categories" ON public.ref_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage categories" ON public.ref_categories FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_ref_categories_updated BEFORE UPDATE ON public.ref_categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.ref_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ref_structures TO authenticated;
GRANT ALL ON public.ref_structures TO service_role;
ALTER TABLE public.ref_structures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read structures" ON public.ref_structures FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage structures" ON public.ref_structures FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_ref_structures_updated BEFORE UPDATE ON public.ref_structures FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.ref_measures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ref_measures TO authenticated;
GRANT ALL ON public.ref_measures TO service_role;
ALTER TABLE public.ref_measures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read measures" ON public.ref_measures FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage measures" ON public.ref_measures FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_ref_measures_updated BEFORE UPDATE ON public.ref_measures FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.ref_fabric_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ref_fabric_types TO authenticated;
GRANT ALL ON public.ref_fabric_types TO service_role;
ALTER TABLE public.ref_fabric_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read fabric_types" ON public.ref_fabric_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage fabric_types" ON public.ref_fabric_types FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_ref_fabric_types_updated BEFORE UPDATE ON public.ref_fabric_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.ref_fabric_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ref_fabric_refs TO authenticated;
GRANT ALL ON public.ref_fabric_refs TO service_role;
ALTER TABLE public.ref_fabric_refs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read fabric_refs" ON public.ref_fabric_refs FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage fabric_refs" ON public.ref_fabric_refs FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_ref_fabric_refs_updated BEFORE UPDATE ON public.ref_fabric_refs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.ref_colors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ref_colors TO authenticated;
GRANT ALL ON public.ref_colors TO service_role;
ALTER TABLE public.ref_colors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read colors" ON public.ref_colors FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage colors" ON public.ref_colors FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_ref_colors_updated BEFORE UPDATE ON public.ref_colors FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Extend existing models table with category link
ALTER TABLE public.models ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.ref_categories(id);
ALTER TABLE public.models ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS trg_models_updated ON public.models;
CREATE TRIGGER trg_models_updated BEFORE UPDATE ON public.models FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Add observation + finishing on production_orders
ALTER TABLE public.production_orders ADD COLUMN IF NOT EXISTS observation text;
ALTER TABLE public.production_orders ADD COLUMN IF NOT EXISTS finishing text CHECK (finishing IN ('F','N'));

-- Seed
INSERT INTO public.ref_categories (code,name) VALUES ('CAM','Cama'),('SOF','Sofá') ON CONFLICT (code) DO NOTHING;
INSERT INTO public.ref_structures (code,name) VALUES ('01','Simples'),('03','Alongada') ON CONFLICT (code) DO NOTHING;
INSERT INTO public.ref_measures (code,name) VALUES ('140','190x140'),('160','200x160'),('180','200x180') ON CONFLICT (code) DO NOTHING;
INSERT INTO public.ref_fabric_types (code,name) VALUES ('01','Aveludado'),('02','Microfibra') ON CONFLICT (code) DO NOTHING;
INSERT INTO public.ref_fabric_refs (code,name) VALUES ('01','Opera') ON CONFLICT (code) DO NOTHING;
INSERT INTO public.ref_colors (code,name) VALUES ('02','Bege') ON CONFLICT (code) DO NOTHING;

-- Seed models linked to CAM
INSERT INTO public.models (code,name,category_id)
SELECT '001','Armani', c.id FROM public.ref_categories c WHERE c.code='CAM'
ON CONFLICT (code) DO UPDATE SET category_id = EXCLUDED.category_id, name = EXCLUDED.name;
INSERT INTO public.models (code,name,category_id)
SELECT '009','Gomos', c.id FROM public.ref_categories c WHERE c.code='CAM'
ON CONFLICT (code) DO UPDATE SET category_id = EXCLUDED.category_id, name = EXCLUDED.name;
