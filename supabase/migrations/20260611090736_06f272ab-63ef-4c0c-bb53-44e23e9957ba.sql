CREATE OR REPLACE FUNCTION public.shell_needs_grouped()
 RETURNS TABLE(shell_id uuid, shell_code text, shell_name text, quantity integer, reserved integer, available integer, gross_need integer, net_need integer, waiting_orders jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH waiting AS (
    SELECT
      r.shell_id AS waiting_shell_id,
      po.id AS order_id,
      po.order_number,
      po.product_description,
      po.due_date AS order_due_date
    FROM public.production_orders po
    JOIN public.models m ON m.id = po.model_id
    JOIN public.product_recipe r
      ON r.model_code = m.code
     AND r.structure_code = po.structure_type
     AND r.measure_code = po.measure
    JOIN public.order_stages os
      ON os.order_id = po.id
     AND os.stage = 'estrutura'
     AND os.status <> 'concluida'
    WHERE po.status NOT IN ('cancelada','concluida')
      AND COALESCE(po.is_stock_production,false) = false
      AND r.shell_id IS NOT NULL
  ), grouped AS (
    SELECT
      w.waiting_shell_id,
      COUNT(*)::int AS gross,
      jsonb_agg(jsonb_build_object(
        'order_id', w.order_id,
        'order_number', w.order_number,
        'product_description', w.product_description,
        'exit_date', w.order_due_date
      ) ORDER BY w.order_due_date NULLS LAST, w.order_number) AS orders
    FROM waiting w
    GROUP BY w.waiting_shell_id
  )
  SELECT
    s.id AS shell_id,
    s.code AS shell_code,
    s.name AS shell_name,
    s.quantity::int AS quantity,
    COALESCE(s.reserved,0)::int AS reserved,
    GREATEST(0, s.quantity - COALESCE(s.reserved,0))::int AS available,
    COALESCE(g.gross,0)::int AS gross_need,
    GREATEST(0, COALESCE(g.gross,0) - GREATEST(0, s.quantity - COALESCE(s.reserved,0)))::int AS net_need,
    COALESCE(g.orders, '[]'::jsonb) AS waiting_orders
  FROM public.shells s
  LEFT JOIN grouped g ON g.waiting_shell_id = s.id
  WHERE COALESCE(g.gross,0) > 0
  ORDER BY GREATEST(0, COALESCE(g.gross,0) - GREATEST(0, s.quantity - COALESCE(s.reserved,0))) DESC, s.code;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_shell_batch(_batch_id uuid, _operator_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  FOR o IN
    SELECT po.id AS order_id, po.order_number
    FROM public.production_orders po
    JOIN public.models m ON m.id = po.model_id
    JOIN public.product_recipe r
      ON r.model_code = m.code
     AND r.structure_code = po.structure_type
     AND r.measure_code = po.measure
    JOIN public.order_stages os
      ON os.order_id = po.id AND os.stage = 'estrutura' AND os.status <> 'concluida'
    WHERE po.status NOT IN ('cancelada','concluida')
      AND COALESCE(po.is_stock_production,false) = false
      AND r.shell_id = v_batch.shell_id
    ORDER BY po.due_date NULLS LAST, po.created_at ASC
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
$function$;

GRANT EXECUTE ON FUNCTION public.shell_needs_grouped() TO authenticated;
GRANT EXECUTE ON FUNCTION public.shell_needs_grouped() TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_shell_batch(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_shell_batch(uuid, text) TO service_role;