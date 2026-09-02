CREATE OR REPLACE FUNCTION public.cancel_order_with_recovery_impl(_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  o RECORD;
  prev jsonb;
  rec public.product_recipe;
  v_shell_state text;
  v_cover_state text;
  v_existing_id uuid;
  v_new_id uuid;
  v_model_code text;
  v_product_code text;
BEGIN
  SELECT * INTO o FROM public.production_orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Encomenda não encontrada'; END IF;
  IF o.status = 'cancelada' THEN RAISE EXCEPTION 'Encomenda já cancelada'; END IF;

  prev := public.preview_cancel_order(_order_id);
  rec := public.resolve_order_recipe(_order_id);

  IF (prev->>'shell_reserved_to_release')::boolean AND o.reserved_shell_id IS NOT NULL THEN
    UPDATE public.shells SET reserved = GREATEST(0, COALESCE(reserved,0) - 1)
     WHERE id = o.reserved_shell_id;
    INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
      VALUES ('shell', o.reserved_shell_id, 0,
              'Libertação de reserva ['||COALESCE(o.reserved_shell_state,'?')||'] - cancelamento enc ' || o.order_number);
    UPDATE public.production_orders SET reserved_shell_id = NULL WHERE id = o.id;
  END IF;

  IF (prev->>'cover_reserved_to_release')::boolean AND o.reserved_cover_id IS NOT NULL THEN
    UPDATE public.covers SET reserved = GREATEST(0, COALESCE(reserved,0) - 1)
     WHERE id = o.reserved_cover_id;
    INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
      VALUES ('cover', o.reserved_cover_id, 0,
              'Libertação de reserva ['||COALESCE(o.reserved_cover_state,'?')||'] - cancelamento enc ' || o.order_number);
    UPDATE public.production_orders SET reserved_cover_id = NULL WHERE id = o.id;
  END IF;

  IF (prev->>'becomes_finished_good')::boolean THEN
    SELECT code INTO v_model_code FROM public.models WHERE id = o.model_id;
    v_product_code := COALESCE(v_model_code, o.product_description);
    IF NOT EXISTS (SELECT 1 FROM public.finished_goods WHERE order_id = o.id) THEN
      INSERT INTO public.finished_goods(order_id, product_code, barcode, quantity, status, ready_for_transfer)
      VALUES (o.id, v_product_code, o.barcode, 1, 'em_stock', true);
      INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
        VALUES ('finished_good', o.id, 1, 'Produto final por cancelamento pós-estofo - enc ' || o.order_number);
    END IF;
  ELSE
    v_shell_state := prev->>'shell_recover_state';
    IF v_shell_state IS NOT NULL AND rec.shell_id IS NOT NULL THEN
      SELECT id INTO v_existing_id FROM public.shells
        WHERE id = rec.shell_id AND state = v_shell_state LIMIT 1;
      IF v_existing_id IS NOT NULL THEN
        UPDATE public.shells SET quantity = quantity + 1 WHERE id = v_existing_id;
        INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
          VALUES ('shell', v_existing_id, 1,
                  'Recuperado de cancelamento ['||v_shell_state||'] - enc ' || o.order_number);
      ELSE
        SELECT s.id INTO v_existing_id FROM public.shells s
          JOIN public.shells base ON base.id = rec.shell_id
         WHERE s.code = base.code AND s.state = v_shell_state LIMIT 1;
        IF v_existing_id IS NOT NULL THEN
          UPDATE public.shells SET quantity = quantity + 1 WHERE id = v_existing_id;
          INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
            VALUES ('shell', v_existing_id, 1,
                    'Recuperado de cancelamento ['||v_shell_state||'] - enc ' || o.order_number);
        ELSE
          INSERT INTO public.shells(code, name, quantity, state)
          SELECT code, name, 1, v_shell_state FROM public.shells WHERE id = rec.shell_id
          RETURNING id INTO v_new_id;
          INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
            VALUES ('shell', v_new_id, 1,
                    'Casco criado de cancelamento ['||v_shell_state||'] - enc ' || o.order_number);
        END IF;
      END IF;
    END IF;

    v_cover_state := prev->>'cover_recover_state';
    IF v_cover_state IS NOT NULL THEN
      DECLARE cv public.covers;
      BEGIN
        cv := public.find_matching_cover_state(_order_id, v_cover_state);
        IF cv.id IS NOT NULL THEN
          UPDATE public.covers SET quantity = quantity + 1 WHERE id = cv.id;
          INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
            VALUES ('cover', cv.id, 1,
                    'Recuperado de cancelamento ['||v_cover_state||'] - enc ' || o.order_number);
        ELSE
          INSERT INTO public.covers(code, name, model_code, structure_code, measure_code,
                                    fabric_type_code, fabric_ref_code, color_code, quantity, state)
          VALUES ('AUTO-' || substring(o.order_number,1,16),
                  'Capa recuperada ' || o.order_number,
                  (SELECT code FROM public.models WHERE id = o.model_id),
                  o.structure_type, o.measure, o.fabric_type, o.fabric_ref, o.color, 1, v_cover_state)
          RETURNING id INTO v_new_id;
          INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
            VALUES ('cover', v_new_id, 1,
                    'Capa criada de cancelamento ['||v_cover_state||'] - enc ' || o.order_number);
        END IF;
      END;
    END IF;
  END IF;

  UPDATE public.order_stages
     SET status = 'bloqueada', notes = COALESCE(notes,'') || ' [Cancelada]'
   WHERE order_id = _order_id AND status <> 'concluida';

  UPDATE public.production_orders SET status = 'cancelada' WHERE id = _order_id;

  RETURN prev;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cancel_order_with_recovery_impl(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order_with_recovery_impl(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_shell_batch_impl(_batch_id uuid, _operator_code text)
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

REVOKE EXECUTE ON FUNCTION public.finalize_shell_batch_impl(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_shell_batch_impl(uuid, text) TO service_role;