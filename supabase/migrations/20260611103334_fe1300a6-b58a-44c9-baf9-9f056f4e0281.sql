
-- =================================================================
-- PROMPT 12 — Qualidade por Templates + Embalagem + Stock Final
-- =================================================================

-- ---------- 1) Templates de qualidade ----------
CREATE TABLE public.quality_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quality_templates TO authenticated;
GRANT ALL ON public.quality_templates TO service_role;
ALTER TABLE public.quality_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read quality_templates" ON public.quality_templates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage quality_templates" ON public.quality_templates
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.quality_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.quality_templates(id) ON DELETE CASCADE,
  label text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_qti_template ON public.quality_template_items(template_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quality_template_items TO authenticated;
GRANT ALL ON public.quality_template_items TO service_role;
ALTER TABLE public.quality_template_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read quality_template_items" ON public.quality_template_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage quality_template_items" ON public.quality_template_items
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ---------- 2) Registo de conferências ----------
CREATE TABLE public.quality_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.quality_templates(id),
  operator_id uuid REFERENCES public.operators(id),
  result text NOT NULL CHECK (result IN ('aprovado','reprovado')),
  has_nok boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_qc_order ON public.quality_checks(order_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quality_checks TO authenticated;
GRANT ALL ON public.quality_checks TO service_role;
ALTER TABLE public.quality_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read quality_checks" ON public.quality_checks
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write quality_checks" ON public.quality_checks
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE TABLE public.quality_check_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id uuid NOT NULL REFERENCES public.quality_checks(id) ON DELETE CASCADE,
  template_item_id uuid REFERENCES public.quality_template_items(id),
  label text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok','nok')),
  photo_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_qci_check ON public.quality_check_items(check_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quality_check_items TO authenticated;
GRANT ALL ON public.quality_check_items TO service_role;
ALTER TABLE public.quality_check_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read quality_check_items" ON public.quality_check_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write quality_check_items" ON public.quality_check_items
  FOR INSERT TO authenticated WITH CHECK (true);

-- ---------- 3) Stock de produto final ----------
CREATE TABLE public.finished_goods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.production_orders(id),
  product_code text,
  barcode text,
  quantity int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'em_stock' CHECK (status IN ('em_stock','transferido')),
  ready_for_transfer boolean NOT NULL DEFAULT true,
  transferred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_fg_order ON public.finished_goods(order_id);
CREATE INDEX idx_fg_status ON public.finished_goods(status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finished_goods TO authenticated;
GRANT ALL ON public.finished_goods TO service_role;
ALTER TABLE public.finished_goods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read finished_goods" ON public.finished_goods
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth manage finished_goods" ON public.finished_goods
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------- 4) Trigger: Embalagem concluída → produto final ----------
CREATE OR REPLACE FUNCTION public.order_stages_after_embalagem_finished()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o RECORD;
  v_code text;
BEGIN
  IF NEW.stage <> 'embalagem' OR NEW.status <> 'concluida' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'concluida' THEN
    RETURN NEW; -- já estava concluída
  END IF;

  SELECT po.id, po.order_number, po.product_description, po.barcode,
         m.code AS model_code
    INTO o
  FROM public.production_orders po
  LEFT JOIN public.models m ON m.id = po.model_id
  WHERE po.id = NEW.order_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_code := COALESCE(o.model_code, o.product_description);

  -- Evitar duplicação
  IF NOT EXISTS (SELECT 1 FROM public.finished_goods WHERE order_id = o.id) THEN
    INSERT INTO public.finished_goods(order_id, product_code, barcode, quantity, status, ready_for_transfer)
    VALUES (o.id, v_code, o.barcode, 1, 'em_stock', true);

    INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
    VALUES ('finished_good', o.id, 1, 'Embalagem concluída - enc ' || o.order_number);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_stages_after_embalagem ON public.order_stages;
CREATE TRIGGER trg_order_stages_after_embalagem
AFTER UPDATE ON public.order_stages
FOR EACH ROW EXECUTE FUNCTION public.order_stages_after_embalagem_finished();

-- ---------- 5) Storage policies para fotos de qualidade ----------
CREATE POLICY "auth read quality-photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'quality-photos');

CREATE POLICY "auth upload quality-photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'quality-photos');

CREATE POLICY "auth delete own quality-photos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'quality-photos' AND owner = auth.uid());

-- ---------- 6) Seeds ----------
INSERT INTO public.quality_templates(id, category_code, name) VALUES
  (gen_random_uuid(), 'CAM', 'Conferência Cama'),
  (gen_random_uuid(), 'SOF', 'Conferência Sofá');

INSERT INTO public.quality_template_items(template_id, label, sort_order)
SELECT t.id, x.label, x.sort_order
FROM public.quality_templates t
CROSS JOIN LATERAL (
  VALUES
    ('Costura alinhada e sem falhas', 1),
    ('Sem manchas ou defeitos no tecido', 2),
    ('Espuma bem colada', 3),
    ('Estrutura firme', 4),
    ('Medidas corretas', 5),
    ('Acabamento limpo', 6),
    ('Etiqueta correta', 7)
) AS x(label, sort_order)
WHERE t.category_code = 'CAM';

INSERT INTO public.quality_template_items(template_id, label, sort_order)
SELECT t.id, x.label, x.sort_order
FROM public.quality_templates t
CROSS JOIN LATERAL (
  VALUES
    ('Costura alinhada e sem falhas', 1),
    ('Sem manchas ou defeitos no tecido', 2),
    ('Espuma confortável e bem distribuída', 3),
    ('Estrutura firme, sem ruídos', 4),
    ('Medidas corretas', 5),
    ('Pés/Apoios bem fixos', 6),
    ('Acabamento limpo', 7),
    ('Etiqueta correta', 8)
) AS x(label, sort_order)
WHERE t.category_code = 'SOF';

-- updated_at trigger
CREATE TRIGGER trg_quality_templates_updated_at
BEFORE UPDATE ON public.quality_templates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
