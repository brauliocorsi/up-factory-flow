BEGIN;

-- ---------------------------------------------------------------
-- 0. unicidade de códigos nas tabelas de referência (idempotente)
-- ---------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ref_structures_code_key') THEN
    ALTER TABLE public.ref_structures ADD CONSTRAINT ref_structures_code_key UNIQUE (code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ref_fabric_types_code_key') THEN
    ALTER TABLE public.ref_fabric_types ADD CONSTRAINT ref_fabric_types_code_key UNIQUE (code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ref_colors_code_key') THEN
    ALTER TABLE public.ref_colors ADD CONSTRAINT ref_colors_code_key UNIQUE (code);
  END IF;
END $$;

-- ---------------------------------------------------------------
-- 1. famílias de sofá
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ref_sofa_families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ref_sofa_families TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.ref_sofa_families TO authenticated;
GRANT ALL ON public.ref_sofa_families TO service_role;
ALTER TABLE public.ref_sofa_families ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read sofa families" ON public.ref_sofa_families;
CREATE POLICY "read sofa families" ON public.ref_sofa_families
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "office manage sofa families" ON public.ref_sofa_families;
CREATE POLICY "office manage sofa families" ON public.ref_sofa_families
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'escritorio'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'escritorio'));

DROP TRIGGER IF EXISTS trg_ref_sofa_families_updated ON public.ref_sofa_families;
CREATE TRIGGER trg_ref_sofa_families_updated BEFORE UPDATE ON public.ref_sofa_families
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.ref_sofa_families (code, name) VALUES
  ('01', 'Simples'), ('02', 'Deslizante'), ('03', 'Sofá-Cama')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, active = true;

-- ---------------------------------------------------------------
-- 2. modelos: estrutura fixa / família de sofá + nomes limpos
-- ---------------------------------------------------------------
ALTER TABLE public.models
  ADD COLUMN IF NOT EXISTS structure_code text,
  ADD COLUMN IF NOT EXISTS sofa_family_code text;

-- estrutura derivada do sufixo do nome; fallback pela gama do código
UPDATE public.models m
SET structure_code = COALESCE(
  (SELECT s.code FROM public.ref_structures s
    WHERE m.name ILIKE '% ' || s.name),
  CASE left(m.code, 1) WHEN '0' THEN '01' WHEN '1' THEN '02' WHEN '2' THEN '03' WHEN '3' THEN '04' END
)
WHERE m.structure_code IS NULL;

-- nomes sem o sufixo de estrutura repetido
UPDATE public.models m
SET name = btrim(regexp_replace(m.name, '\s+(Simples|Coxim|Alongada|Especial)$', '', 'i'))
WHERE m.name ~* '\s+(Simples|Coxim|Alongada|Especial)$'
  AND btrim(regexp_replace(m.name, '\s+(Simples|Coxim|Alongada|Especial)$', '', 'i')) <> '';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'models_structure_code_fkey') THEN
    ALTER TABLE public.models ADD CONSTRAINT models_structure_code_fkey
      FOREIGN KEY (structure_code) REFERENCES public.ref_structures(code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'models_sofa_family_code_fkey') THEN
    ALTER TABLE public.models ADD CONSTRAINT models_sofa_family_code_fkey
      FOREIGN KEY (sofa_family_code) REFERENCES public.ref_sofa_families(code);
  END IF;
  -- código único por categoria (sofás reutilizam a gama 001-299)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'models_code_key') THEN
    ALTER TABLE public.models DROP CONSTRAINT models_code_key;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'models_category_code_key') THEN
    ALTER TABLE public.models ADD CONSTRAINT models_category_code_key UNIQUE (category_id, code);
  END IF;
END $$;

-- coerência: cama tem estrutura, sofá tem família
CREATE OR REPLACE FUNCTION public.models_check_family()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE cat text;
BEGIN
  SELECT c.code INTO cat FROM public.ref_categories c WHERE c.id = NEW.category_id;
  IF cat = 'SOF' THEN
    IF NEW.sofa_family_code IS NULL THEN
      RAISE EXCEPTION 'Modelo de sofá precisa de família (01 Simples, 02 Deslizante, 03 Sofá-Cama).';
    END IF;
    NEW.structure_code := NULL;
  ELSE
    IF NEW.structure_code IS NULL THEN
      RAISE EXCEPTION 'Modelo precisa de estrutura fixa (ref_structures.code).';
    END IF;
    NEW.sofa_family_code := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_models_check_family ON public.models;
