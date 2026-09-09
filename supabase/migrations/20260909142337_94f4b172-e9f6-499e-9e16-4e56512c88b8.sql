CREATE OR REPLACE FUNCTION public.assert_order_previous_stages_done_any(_order_id uuid, _stage production_stage)
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_has_colis boolean;
  v_pending text;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.order_coli_stages WHERE order_id = _order_id) INTO v_has_colis;

  IF v_has_colis THEN
    SELECT string_agg(DISTINCT cs.stage::text, ', ')
      INTO v_pending
      FROM public.order_coli_stages cs
     WHERE cs.order_id = _order_id
       AND cs.stage = ANY (public.stage_prerequisites(_stage))
       AND cs.status <> 'concluida';
  ELSE
    SELECT string_agg(DISTINCT os.stage::text, ', ')
      INTO v_pending
      FROM public.order_stages os
     WHERE os.order_id = _order_id
       AND os.stage = ANY (public.stage_prerequisites(_stage))
       AND os.status <> 'concluida';
  END IF;

  IF v_pending IS NOT NULL THEN
    RAISE EXCEPTION 'Não é possível iniciar %: falta concluir (%)', _stage, v_pending;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_order_previous_stages_done_any(uuid, production_stage) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_stage_event(_order_stage_id uuid, _operator_code text, _event text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_op public.operators;
  v_stage public.order_stages;
  v_order public.production_orders;
  v_linked boolean;
  v_owner public.operators;
  v_is_admin boolean := false;
  v_prod_seconds int := 0;
  v_pause_seconds int := 0;
  v_last_ts timestamptz;
  v_last_event text;
  v_is_paused boolean := false;
  v_started_at timestamptz;
  v_finished_at timestamptz;
  v_total_run int := 0;
  rec RECORD;
BEGIN
  IF _event NOT IN ('iniciar','pausar','retomar','finalizar') THEN
    RAISE EXCEPTION 'Evento inválido: %', _event;
  END IF;

  SELECT * INTO v_op FROM public.operators WHERE code = _operator_code AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operador "%" não encontrado ou inativo', _operator_code;
  END IF;

  PERFORM public.assert_operator_is_session(v_op);

  SELECT * INTO v_stage FROM public.order_stages WHERE id = _order_stage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Etapa não encontrada';
  END IF;

  SELECT * INTO v_order FROM public.production_orders WHERE id = v_stage.order_id;

  SELECT EXISTS(
    SELECT 1 FROM public.operator_stages
    WHERE operator_id = v_op.id AND stage = v_stage.stage
  ) INTO v_linked;
  IF NOT v_linked THEN
    RAISE EXCEPTION 'O operador % não está atribuído à etapa %', v_op.code, v_stage.stage;
  END IF;

  -- Estados da encomenda que impedem começar trabalho
  IF _event = 'iniciar' AND v_stage.started_at IS NULL THEN
    IF v_order.status = 'cancelada' THEN
      RAISE EXCEPTION 'Encomenda cancelada — não pode ser produzida.';
    END IF;
    IF v_order.status = 'pendente' THEN
      RAISE EXCEPTION 'Aguarda libertação do escritório — esta encomenda ainda não está ativa na produção.';
    END IF;
    -- Sequência de etapas (vale também para encomendas com volumes)
    PERFORM public.assert_order_previous_stages_done_any(v_stage.order_id, v_stage.stage);
  END IF;

  -- Bloqueio de propriedade: só quem iniciou (ou um admin) pode pausar/retomar/finalizar
  IF _event IN ('pausar','retomar','finalizar')
     AND v_stage.operator_id IS NOT NULL
     AND v_stage.operator_id <> v_op.id
     AND v_stage.started_at IS NOT NULL THEN
    IF v_op.user_id IS NOT NULL THEN
      SELECT public.has_role(v_op.user_id, 'admin') INTO v_is_admin;
    END IF;
    IF NOT COALESCE(v_is_admin, false) THEN
      SELECT * INTO v_owner FROM public.operators WHERE id = v_stage.operator_id;
      RAISE EXCEPTION 'Operação iniciada pelo operador % (%). Apenas esse operador pode continuar ou finalizar.',
        COALESCE(v_owner.code, '?'), COALESCE(v_owner.name, 'desconhecido');
    END IF;
  END IF;

  -- Idempotência: pedido repetido devolve o estado atual sem alterar nada
  IF v_stage.status = 'concluida' AND _event IN ('iniciar','finalizar','pausar','retomar') THEN
    RETURN jsonb_build_object('ok', true, 'repeated', true, 'status', 'concluida',
      'productive_seconds', v_stage.productive_seconds,
      'paused_seconds', v_stage.paused_seconds,
      'is_paused', false);
  END IF;
  IF _event = 'iniciar' AND v_stage.status = 'em_curso' AND NOT v_stage.is_paused THEN
    RETURN jsonb_build_object('ok', true, 'repeated', true, 'status', 'em_curso',
      'productive_seconds', v_stage.productive_seconds,
      'paused_seconds', v_stage.paused_seconds,
      'is_paused', false);
  END IF;
  IF _event = 'pausar' AND v_stage.is_paused THEN
    RETURN jsonb_build_object('ok', true, 'repeated', true, 'is_paused', true,
      'productive_seconds', v_stage.productive_seconds,
      'paused_seconds', v_stage.paused_seconds);
  END IF;
  IF _event = 'retomar' AND NOT v_stage.is_paused AND v_stage.started_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'repeated', true, 'is_paused', false,
      'productive_seconds', v_stage.productive_seconds,
      'paused_seconds', v_stage.paused_seconds);
  END IF;
  IF _event = 'finalizar' AND v_stage.started_at IS NULL THEN
    RAISE EXCEPTION 'Não se pode finalizar uma etapa que não foi iniciada';
  END IF;
  IF _event = 'retomar' AND v_stage.started_at IS NULL THEN
    RAISE EXCEPTION 'Etapa não está em pausa';
  END IF;

  INSERT INTO public.stage_time_logs(order_stage_id, operator_id, event)
    VALUES (_order_stage_id, v_op.id, _event);

  v_last_ts := NULL;
  v_last_event := NULL;
  FOR rec IN
    SELECT event, event_at FROM public.stage_time_logs
     WHERE order_stage_id = _order_stage_id
     ORDER BY event_at ASC, id ASC
  LOOP
    IF v_last_event IN ('iniciar','retomar') AND rec.event IN ('pausar','finalizar') THEN
      v_total_run := v_total_run + GREATEST(0, EXTRACT(EPOCH FROM (rec.event_at - v_last_ts))::int);
    ELSIF v_last_event = 'pausar' AND rec.event IN ('retomar','finalizar') THEN
      v_pause_seconds := v_pause_seconds + GREATEST(0, EXTRACT(EPOCH FROM (rec.event_at - v_last_ts))::int);
    END IF;
    v_last_event := rec.event;
    v_last_ts := rec.event_at;
  END LOOP;

  IF v_stage.is_rework THEN
    v_prod_seconds := v_stage.productive_seconds;
  ELSE
    v_prod_seconds := v_total_run;
  END IF;

  v_is_paused := (v_last_event = 'pausar');
  v_started_at := v_stage.started_at;
  v_finished_at := v_stage.finished_at;

  IF _event = 'iniciar' AND v_started_at IS NULL THEN
    v_started_at := now();
  END IF;
  IF _event = 'finalizar' THEN
    v_finished_at := now();
  END IF;

  UPDATE public.order_stages
     SET productive_seconds = v_prod_seconds,
         rework_seconds = CASE WHEN v_stage.is_rework
                               THEN GREATEST(0, v_total_run - v_stage.productive_seconds) + COALESCE(rework_seconds,0) * 0
                               ELSE rework_seconds END,
         paused_seconds = v_pause_seconds,
         is_paused = v_is_paused,
         started_at = v_started_at,
         finished_at = CASE WHEN _event = 'finalizar' THEN v_finished_at ELSE finished_at END,
         operator_id = v_op.id,
         status = CASE
           WHEN _event = 'finalizar' THEN 'concluida'::public.stage_status
           WHEN _event IN ('iniciar','retomar') THEN 'em_curso'::public.stage_status
           ELSE status
         END,
         check_valid = CASE WHEN _event = 'finalizar' THEN true ELSE check_valid END,
         is_rework = CASE WHEN _event = 'finalizar' THEN false ELSE is_rework END
   WHERE id = _order_stage_id;

  IF _event = 'finalizar' AND v_stage.is_rework THEN
    UPDATE public.rework_events
       SET status = 'resolvido', resolved_at = now()
     WHERE order_id = v_stage.order_id
       AND sent_to_stage = v_stage.stage
       AND status = 'aberto';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'productive_seconds', v_prod_seconds,
    'paused_seconds', v_pause_seconds,
    'is_paused', v_is_paused,
    'operator', v_op.code
  );
END;
$function$;