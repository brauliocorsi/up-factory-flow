
-- 1) shell_batches
CREATE TABLE public.shell_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shell_id uuid REFERENCES public.shells(id) ON DELETE SET NULL,
  operator_id uuid REFERENCES public.operators(id) ON DELETE SET NULL,
  quantity int NOT NULL CHECK (quantity > 0),
  assigned_to_orders int NOT NULL DEFAULT 0,
  added_to_stock int NOT NULL DEFAULT 0,
  productive_seconds int NOT NULL DEFAULT 0,
  paused_seconds int NOT NULL DEFAULT 0,
  seconds_per_unit numeric,
  is_paused boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'em_curso',  -- em_curso | concluido
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shell_batches TO authenticated;
GRANT ALL ON public.shell_batches TO service_role;
ALTER TABLE public.shell_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shell_batches read auth" ON public.shell_batches FOR SELECT TO authenticated USING (true);
CREATE POLICY "shell_batches write auth" ON public.shell_batches FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER shell_batches_set_updated_at
BEFORE UPDATE ON public.shell_batches
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) shell_batch_logs (eventos de tempo do lote)
CREATE TABLE public.shell_batch_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.shell_batches(id) ON DELETE CASCADE,
  operator_id uuid REFERENCES public.operators(id) ON DELETE SET NULL,
  event text NOT NULL CHECK (event IN ('iniciar','pausar','retomar','finalizar')),
  event_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shell_batch_logs TO authenticated;
GRANT ALL ON public.shell_batch_logs TO service_role;
ALTER TABLE public.shell_batch_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shell_batch_logs read auth" ON public.shell_batch_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "shell_batch_logs write auth" ON public.shell_batch_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3) production_mode em order_stages (distinção individual vs lote nos relatórios)
ALTER TABLE public.order_stages
  ADD COLUMN IF NOT EXISTS production_mode text NOT NULL DEFAULT 'individual';

-- 4) Realtime para as novas tabelas e shells/order_stages (caso ainda não estejam)
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.shell_batches; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.shell_batch_logs; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- 5) shell_needs_grouped: necessidade agrupada por casco
CREATE OR REPLACE FUNCTION public.shell_needs_grouped()
RETURNS TABLE(
  shell_id uuid,
  shell_code text,
  shell_name text,
  quantity int,
  reserved int,
  available int,
  gross_need int,
  net_need int,
  waiting_orders jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH waiting AS (
    SELECT
      r.shell_id,
      po.id AS order_id,
      po.order_number,
      po.product_description,
      po.exit_date
    FROM public.production_orders po
    JOIN public.product_recipe r
      ON r.model_code = (SELECT code FROM public.models m WHERE m.id = po.model_id)
     AND r.structure_code = po.structure_type
     AND r.measure_code = po.measure
    JOIN public.order_stages os
      ON os.order_id = po.id AND os.stage = 'estrutura' AND os.status <> 'concluida'
    WHERE po.status NOT IN ('cancelada','concluida')
      AND COALESCE(po.is_stock_production,false) = false
      AND r.shell_id IS NOT NULL
  )
  SELECT
    s.id,
    s.code,
    s.name,
    s.quantity::int,
    COALESCE(s.reserved,0)::int,
    GREATEST(0, s.quantity - COALESCE(s.reserved,0))::int AS available,
    COALESCE(w.gross,0)::int AS gross_need,
    GREATEST(0, COALESCE(w.gross,0) - GREATEST(0, s.quantity - COALESCE(s.reserved,0)))::int AS net_need,
    COALESCE(w.orders, '[]'::jsonb) AS waiting_orders
  FROM public.shells s
  LEFT JOIN (
    SELECT
      shell_id,
      COUNT(*)::int AS gross,
      jsonb_agg(jsonb_build_object(
        'order_id', order_id,
        'order_number', order_number,
        'product_description', product_description,
        'exit_date', exit_date
      ) ORDER BY exit_date NULLS LAST) AS orders
    FROM waiting
    GROUP BY shell_id
  ) w ON w.shell_id = s.id
  WHERE COALESCE(w.gross,0) > 0
  ORDER BY GREATEST(0, COALESCE(w.gross,0) - GREATEST(0, s.quantity - COALESCE(s.reserved,0))) DESC, s.code;
END;
$$;

-- 6) start_shell_batch
CREATE OR REPLACE FUNCTION public.start_shell_batch(
  _shell_id uuid,
  _operator_code text,
  _quantity int
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op public.operators;
  v_linked boolean;
  v_batch_id uuid;
BEGIN
  IF _quantity IS NULL OR _quantity < 1 THEN
    RAISE EXCEPTION 'Quantidade inválida';
  END IF;

  SELECT * INTO v_op FROM public.operators WHERE code = _operator_code AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operador "%" não encontrado ou inativo', _operator_code; END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.operator_stages
    WHERE operator_id = v_op.id AND stage IN ('estrutura','branco')
  ) INTO v_linked;
  IF NOT v_linked THEN
    RAISE EXCEPTION 'O operador % não está atribuído às etapas de estrutura/branco', v_op.code;
  END IF;

  INSERT INTO public.shell_batches(shell_id, operator_id, quantity, status, started_at)
  VALUES (_shell_id, v_op.id, _quantity, 'em_curso', now())
  RETURNING id INTO v_batch_id;

  INSERT INTO public.shell_batch_logs(batch_id, operator_id, event) VALUES (v_batch_id, v_op.id, 'iniciar');
  RETURN v_batch_id;
