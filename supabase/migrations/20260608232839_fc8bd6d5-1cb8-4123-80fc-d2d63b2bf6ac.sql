
CREATE TABLE public.import_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mapping jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX import_mappings_user_id_key ON public.import_mappings(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_mappings TO authenticated;
GRANT ALL ON public.import_mappings TO service_role;

ALTER TABLE public.import_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own mapping read" ON public.import_mappings
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own mapping insert" ON public.import_mappings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own mapping update" ON public.import_mappings
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own mapping delete" ON public.import_mappings
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_import_mappings_updated_at
  BEFORE UPDATE ON public.import_mappings
  FOR EACH ROW EXECUTE FUNCTION public.order_stages_before_update();
