ALTER TABLE public.quality_checks
  ADD COLUMN IF NOT EXISTS family_code text,
  ADD COLUMN IF NOT EXISTS intent_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS quality_checks_intent_id_key
  ON public.quality_checks (intent_id) WHERE intent_id IS NOT NULL;