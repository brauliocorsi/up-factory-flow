CREATE TABLE public.model_structures (
  model_id uuid NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  structure_id uuid NOT NULL REFERENCES public.ref_structures(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (model_id, structure_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.model_structures TO authenticated;
GRANT ALL ON public.model_structures TO service_role;

ALTER TABLE public.model_structures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "model_structures_select_auth" ON public.model_structures
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "model_structures_write_admin" ON public.model_structures
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));

CREATE INDEX idx_model_structures_structure ON public.model_structures(structure_id);
CREATE INDEX idx_model_structures_model ON public.model_structures(model_id);