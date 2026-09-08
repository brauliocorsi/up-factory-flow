CREATE TABLE IF NOT EXISTS public.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  file_hash text,
  rows_count integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'em_curso',
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.import_batches TO authenticated;
GRANT ALL ON public.import_batches TO service_role;

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "import_batches_select" ON public.import_batches;
CREATE POLICY "import_batches_select" ON public.import_batches
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));

DROP POLICY IF EXISTS "import_batches_insert" ON public.import_batches;
CREATE POLICY "import_batches_insert" ON public.import_batches
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio')));

DROP POLICY IF EXISTS "import_batches_update" ON public.import_batches;
CREATE POLICY "import_batches_update" ON public.import_batches
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

DROP TRIGGER IF EXISTS trg_import_batches_updated_at ON public.import_batches;
CREATE TRIGGER trg_import_batches_updated_at
  BEFORE UPDATE ON public.import_batches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();