END;
$$;

-- 7) record_shell_batch_event (pausar/retomar)
CREATE OR REPLACE FUNCTION public.record_shell_batch_event(
  _batch_id uuid,
  _operator_code text,
  _event text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op public.operators;
  v_batch public.shell_batches;
  v_prod int := 0;
  v_pause int := 0;
  v_last_ts timestamptz;
  v_last_event text;
  v_is_paused boolean := false;
  rec RECORD;
BEGIN
  IF _event NOT IN ('pausar','retomar') THEN
    RAISE EXCEPTION 'Evento inválido para record_shell_batch_event: %', _event;
  END IF;

  SELECT * INTO v_op FROM public.operators WHERE code = _operator_code AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operador "%" não encontrado', _operator_code; END IF;

  SELECT * INTO v_batch FROM public.shell_batches WHERE id = _batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote não encontrado'; END IF;
  IF v_batch.status = 'concluido' THEN RAISE EXCEPTION 'Lote já concluído'; END IF;

  IF _event = 'pausar' AND v_batch.is_paused THEN RAISE EXCEPTION 'Lote já em pausa'; END IF;
  IF _event = 'retomar' AND NOT v_batch.is_paused THEN RAISE EXCEPTION 'Lote não está em pausa'; END IF;

  INSERT INTO public.shell_batch_logs(batch_id, operator_id, event) VALUES (_batch_id, v_op.id, _event);

  v_last_ts := NULL; v_last_event := NULL;
  FOR rec IN SELECT event, event_at FROM public.shell_batch_logs WHERE batch_id = _batch_id ORDER BY event_at ASC LOOP
    IF v_last_event IN ('iniciar','retomar') AND rec.event IN ('pausar','finalizar') THEN
      v_prod := v_prod + GREATEST(0, EXTRACT(EPOCH FROM (rec.event_at - v_last_ts))::int);
    ELSIF v_last_event = 'pausar' AND rec.event IN ('retomar','finalizar') THEN
      v_pause := v_pause + GREATEST(0, EXTRACT(EPOCH FROM (rec.event_at - v_last_ts))::int);
    END IF;
    v_last_event := rec.event; v_last_ts := rec.event_at;
  END LOOP;
  v_is_paused := (v_last_event = 'pausar');

  UPDATE public.shell_batches SET
    productive_seconds = v_prod,
    paused_seconds = v_pause,
    is_paused = v_is_paused
  WHERE id = _batch_id;

  RETURN jsonb_build_object('ok', true, 'productive_seconds', v_prod, 'paused_seconds', v_pause, 'is_paused', v_is_paused);
END;
$$;

-- 8) finalize_shell_batch: atribui às encomendas à espera (por urgência) e excedente vai a stock
CREATE OR REPLACE FUNCTION public.finalize_shell_batch(
  _batch_id uuid,
  _operator_code text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op public.operators;
  v_batch public.shell_batches;
  v_prod int := 0;
  v_pause int := 0;
  v_last_ts timestamptz;
  v_last_event text;
  rec RECORD;
  v_assigned int := 0;
  v_to_stock int := 0;
  v_remaining int;
  o RECORD;
BEGIN
  SELECT * INTO v_op FROM public.operators WHERE code = _operator_code AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operador "%" não encontrado', _operator_code; END IF;

  SELECT * INTO v_batch FROM public.shell_batches WHERE id = _batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote não encontrado'; END IF;
  IF v_batch.status = 'concluido' THEN RAISE EXCEPTION 'Lote já concluído'; END IF;

  INSERT INTO public.shell_batch_logs(batch_id, operator_id, event) VALUES (_batch_id, v_op.id, 'finalizar');

  -- Recalcular tempos
  v_last_ts := NULL; v_last_event := NULL;
  FOR rec IN SELECT event, event_at FROM public.shell_batch_logs WHERE batch_id = _batch_id ORDER BY event_at ASC LOOP
    IF v_last_event IN ('iniciar','retomar') AND rec.event IN ('pausar','finalizar') THEN
      v_prod := v_prod + GREATEST(0, EXTRACT(EPOCH FROM (rec.event_at - v_last_ts))::int);
    ELSIF v_last_event = 'pausar' AND rec.event IN ('retomar','finalizar') THEN
      v_pause := v_pause + GREATEST(0, EXTRACT(EPOCH FROM (rec.event_at - v_last_ts))::int);
    END IF;
    v_last_event := rec.event; v_last_ts := rec.event_at;
  END LOOP;

  v_remaining := v_batch.quantity;

  -- Atribuir às encomendas à espera, por urgência (exit_date)
  FOR o IN
    SELECT po.id AS order_id, po.order_number
    FROM public.production_orders po
    JOIN public.product_recipe r
      ON r.model_code = (SELECT code FROM public.models m WHERE m.id = po.model_id)
     AND r.structure_code = po.structure_type
     AND r.measure_code = po.measure
    JOIN public.order_stages os
      ON os.order_id = po.id AND os.stage = 'estrutura' AND os.status <> 'concluida'
    WHERE po.status NOT IN ('cancelada','concluida')
      AND COALESCE(po.is_stock_production,false) = false
      AND r.shell_id = v_batch.shell_id
    ORDER BY po.exit_date NULLS LAST, po.created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    UPDATE public.order_stages
      SET status = 'concluida', finished_at = now(), check_valid = true,
          operator_id = v_op.id,
          production_mode = 'lote',
          notes = 'Produzido em lote ' || _batch_id::text
      WHERE order_id = o.order_id AND stage IN ('estrutura','branco') AND status <> 'concluida';
    v_assigned := v_assigned + 1;
    v_remaining := v_remaining - 1;
  END LOOP;

  -- O que sobrou vai para stock
  v_to_stock := v_remaining;
  IF v_to_stock > 0 AND v_batch.shell_id IS NOT NULL THEN
    UPDATE public.shells SET quantity = quantity + v_to_stock WHERE id = v_batch.shell_id;
    INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
      VALUES ('shell', v_batch.shell_id, v_to_stock, 'Excedente lote ' || _batch_id::text);
  END IF;

  UPDATE public.shell_batches SET
    productive_seconds = v_prod,
    paused_seconds = v_pause,
    is_paused = false,
    status = 'concluido',
    finished_at = now(),
    assigned_to_orders = v_assigned,
    added_to_stock = v_to_stock,
    seconds_per_unit = CASE WHEN v_batch.quantity > 0 THEN (v_prod::numeric / v_batch.quantity) ELSE NULL END
  WHERE id = _batch_id;

  RETURN jsonb_build_object(
    'ok', true,
    'assigned_to_orders', v_assigned,
    'added_to_stock', v_to_stock,
    'productive_seconds', v_prod,
    'paused_seconds', v_pause
  );
END;
$$;
