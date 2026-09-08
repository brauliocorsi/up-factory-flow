CREATE OR REPLACE FUNCTION public.record_picking_dispatch(_batch_id uuid, _order_ids uuid[], _operator_code text, _status text, _response_code integer, _response_body text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _op_id uuid;
  _concluded integer := 0;
  _known uuid[] := '{}';
  _valid uuid[] := '{}';
  _rejected jsonb := '[]'::jsonb;
  r record;
  v_total int;
  v_picked int;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'escritorio')
    OR public.has_role(auth.uid(), 'picador')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para registar envio de lotes de picagem';
  END IF;

  IF _status NOT IN ('enviado', 'erro', 'incerto', 'pendente') THEN
    RAISE EXCEPTION 'Estado inválido: %', _status;
  END IF;

  SELECT id INTO _op_id FROM public.operators WHERE code = _operator_code;

  -- Apenas encomendas preparadas neste lote podem ser registadas.
  SELECT COALESCE(array_agg(order_id), '{}') INTO _known
    FROM public.picking_dispatches
   WHERE batch_id = _batch_id AND order_id = ANY(_order_ids);

  IF array_length(_known, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Lote não preparado. Recomeça o envio.', 'concluded', 0);
  END IF;

  IF _status = 'enviado' THEN
    FOR r IN
      SELECT o.id, o.order_number, o.status
        FROM public.production_orders o
       WHERE o.id = ANY(_known)
       FOR UPDATE
    LOOP
      SELECT count(*)::int INTO v_total FROM public.order_colis WHERE order_id = r.id;
      SELECT count(*)::int INTO v_picked
        FROM public.order_coli_stages
       WHERE order_id = r.id AND stage = 'picagem' AND status = 'concluida';

      IF r.status = 'cancelada' THEN
        _rejected := _rejected || jsonb_build_object('order_id', r.id, 'order_number', r.order_number, 'reason', 'Encomenda cancelada');
      ELSIF v_total = 0 THEN
        _rejected := _rejected || jsonb_build_object('order_id', r.id, 'order_number', r.order_number, 'reason', 'Sem volumes registados');
      ELSIF v_picked < v_total THEN
        _rejected := _rejected || jsonb_build_object('order_id', r.id, 'order_number', r.order_number,
          'reason', format('Picagem incompleta (%s de %s volumes)', v_picked, v_total));
      ELSE
        _valid := _valid || r.id;
      END IF;
    END LOOP;
  ELSE
    _valid := _known;
  END IF;

  IF array_length(_valid, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Nenhuma encomenda elegível para confirmar envio.',
      'concluded', 0, 'rejected', _rejected);
  END IF;

  UPDATE public.picking_dispatches d
     SET status = _status,
         response_code = _response_code,
         response_body = left(coalesce(_response_body, ''), 1000),
         operator_id = COALESCE(_op_id, d.operator_id),
         confirmed_at = CASE WHEN _status = 'enviado' THEN COALESCE(d.confirmed_at, now()) ELSE d.confirmed_at END,
         updated_at = now()
   WHERE d.batch_id = _batch_id AND d.order_id = ANY(_valid);

  IF _status = 'enviado' THEN
    WITH upd AS (
      UPDATE public.production_orders
         SET status = 'concluida'
       WHERE id = ANY(_valid)
         AND status <> 'cancelada'
      RETURNING id
    )
    SELECT count(*) INTO _concluded FROM upd;

    UPDATE public.finished_goods
       SET status = 'transferido',
           ready_for_transfer = false,
           transferred_at = COALESCE(transferred_at, now())
     WHERE order_id = ANY(_valid);
  END IF;

  RETURN jsonb_build_object('ok', true, 'concluded', _concluded, 'rejected', _rejected,
    'recorded', to_jsonb(_valid));
END;
$function$;

REVOKE ALL ON FUNCTION public.record_picking_dispatch(uuid, uuid[], text, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_picking_dispatch(uuid, uuid[], text, text, integer, text) TO authenticated;