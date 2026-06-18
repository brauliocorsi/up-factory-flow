
CREATE OR REPLACE FUNCTION public.preview_cancel_order(_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  o RECORD;
  estrut_done boolean; estrut_stock boolean;
  branco_done boolean; branco_stock boolean;
  corte_done boolean;  corte_stock boolean;
  costura_done boolean; costura_stock boolean;
  estof_started boolean := false;
  estof_status text;
  shell_reserved boolean := false;
  cover_reserved boolean := false;
  notes_estrutura text; notes_branco text;
  notes_corte text; notes_costura text;
  shell_code text; cover_code text;
  shell_recover_state text := NULL;
  cover_recover_state text := NULL;
BEGIN
  SELECT * INTO o FROM public.production_orders WHERE id = _order_id;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;

  SELECT (status='concluida'), notes INTO estrut_done, notes_estrutura
    FROM public.order_stages WHERE order_id=_order_id AND stage='estrutura';
  SELECT (status='concluida'), notes INTO branco_done, notes_branco
    FROM public.order_stages WHERE order_id=_order_id AND stage='branco';
  SELECT (status='concluida'), notes INTO corte_done, notes_corte
    FROM public.order_stages WHERE order_id=_order_id AND stage='corte';
  SELECT (status='concluida'), notes INTO costura_done, notes_costura
    FROM public.order_stages WHERE order_id=_order_id AND stage='costura';
  SELECT status INTO estof_status FROM public.order_stages WHERE order_id=_order_id AND stage='estofagem';
  estof_started := COALESCE(estof_status,'') IN ('em_curso','concluida');

  estrut_stock := COALESCE(notes_estrutura,'') LIKE 'Concluída de stock%';
  branco_stock := COALESCE(notes_branco,'')    LIKE 'Concluída de stock%';
  corte_stock  := COALESCE(notes_corte,'')     LIKE 'Concluída de stock%';
  costura_stock:= COALESCE(notes_costura,'')   LIKE 'Concluída de stock%';

  -- Reservas ainda por consumir
  shell_reserved := o.reserved_shell_id IS NOT NULL AND NOT estof_started;
  cover_reserved := o.reserved_cover_id IS NOT NULL AND NOT estof_started;

  IF NOT estof_started THEN
    -- Linha estrutura: estado real produzido (ignora etapas de stock)
    IF COALESCE(branco_done,false) AND NOT branco_stock THEN
      shell_recover_state := 'branco';
    ELSIF COALESCE(estrut_done,false) AND NOT estrut_stock THEN
      shell_recover_state := 'casco';
    END IF;
    -- Linha tecido
    IF COALESCE(costura_done,false) AND NOT costura_stock THEN
      cover_recover_state := 'pronta';
    ELSIF COALESCE(corte_done,false) AND NOT corte_stock THEN
      cover_recover_state := 'cortada';
    END IF;
  END IF;

  IF o.reserved_shell_id IS NOT NULL THEN
    SELECT code INTO shell_code FROM public.shells WHERE id = o.reserved_shell_id;
  END IF;
  IF o.reserved_cover_id IS NOT NULL THEN
    SELECT code INTO cover_code FROM public.covers WHERE id = o.reserved_cover_id;
  END IF;

  RETURN jsonb_build_object(
    'order_number', o.order_number,
    'shell_code', shell_code,
    'cover_code', cover_code,
    'shell_reserved_to_release', shell_reserved,
    'cover_reserved_to_release', cover_reserved,
    'shell_to_return_to_stock', shell_recover_state IS NOT NULL,
    'cover_to_return_to_stock', cover_recover_state IS NOT NULL,
    'shell_recover_state', shell_recover_state,
    'cover_recover_state', cover_recover_state,
    'estof_started', estof_started,
    'becomes_finished_good', estof_started
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_order_with_recovery(_order_id uuid)
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

  -- 1) Libertar reservas não consumidas
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

  -- 2) Se Estofagem iniciada → produto final acabado (sem devolução de semi-acabados)
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
    -- 3) Recuperar semi-acabados no estado atual
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
        -- Procurar outra linha shells que case por código+estado
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
