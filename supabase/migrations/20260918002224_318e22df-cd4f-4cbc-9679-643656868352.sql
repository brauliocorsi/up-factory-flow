BEGIN;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS line_kind text NOT NULL DEFAULT 'catalogo',
  ADD COLUMN IF NOT EXISTS service_type text,
  ADD COLUMN IF NOT EXISTS customization text;

ALTER TABLE public.production_orders
  DROP CONSTRAINT IF EXISTS production_orders_line_kind_check;
ALTER TABLE public.production_orders
  ADD CONSTRAINT production_orders_line_kind_check
  CHECK (line_kind IN ('catalogo', 'livre'));

ALTER TABLE public.production_orders
  DROP CONSTRAINT IF EXISTS production_orders_service_type_check;
ALTER TABLE public.production_orders
  ADD CONSTRAINT production_orders_service_type_check
  CHECK (service_type IS NULL OR service_type IN ('assistencia','reparacao','servico','peca','porte','outro'));

-- Etapas: linhas livres só precisam de embalagem e picagem
CREATE OR REPLACE FUNCTION public.create_default_stages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.line_kind, 'catalogo') = 'livre' THEN
    INSERT INTO public.order_stages (order_id, stage)
    SELECT NEW.id, s::public.production_stage
    FROM unnest(ARRAY['embalagem','picagem']) AS s;
  ELSE
    INSERT INTO public.order_stages (order_id, stage)
    SELECT NEW.id, s::public.production_stage
    FROM unnest(ARRAY['estrutura','corte','costura','branco','estofagem','qualidade','embalagem','picagem']) AS s;
  END IF;
  RETURN NEW;
END;
$$;

-- Volumes: linhas livres não têm volumes de fabrico
CREATE OR REPLACE FUNCTION public.production_orders_after_insert_colis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.line_kind, 'catalogo') = 'livre' THEN
    RETURN NEW;
  END IF;
  PERFORM public.create_order_colis(NEW.id);
  RETURN NEW;
END;
$$;

-- Reservas de casco/capa: só para linhas de catálogo
CREATE OR REPLACE FUNCTION public.production_orders_after_insert_reserve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.line_kind, 'catalogo') = 'livre' THEN
    RETURN NEW;
  END IF;
  IF NOT COALESCE(NEW.is_stock_production, false) THEN
    PERFORM public.try_reserve_for_order(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

-- Validação estrutura=modelo: não se aplica a linhas livres
CREATE OR REPLACE FUNCTION public.production_orders_check_structure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_structure text;
  v_family text;
  v_name text;
BEGIN
  IF COALESCE(NEW.line_kind, 'catalogo') = 'livre' THEN
    RETURN NEW;
  END IF;
  IF NEW.model_id IS NULL OR NEW.structure_type IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT m.structure_code, m.sofa_family_code INTO v_structure, v_family
  FROM public.models m WHERE m.id = NEW.model_id;
  IF v_family IS NOT NULL THEN
    RETURN NEW; -- sofás: a família manda, não a estrutura
  END IF;
  IF v_structure IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT s.name INTO v_name FROM public.ref_structures s WHERE s.code = v_structure;
  IF v_name IS NOT NULL
     AND lower(btrim(NEW.structure_type)) <> lower(btrim(v_name))
     AND lower(btrim(NEW.structure_type)) <> lower(btrim(v_structure)) THEN
    RAISE EXCEPTION 'A estrutura "%" não corresponde à estrutura do modelo ("%").', NEW.structure_type, v_name;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.create_default_stages() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.production_orders_after_insert_colis() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.production_orders_after_insert_reserve() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.production_orders_check_structure() FROM PUBLIC;

COMMIT;