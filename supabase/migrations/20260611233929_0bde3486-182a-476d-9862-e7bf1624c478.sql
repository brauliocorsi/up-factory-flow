CREATE TABLE public.picking_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'enviado' CHECK (status IN ('enviado','erro','reenviado')),
  response_code integer,
  response_body text,
  operator_id uuid REFERENCES public.operators(id),
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX picking_dispatches_order_id_idx ON public.picking_dispatches(order_id);
CREATE INDEX picking_dispatches_batch_id_idx ON public.picking_dispatches(batch_id);

GRANT SELECT, INSERT, UPDATE ON public.picking_dispatches TO authenticated;
GRANT ALL ON public.picking_dispatches TO service_role;

ALTER TABLE public.picking_dispatches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "picking_dispatches_read_auth"
  ON public.picking_dispatches FOR SELECT TO authenticated USING (true);

CREATE POLICY "picking_dispatches_insert_auth"
  ON public.picking_dispatches FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "picking_dispatches_update_auth"
  ON public.picking_dispatches FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER set_picking_dispatches_updated_at
  BEFORE UPDATE ON public.picking_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();