CREATE TRIGGER trg_models_check_family BEFORE INSERT OR UPDATE ON public.models
  FOR EACH ROW EXECUTE FUNCTION public.models_check_family();

-- ---------------------------------------------------------------
-- 3. coleções: tipo obrigatório e limpeza por desativação
-- ---------------------------------------------------------------
ALTER TABLE public.ref_fabric_refs ADD COLUMN IF NOT EXISTS fabric_type_code text;

UPDATE public.ref_fabric_refs r
SET fabric_type_code = t.code
FROM public.ref_fabric_types t
WHERE r.fabric_type_id = t.id AND r.fabric_type_code IS NULL;

-- tipos das 21 coleções que ficam ativas
UPDATE public.ref_fabric_refs SET fabric_type_code = '01'
  WHERE code IN ('01','02','03','06','07','10','11','12','13','14','17','18','20','29');
UPDATE public.ref_fabric_refs SET fabric_type_code = '02'
  WHERE code IN ('26','28','31','36','40','23');
UPDATE public.ref_fabric_refs SET fabric_type_code = '03'
  WHERE code IN ('42');

-- coleções que saem do catálogo (inclui duplicados Venus/Quinnes). Nada é apagado.
UPDATE public.ref_fabric_refs SET active = false
  WHERE code IN ('05','44','43','25','35','22','34','38','27','30','24','45','21','39','41','04','15','16','32','33','46','08','19','37');

-- qualquer coleção ativa sem tipo atribuído fica também inativa
UPDATE public.ref_fabric_refs SET active = false
  WHERE active = true AND fabric_type_code IS NULL;

-- manter fabric_type_id em sincronia com o código
CREATE OR REPLACE FUNCTION public.ref_fabric_refs_sync_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.fabric_type_code IS NOT NULL THEN
    SELECT t.id INTO NEW.fabric_type_id FROM public.ref_fabric_types t WHERE t.code = NEW.fabric_type_code;
  ELSIF NEW.fabric_type_id IS NOT NULL THEN
    SELECT t.code INTO NEW.fabric_type_code FROM public.ref_fabric_types t WHERE t.id = NEW.fabric_type_id;
  END IF;
  IF NEW.active AND NEW.fabric_type_code IS NULL THEN
    RAISE EXCEPTION 'Coleção ativa precisa de tipo de tecido.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ref_fabric_refs_sync_type ON public.ref_fabric_refs;
CREATE TRIGGER trg_ref_fabric_refs_sync_type BEFORE INSERT OR UPDATE ON public.ref_fabric_refs
  FOR EACH ROW EXECUTE FUNCTION public.ref_fabric_refs_sync_type();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ref_fabric_refs_fabric_type_code_fkey') THEN
    ALTER TABLE public.ref_fabric_refs ADD CONSTRAINT ref_fabric_refs_fabric_type_code_fkey
      FOREIGN KEY (fabric_type_code) REFERENCES public.ref_fabric_types(code);
  END IF;
END $$;

-- ---------------------------------------------------------------
-- 4. tecidos concretos (ref_tec)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fabrics (
  ref_tec text PRIMARY KEY,
  fabric_type_code text NOT NULL REFERENCES public.ref_fabric_types(code),
  fabric_ref_code text NOT NULL REFERENCES public.ref_fabric_refs(code),
  supplier_ref text NOT NULL,
  color_code text REFERENCES public.ref_colors(code),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fabrics_ref_tec_format CHECK (ref_tec ~ '^TEC[0-9]{6}$')
);

GRANT SELECT ON public.fabrics TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.fabrics TO authenticated;
GRANT ALL ON public.fabrics TO service_role;
ALTER TABLE public.fabrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read fabrics" ON public.fabrics;
CREATE POLICY "read fabrics" ON public.fabrics FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "office manage fabrics" ON public.fabrics;
CREATE POLICY "office manage fabrics" ON public.fabrics
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'escritorio'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'escritorio'));

