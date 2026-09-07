ALTER TABLE public.picking_dispatches
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

DELETE FROM public.picking_dispatches d
USING public.picking_dispatches d2
WHERE d.batch_id = d2.batch_id
  AND d.order_id = d2.order_id
  AND d.ctid < d2.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS picking_dispatches_batch_order_uidx
  ON public.picking_dispatches (batch_id, order_id);

CREATE OR REPLACE FUNCTION public.begin_picking_dispatch(_order_ids uuid[], _operator_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op_id uuid;
  v_batch uuid;
  v_eligible uuid[] := '{}';
  v_rejected jsonb := '[]'::jsonb;
  r record;
  v_total int;
  v_picked int;
  v_sent boolean;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'escritorio')
    OR public.has_role(auth.uid(), 'picador')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para enviar lotes de picagem';
  END IF;

  IF _order_ids IS NULL OR array_length(_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Nenhuma encomenda indicada';
  END IF;

  SELECT id INTO v_op_id FROM public.operators WHERE code = _operator_code;

  FOR r IN
    SELECT o.id, o.order_number, o.status
      FROM public.production_orders o
     WHERE o.id = ANY(_order_ids)
     FOR UPDATE
  LOOP
    IF r.status = 'cancelada' THEN
      v_rejected := v_rejected || jsonb_build_object('order_id', r.id, 'order_number', r.order_number, 'reason', 'Encomenda cancelada');
      CONTINUE;
    END IF;

    SELECT count(*)::int INTO v_total FROM public.order_colis WHERE order_id = r.id;
    SELECT count(*)::int INTO v_picked
      FROM public.order_coli_stages
     WHERE order_id = r.id AND stage = 'picagem' AND status = 'concluida';

    IF v_total = 0 THEN
      v_rejected := v_rejected || jsonb_build_object('order_id', r.id, 'order_number', r.order_number, 'reason', 'Sem volumes registados');
      CONTINUE;
    END IF;

    IF v_picked < v_total THEN
      v_rejected := v_rejected || jsonb_build_object('order_id', r.id, 'order_number', r.order_number,
        'reason', format('Picagem incompleta (%s de %s volumes)', v_picked, v_total));
      CONTINUE;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM public.picking_dispatches
       WHERE order_id = r.id AND status = 'enviado'
    ) INTO v_sent;
    IF v_sent THEN
      v_rejected := v_rejected || jsonb_build_object('order_id', r.id, 'order_number', r.order_number, 'reason', 'Já enviada para o stock');
      CONTINUE;
    END IF;

    v_eligible := v_eligible || r.id;
  END LOOP;

  IF array_length(v_eligible, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'batch_id', null, 'eligible', '[]'::jsonb, 'rejected', v_rejected);
  END IF;

  -- Reutiliza um lote já aberto (tentativa anterior falhada ou incerta) para
  -- manter o identificador estável e evitar duplicar no destino.
  SELECT batch_id INTO v_batch
    FROM public.picking_dispatches
   WHERE order_id = ANY(v_eligible)
     AND status IN ('pendente', 'erro', 'incerto')
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_batch IS NULL THEN
    v_batch := gen_random_uuid();
  END IF;

  INSERT INTO public.picking_dispatches (order_id, batch_id, status, operator_id, dispatched_at)
  SELECT oid, v_batch, 'pendente', v_op_id, now()
    FROM unnest(v_eligible) AS t(oid)
  ON CONFLICT (batch_id, order_id) DO UPDATE
    SET status = 'pendente',
        operator_id = COALESCE(EXCLUDED.operator_id, public.picking_dispatches.operator_id),
        dispatched_at = now(),
        updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'batch_id', v_batch,
    'eligible', to_jsonb(v_eligible),
    'rejected', v_rejected
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.begin_picking_dispatch(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_picking_dispatch(uuid[], text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_picking_dispatch(_batch_id uuid, _order_ids uuid[], _operator_code text, _status text, _response_code integer, _response_body text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  IF _status NOT IN ('enviado', 'erro', 'incerto', 'pendente') THEN
    RAISE EXCEPTION 'Estado inválido: %', _status;
  END IF;

  SELECT id INTO _op_id FROM public.operators WHERE code = _operator_code;

  INSERT INTO public.picking_dispatches (order_id, batch_id, status, response_code, response_body, operator_id, dispatched_at, confirmed_at)
  SELECT oid, _batch_id, _status, _response_code, left(coalesce(_response_body, ''), 1000), _op_id, now(),
         CASE WHEN _status = 'enviado' THEN now() ELSE NULL END
    FROM unnest(_order_ids) AS t(oid)
  ON CONFLICT (batch_id, order_id) DO UPDATE
    SET status = EXCLUDED.status,
        response_code = EXCLUDED.response_code,
        response_body = EXCLUDED.response_body,
        operator_id = COALESCE(EXCLUDED.operator_id, public.picking_dispatches.operator_id),
        confirmed_at = COALESCE(EXCLUDED.confirmed_at, public.picking_dispatches.confirmed_at),
        updated_at = now();

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
$function$;

REVOKE ALL ON FUNCTION public.record_picking_dispatch(uuid, uuid[], text, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_picking_dispatch(uuid, uuid[], text, text, integer, text) TO authenticated;