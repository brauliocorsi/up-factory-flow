CREATE OR REPLACE FUNCTION public.shell_needs_grouped()
 RETURNS TABLE(shell_id uuid, shell_code text, shell_name text, quantity integer, reserved integer, available integer, gross_need integer, net_need integer, waiting_orders jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH waiting AS (
    SELECT
      r.shell_id,
      po.id AS order_id,
      po.order_number,
      po.product_description,
      po.due_date AS exit_date
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
    JOIN public.product_recipe r
      ON r.model_code = (SELECT code FROM public.models m WHERE m.id = po.model_id)
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