DROP TRIGGER IF EXISTS trg_fabrics_updated ON public.fabrics;
CREATE TRIGGER trg_fabrics_updated BEFORE UPDATE ON public.fabrics
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ref_tec = TEC + tipo(2) + coleção(2) + sequência(2), sequência por coleção
CREATE OR REPLACE FUNCTION public.fabrics_prepare()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE seq int; expected text;
BEGIN
  IF NEW.fabric_type_code IS NULL THEN
    SELECT r.fabric_type_code INTO NEW.fabric_type_code
      FROM public.ref_fabric_refs r WHERE r.code = NEW.fabric_ref_code;
  END IF;
  IF NEW.fabric_type_code <> (SELECT r.fabric_type_code FROM public.ref_fabric_refs r WHERE r.code = NEW.fabric_ref_code) THEN
    RAISE EXCEPTION 'A coleção % não pertence ao tipo de tecido %.', NEW.fabric_ref_code, NEW.fabric_type_code;
  END IF;
  IF NEW.ref_tec IS NULL OR NEW.ref_tec = '' THEN
    SELECT COALESCE(MAX(substring(f.ref_tec from 8 for 2)::int), 0) + 1 INTO seq
      FROM public.fabrics f WHERE f.fabric_ref_code = NEW.fabric_ref_code;
    IF seq > 99 THEN
      RAISE EXCEPTION 'Sequência esgotada para a coleção %.', NEW.fabric_ref_code;
    END IF;
    NEW.ref_tec := 'TEC' || lpad(NEW.fabric_type_code, 2, '0') || lpad(NEW.fabric_ref_code, 2, '0') || lpad(seq::text, 2, '0');
  ELSE
    expected := 'TEC' || lpad(NEW.fabric_type_code, 2, '0') || lpad(NEW.fabric_ref_code, 2, '0');
    IF left(NEW.ref_tec, 7) <> expected THEN
      RAISE EXCEPTION 'Referência % não corresponde ao tipo/coleção (esperado %xx).', NEW.ref_tec, expected;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fabrics_prepare ON public.fabrics;
CREATE TRIGGER trg_fabrics_prepare BEFORE INSERT OR UPDATE ON public.fabrics
  FOR EACH ROW EXECUTE FUNCTION public.fabrics_prepare();

-- ---------------------------------------------------------------
-- 5. encomendas: tecido concreto + coerência modelo/estrutura
-- ---------------------------------------------------------------
ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS ref_tec text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_orders_ref_tec_fkey') THEN
    ALTER TABLE public.production_orders ADD CONSTRAINT production_orders_ref_tec_fkey
      FOREIGN KEY (ref_tec) REFERENCES public.fabrics(ref_tec);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.production_orders_check_structure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE m_struct text; s_name text;
BEGIN
  IF NEW.model_id IS NULL OR NEW.structure_type IS NULL OR btrim(NEW.structure_type) = '' THEN
    RETURN NEW;
  END IF;
  SELECT m.structure_code INTO m_struct FROM public.models m WHERE m.id = NEW.model_id;
  IF m_struct IS NULL THEN
    RETURN NEW; -- modelo de sofá: estrutura não se aplica
  END IF;
  SELECT s.name INTO s_name FROM public.ref_structures s WHERE s.code = m_struct;
  IF lower(btrim(NEW.structure_type)) NOT IN (lower(m_struct), lower(COALESCE(s_name, ''))) THEN
    RAISE EXCEPTION 'A estrutura "%" não corresponde à estrutura do modelo (%).', NEW.structure_type, COALESCE(s_name, m_struct);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_production_orders_check_structure ON public.production_orders;
CREATE TRIGGER trg_production_orders_check_structure BEFORE INSERT OR UPDATE ON public.production_orders
  FOR EACH ROW EXECUTE FUNCTION public.production_orders_check_structure();

REVOKE ALL ON FUNCTION public.models_check_family() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.ref_fabric_refs_sync_type() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.fabrics_prepare() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.production_orders_check_structure() FROM anon, authenticated;

COMMIT;