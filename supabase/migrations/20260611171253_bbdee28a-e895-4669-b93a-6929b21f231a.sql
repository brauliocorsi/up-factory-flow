ALTER TABLE public.quality_templates ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS quality_templates_one_default ON public.quality_templates ((1)) WHERE is_default = true;

-- Seed um template-base genérico se nenhum default existir
DO $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.quality_templates WHERE is_default = true) THEN
    INSERT INTO public.quality_templates(category_code, name, active, is_default)
    VALUES ('GEN', 'Conferência Geral', true, true)
    RETURNING id INTO v_id;
    INSERT INTO public.quality_template_items(template_id, label, sort_order) VALUES
      (v_id, 'Aspeto geral sem defeitos visíveis', 1),
      (v_id, 'Costuras e acabamentos OK', 2),
      (v_id, 'Estrutura firme e estável', 3),
      (v_id, 'Limpeza e embalagem em condições', 4);
  END IF;
END $$;