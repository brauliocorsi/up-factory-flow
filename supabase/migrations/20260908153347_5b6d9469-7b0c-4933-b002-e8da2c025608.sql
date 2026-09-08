ALTER TABLE public.fabric_consumptions
  ADD COLUMN IF NOT EXISTS reverted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reverted_by uuid;

CREATE OR REPLACE FUNCTION public.consume_fabric_for_order(_order_id uuid, _roll_id uuid, _meters numeric, _operator_code text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  o RECORD;
  roll public.fabric_rolls;
  op public.operators;
  is_staff boolean;
  can_cut boolean := false;
BEGIN
  is_staff := public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'escritorio');

  IF _operator_code IS NOT NULL AND length(trim(_operator_code)) > 0 THEN
    SELECT * INTO op FROM public.operators WHERE code = trim(_operator_code) AND active LIMIT 1;
    IF op.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'message', 'Operador não encontrado ou inativo.');
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.operator_stages WHERE operator_id = op.id AND stage = 'corte'
    ) INTO can_cut;
  END IF;

  IF NOT is_staff AND NOT can_cut THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Sem permissão para consumir tecido (admin, escritório ou operador de corte).');
  END IF;

  -- Bloqueio por encomenda: impede duas baixas simultâneas
  SELECT * INTO o FROM public.production_orders WHERE id = _order_id FOR UPDATE;
  IF o.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Encomenda não encontrada.');
  END IF;
  IF o.status = 'cancelada' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Encomenda cancelada — não é possível consumir tecido.');
  END IF;

  IF _meters IS NULL OR _meters <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Metros a consumir inválidos. Define os metros no modelo.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.fabric_consumptions
     WHERE order_id = _order_id AND reverted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Tecido já consumido para esta encomenda.');
  END IF;

  SELECT * INTO roll FROM public.fabric_rolls WHERE id = _roll_id FOR UPDATE;
  IF roll.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Rolo de tecido não encontrado.');
  END IF;
  IF roll.meters < _meters THEN
    RETURN jsonb_build_object('ok', false, 'message',
      'Metros insuficientes no rolo (' || roll.meters || 'm disponíveis).');
  END IF;

  UPDATE public.fabric_rolls SET meters = GREATEST(0, meters - _meters), updated_at = now()
   WHERE id = roll.id;

  INSERT INTO public.fabric_consumptions(order_id, roll_id, fabric_ref_code, color_code, meters, operator_id)
    VALUES (_order_id, roll.id, roll.fabric_ref_code, roll.color_code, _meters, op.id);

  INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
    VALUES ('fabric_roll', roll.id, -_meters, 'Corte (manual) - enc ' || o.order_number);

  RETURN jsonb_build_object('ok', true, 'meters', _meters, 'roll_id', roll.id,
    'fabric_ref_code', roll.fabric_ref_code, 'color_code', roll.color_code);
END;
$function$;

CREATE OR REPLACE FUNCTION public.undo_fabric_consumption(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c public.fabric_consumptions;
  o RECORD;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'escritorio')) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Sem permissão para anular consumo de tecido.');
  END IF;

  SELECT * INTO o FROM public.production_orders WHERE id = _order_id FOR UPDATE;
  IF o.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Encomenda não encontrada.');
  END IF;

  SELECT * INTO c FROM public.fabric_consumptions
   WHERE order_id = _order_id AND reverted_at IS NULL
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;
  IF c.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Não existe consumo ativo para esta encomenda.');
  END IF;

  UPDATE public.fabric_consumptions
     SET reverted_at = now(), reverted_by = auth.uid()
   WHERE id = c.id AND reverted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Consumo já foi anulado.');
  END IF;

  IF c.roll_id IS NOT NULL THEN
    UPDATE public.fabric_rolls SET meters = meters + c.meters, updated_at = now() WHERE id = c.roll_id;
    INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
      VALUES ('fabric_roll', c.roll_id, c.meters, 'Anulação de consumo - enc ' || COALESCE(o.order_number,'?'));
  END IF;

  RETURN jsonb_build_object('ok', true, 'meters', c.meters);
END;
$function$;

CREATE OR REPLACE FUNCTION public.adjust_stock_atomic(_item_type text, _item_id uuid, _delta numeric, _reason text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_new numeric;
  v_cur numeric;
  v_res int;
BEGIN
  PERFORM public.assert_office_or_admin('ajustar stock');

  IF _item_type NOT IN ('fabric','shell','cover') THEN
    RAISE EXCEPTION 'Tipo de item inválido: %', _item_type;
  END IF;
  IF _delta IS NULL OR _delta = 0 THEN
    RAISE EXCEPTION 'Quantidade de ajuste inválida';
  END IF;
  IF _item_type IN ('shell','cover') AND _delta <> round(_delta) THEN
    RAISE EXCEPTION 'Para cascos e capas o ajuste tem de ser um número inteiro';
  END IF;

  IF _item_type = 'fabric' THEN
    SELECT meters INTO v_cur FROM public.fabric_rolls WHERE id = _item_id FOR UPDATE;
    IF v_cur IS NULL THEN RAISE EXCEPTION 'Item de stock não encontrado'; END IF;
    IF v_cur + _delta < 0 THEN
      RAISE EXCEPTION 'Não há metros suficientes (% m disponíveis)', v_cur;
    END IF;
    UPDATE public.fabric_rolls SET meters = v_cur + _delta, updated_at = now()
     WHERE id = _item_id RETURNING meters INTO v_new;
  ELSIF _item_type = 'shell' THEN
    SELECT quantity, reserved INTO v_cur, v_res FROM public.shells WHERE id = _item_id FOR UPDATE;
    IF v_cur IS NULL THEN RAISE EXCEPTION 'Item de stock não encontrado'; END IF;
    IF v_cur + _delta < COALESCE(v_res,0) THEN
      RAISE EXCEPTION 'Ajuste inválido: existem % unidades reservadas', COALESCE(v_res,0);
    END IF;
    UPDATE public.shells SET quantity = (v_cur + _delta)::int, updated_at = now()
     WHERE id = _item_id RETURNING quantity INTO v_new;
  ELSE
    SELECT quantity, reserved INTO v_cur, v_res FROM public.covers WHERE id = _item_id FOR UPDATE;
    IF v_cur IS NULL THEN RAISE EXCEPTION 'Item de stock não encontrado'; END IF;
    IF v_cur + _delta < COALESCE(v_res,0) THEN
      RAISE EXCEPTION 'Ajuste inválido: existem % unidades reservadas', COALESCE(v_res,0);
    END IF;
    UPDATE public.covers SET quantity = (v_cur + _delta)::int, updated_at = now()
     WHERE id = _item_id RETURNING quantity INTO v_new;
  END IF;

  INSERT INTO public.stock_movements(item_type, item_id, delta, reason, user_id)
  VALUES (_item_type, _item_id, _delta, _reason, auth.uid());

  RETURN jsonb_build_object('ok', true, 'new_value', v_new);
END;
$function$;