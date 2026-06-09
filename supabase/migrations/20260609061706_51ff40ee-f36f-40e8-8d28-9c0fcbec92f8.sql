CREATE TABLE public.model_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id uuid NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  structure_type text,
  package_number int NOT NULL CHECK (package_number > 0),
  package_total int NOT NULL CHECK (package_total > 0),
  package_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_model_packages_model ON public.model_packages(model_id);
CREATE UNIQUE INDEX uq_model_packages_combo ON public.model_packages(model_id, COALESCE(structure_type, ''), package_number);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.model_packages TO authenticated;
GRANT ALL ON public.model_packages TO service_role;

ALTER TABLE public.model_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read model_packages"
  ON public.model_packages FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins insert model_packages"
  ON public.model_packages FOR INSERT
  TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update model_packages"
  ON public.model_packages FOR UPDATE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete model_packages"
  ON public.model_packages FOR DELETE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_model_packages_updated
  BEFORE UPDATE ON public.model_packages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed: 2 colis (Cabeceira, Ilhargas) por cada modelo existente sem colis definidos
INSERT INTO public.model_packages (model_id, package_number, package_total, package_name)
SELECT m.id, 1, 2, 'Cabeceira' FROM public.models m
WHERE NOT EXISTS (SELECT 1 FROM public.model_packages mp WHERE mp.model_id = m.id);

INSERT INTO public.model_packages (model_id, package_number, package_total, package_name)
SELECT m.id, 2, 2, 'Ilhargas' FROM public.models m
WHERE EXISTS (SELECT 1 FROM public.model_packages mp WHERE mp.model_id = m.id AND mp.package_number = 1)
  AND NOT EXISTS (SELECT 1 FROM public.model_packages mp WHERE mp.model_id = m.id AND mp.package_number = 2);