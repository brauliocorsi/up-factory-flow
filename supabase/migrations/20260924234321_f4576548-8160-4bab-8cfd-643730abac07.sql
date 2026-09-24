GRANT SELECT ON public.fabric_catalog TO authenticated;
GRANT SELECT ON public.fabric_availability TO authenticated;
GRANT ALL ON public.fabric_catalog TO service_role;
GRANT SELECT ON public.fabric_availability TO service_role;

CREATE OR REPLACE FUNCTION public.consume_fabric(p_ref_tec text, p_meters numeric, p_order_id uuid, p_operator uuid DEFAULT NULL::uuid)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_left numeric; v_staff boolean; v_ok boolean := false; v_status order_status;
BEGIN
  v_staff := public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio');
  IF p_operator IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM operators o JOIN operator_stages s ON s.operator_id=o.id AND s.stage='corte'
      WHERE o.id=p_operator AND o.active AND (o.user_id=auth.uid() OR v_staff)) INTO v_ok;
  END IF;
  IF NOT v_staff AND NOT v_ok THEN
    RAISE EXCEPTION 'Sem permissão para consumir tecido (admin, escritório ou operador de corte).';
  END IF;
  IF p_meters IS NULL OR p_meters <= 0 THEN
    RAISE EXCEPTION 'Metros a consumir tem de ser positivo (recebido: %)', p_meters;
  END IF;
  SELECT status INTO v_status FROM production_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Encomenda não encontrada.'; END IF;
  IF v_status = 'cancelada' THEN RAISE EXCEPTION 'Encomenda cancelada — não é possível consumir tecido.'; END IF;
  IF EXISTS (SELECT 1 FROM fabric_consumptions WHERE order_id = p_order_id) THEN
    RAISE EXCEPTION 'Já existe um consumo registado para esta OF (só é permitido um por OF).';
  END IF;

  SELECT meters INTO v_left FROM fabric_catalog WHERE ref_tec = p_ref_tec AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tecido % nao existe ou esta inativo', p_ref_tec; END IF;
  IF v_left < p_meters THEN
    RAISE EXCEPTION 'Stock insuficiente de %: existem % m, pedidos % m', p_ref_tec, v_left, p_meters;
  END IF;

  UPDATE fabric_catalog SET meters = meters - p_meters, updated_at = now() WHERE ref_tec = p_ref_tec;
  INSERT INTO fabric_consumptions (order_id, ref_tec, meters, operator_id)
  VALUES (p_order_id, p_ref_tec, p_meters, p_operator);
  INSERT INTO stock_movements (item_type, item_id, delta, reason, user_id)
  VALUES ('fabric', gen_random_uuid(), -p_meters,
          'consumo ' || p_ref_tec || ' na OF ' || coalesce(p_order_id::text,'-'), auth.uid());
  RETURN v_left - p_meters;
END $function$;

CREATE OR REPLACE FUNCTION public.receive_fabric(p_ref_tec text, p_meters numeric, p_reason text DEFAULT 'entrada'::text, p_user uuid DEFAULT NULL::uuid)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_cur numeric; v_new numeric;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio')) THEN
    RAISE EXCEPTION 'Sem permissão para movimentar stock de tecido (só admin/escritório).';
  END IF;
  IF p_meters IS NULL OR p_meters = 0 THEN
    RAISE EXCEPTION 'Metros a dar entrada tem de ser diferente de zero';
  END IF;
  SELECT meters INTO v_cur FROM fabric_catalog WHERE ref_tec = p_ref_tec AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tecido % nao existe ou esta inativo', p_ref_tec; END IF;
  IF v_cur + p_meters < 0 THEN
    RAISE EXCEPTION 'Stock insuficiente de %: existem % m, saída de % m', p_ref_tec, v_cur, -p_meters;
  END IF;
  UPDATE fabric_catalog SET meters = meters + p_meters, updated_at = now()
   WHERE ref_tec = p_ref_tec RETURNING meters INTO v_new;
  INSERT INTO stock_movements (item_type,item_id,delta,reason,user_id)
  VALUES ('fabric',gen_random_uuid(),p_meters,coalesce(p_reason,'entrada')||' '||p_ref_tec,auth.uid());
  RETURN v_new;
END $function$;

CREATE OR REPLACE FUNCTION public.undo_fabric_consumption(_order_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c public.fabric_consumptions; o RECORD;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'escritorio')) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Sem permissão para anular consumo de tecido.');
  END IF;
  SELECT * INTO o FROM public.production_orders WHERE id = _order_id FOR UPDATE;
  IF o.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Encomenda não encontrada.'); END IF;
  SELECT * INTO c FROM public.fabric_consumptions
   WHERE order_id = _order_id AND reverted_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Não existe consumo ativo para esta encomenda.'); END IF;
  UPDATE public.fabric_consumptions SET reverted_at = now(), reverted_by = auth.uid()
   WHERE id = c.id AND reverted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'message', 'Consumo já foi anulado.'); END IF;
  IF c.ref_tec IS NOT NULL THEN
    UPDATE public.fabric_catalog SET meters = meters + c.meters, updated_at = now() WHERE ref_tec = c.ref_tec;
    INSERT INTO public.stock_movements(item_type, item_id, delta, reason, user_id)
      VALUES ('fabric', gen_random_uuid(), c.meters, 'Anulação de consumo ' || c.ref_tec || ' - enc ' || COALESCE(o.order_number,'?'), auth.uid());
  ELSIF c.roll_id IS NOT NULL THEN
    UPDATE public.fabric_rolls SET meters = meters + c.meters, updated_at = now() WHERE id = c.roll_id;
    INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
      VALUES ('fabric_roll', c.roll_id, c.meters, 'Anulação de consumo - enc ' || COALESCE(o.order_number,'?'));
  END IF;
  RETURN jsonb_build_object('ok', true, 'meters', c.meters);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.consume_fabric(text,numeric,uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.receive_fabric(text,numeric,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_fabric(text,numeric,uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.receive_fabric(text,numeric,text,uuid) TO authenticated, service_role;