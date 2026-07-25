ALTER TABLE public.ref_fabric_refs
  ADD COLUMN IF NOT EXISTS fabric_type_id uuid REFERENCES public.ref_fabric_types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ref_fabric_refs_fabric_type_id
  ON public.ref_fabric_refs(fabric_type_id);