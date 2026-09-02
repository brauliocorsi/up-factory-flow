CREATE OR REPLACE FUNCTION public.record_picking_dispatch(
  _batch_id uuid,
  _order_ids uuid[],
  _operator_code text,
  _status text,
  _response_code integer,
  _response_body text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _op_id uuid;
  _concluded integer := 0;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'escritorio')
    OR public.has_role(auth.uid(), 'picador')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para registar envio de lotes de picagem';
  END IF;

  IF _status NOT IN ('enviado', 'erro') THEN
    RAISE EXCEPTION 'Estado inválido: %', _status;
  END IF;

  SELECT id INTO _op_id FROM public.operators WHERE code = _operator_code;

  INSERT INTO public.picking_dispatches (order_id, batch_id, status, response_code, response_body, operator_id, dispatched_at)
  SELECT oid, _batch_id, _status, _response_code, left(coalesce(_response_body, ''), 1000), _op_id, now()
  FROM unnest(_order_ids) AS t(oid);

  IF _status = 'enviado' THEN
    WITH upd AS (
      UPDATE public.production_orders
         SET status = 'concluida'
       WHERE id = ANY(_order_ids)
         AND status <> 'cancelada'
      RETURNING id
    )
    SELECT count(*) INTO _concluded FROM upd;

    UPDATE public.finished_goods
       SET status = 'transferido',
           ready_for_transfer = false,
           transferred_at = now()
     WHERE order_id = ANY(_order_ids);
  END IF;

  RETURN jsonb_build_object('ok', true, 'concluded', _concluded);
END;
$$;

REVOKE ALL ON FUNCTION public.record_picking_dispatch(uuid, uuid[], text, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_picking_dispatch(uuid, uuid[], text, text, integer, text) TO authenticated, service_role;