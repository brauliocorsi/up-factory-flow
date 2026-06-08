
DROP TRIGGER IF EXISTS trg_import_mappings_updated_at ON public.import_mappings;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_import_mappings_updated_at
  BEFORE UPDATE ON public.import_mappings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
