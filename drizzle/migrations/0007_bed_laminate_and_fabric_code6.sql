CREATE TABLE public.ref_laminates (
  code text PRIMARY KEY CHECK (code ~ '^L0[1-6]$'),
  name text NOT NULL,
  label text NOT NULL,
  synonyms text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.ref_laminates TO authenticated;
GRANT ALL ON public.ref_laminates TO service_role;
ALTER TABLE public.ref_laminates ENABLE ROW LEVEL SECURITY;
CREATE POLICY ref_laminates_read ON public.ref_laminates FOR SELECT TO authenticated USING (public.has_any_app_role(auth.uid()));
CREATE POLICY ref_laminates_insert ON public.ref_laminates FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));
CREATE POLICY ref_laminates_update ON public.ref_laminates FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));
INSERT INTO public.ref_laminates (code,name,label,synonyms) VALUES
 ('L01','Dourado','Laminado Dourado','{dourado,dourada,fita dourada,faixa dourada}'),
 ('L02','Prata','Laminado Prata','{prata,prateado,prateada}'),
 ('L03','Rose','Laminado Rose','{rose,ouro rose}'),
 ('L04','Bronze','Laminado Bronze','{bronze}'),
 ('L05','Espelho','Laminado Espelho','{espelho}'),
 ('L06','Inox','Laminado Inox','{inox}');

ALTER TABLE public.production_orders ADD COLUMN laminate_code text NULL REFERENCES public.ref_laminates(code);
ALTER TABLE public.production_orders ADD COLUMN code_status text NULL CHECK (code_status IS NULL OR code_status IN ('ok','por_normalizar','tecido_por_validar'));
ALTER TABLE public.models ADD COLUMN laminate_standard boolean NOT NULL DEFAULT false;
ALTER TABLE public.models ADD COLUMN retired boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.models.retired IS 'Número retirado: não usar em códigos novos. Mantido para histórico.';
ALTER TABLE public.fabric_catalog ADD COLUMN fabric_code6 text NULL UNIQUE CHECK (fabric_code6 IS NULL OR fabric_code6 ~ '^\d{6}$');
COMMENT ON COLUMN public.fabric_catalog.fabric_code6 IS '6 dígitos do tecido usados no código CAM (distinto de ref_tec). Sem valor = tecido por validar.';
COMMENT ON COLUMN public.production_orders.gc_code IS 'Código GestãoClick: CAM 18/21, PERCAM 21/24, SOF 18, SOM 17 ou EAN-13 (este fica por normalizar). Não único.';

CREATE OR REPLACE FUNCTION public.production_orders_code_status()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE c text := NULLIF(upper(btrim(NEW.gc_code)),''); f6 text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.gc_code IS NOT DISTINCT FROM OLD.gc_code THEN RETURN NEW; END IF;
  IF c IS NULL THEN NEW.code_status := NULL; RETURN NEW; END IF;
  IF c ~ '^(PER)?CAM\d{3}0[1-3]\d{3}\d{6}[NF](L0[1-6])?$' THEN
    f6 := substring(c from length(c) - (CASE WHEN c ~ 'L0[1-6]$' THEN 3 ELSE 0 END) - 6 for 6);
    NEW.code_status := CASE WHEN EXISTS (SELECT 1 FROM fabric_catalog WHERE fabric_code6 = f6) THEN 'ok' ELSE 'tecido_por_validar' END;
  ELSIF c ~ '^SOF[A-Z0-9]{15}$' OR c ~ '^SOM[A-Z0-9]{14}$' THEN
    NEW.code_status := 'ok';
  ELSE
    NEW.code_status := 'por_normalizar';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER production_orders_code_status_trg BEFORE INSERT OR UPDATE OF gc_code ON public.production_orders
FOR EACH ROW EXECUTE FUNCTION public.production_orders_code_status();