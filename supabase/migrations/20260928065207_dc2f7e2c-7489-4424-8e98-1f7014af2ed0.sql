GRANT INSERT, UPDATE ON public.fabric_catalog TO authenticated;

CREATE OR REPLACE FUNCTION public.consume_fabric(p_ref_tec text, p_meters numeric, p_order_id uuid, p_operator uuid DEFAULT NULL::uuid)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_left numeric; v_staff boolean; v_ok boolean := false; v_status order_status; v_reverted uuid;
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
  IF EXISTS (SELECT 1 FROM fabric_consumptions WHERE order_id = p_order_id AND reverted_at IS NULL) THEN
    RAISE EXCEPTION 'Já existe um consumo registado para esta OF (só é permitido um por OF).';
  END IF;

  SELECT meters INTO v_left FROM fabric_catalog WHERE ref_tec = p_ref_tec AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tecido % nao existe ou esta inativo', p_ref_tec; END IF;
  IF v_left < p_meters THEN
    RAISE EXCEPTION 'Stock insuficiente de %: existem % m, pedidos % m', p_ref_tec, v_left, p_meters;
  END IF;

  UPDATE fabric_catalog SET meters = meters - p_meters, updated_at = now() WHERE ref_tec = p_ref_tec;

  -- Se existe um consumo anulado para esta OF, reabre-o com os novos valores
  -- (a tabela tem UNIQUE(order_id), por isso não é possível inserir uma segunda linha).
  SELECT id INTO v_reverted FROM fabric_consumptions
   WHERE order_id = p_order_id AND reverted_at IS NOT NULL
   ORDER BY reverted_at DESC LIMIT 1 FOR UPDATE;
  IF v_reverted IS NOT NULL THEN
    UPDATE fabric_consumptions
       SET ref_tec = p_ref_tec, meters = p_meters, operator_id = p_operator,
           reverted_at = NULL, reverted_by = NULL, created_at = now()
     WHERE id = v_reverted;
  ELSE
    INSERT INTO fabric_consumptions (order_id, ref_tec, meters, operator_id)
    VALUES (p_order_id, p_ref_tec, p_meters, p_operator);
  END IF;

  INSERT INTO stock_movements (item_type, item_id, delta, reason, user_id)
  VALUES ('fabric', gen_random_uuid(), -p_meters,
          'consumo ' || p_ref_tec || ' na OF ' || coalesce(p_order_id::text,'-'), auth.uid());
  RETURN v_left - p_meters;
END $function$;

REVOKE EXECUTE ON FUNCTION public.consume_fabric(text,numeric,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_fabric(text,numeric,uuid,uuid) TO authenticated, service_role;