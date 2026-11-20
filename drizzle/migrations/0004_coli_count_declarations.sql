CREATE TABLE public.coli_count_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id uuid NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  operator_id uuid,
  colis integer NOT NULL CHECK (colis BETWEEN 1 AND 20),
  names text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coli_count_declarations TO authenticated;
GRANT ALL ON public.coli_count_declarations TO service_role;
ALTER TABLE public.coli_count_declarations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own or office read coli decl" ON public.coli_count_declarations FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));
CREATE POLICY "staff insert own coli decl" ON public.coli_count_declarations FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.has_any_app_role(auth.uid()));
CREATE POLICY "own update coli decl" ON public.coli_count_declarations FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own or admin delete coli decl" ON public.coli_count_declarations FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));