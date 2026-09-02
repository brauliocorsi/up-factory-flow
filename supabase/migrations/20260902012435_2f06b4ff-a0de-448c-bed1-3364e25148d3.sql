CREATE OR REPLACE FUNCTION public.record_stage_event(_order_stage_id uuid, _operator_code text, _event text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_op public.operators;
  v_stage public.order_stages;
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

  SELECT * INTO v_stage FROM public.order_stages WHERE id = _order_stage_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Etapa não encontrada';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.operator_stages
    WHERE operator_id = v_op.id AND stage = v_stage.stage
  ) INTO v_linked;
  IF NOT v_linked THEN
    RAISE EXCEPTION 'O operador % não está atribuído à etapa %', v_op.code, v_stage.stage;
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

  IF _event = 'iniciar' AND v_stage.status = 'concluida' THEN
    RAISE EXCEPTION 'Etapa já concluída';
  END IF;
  IF _event = 'finalizar' AND v_stage.started_at IS NULL THEN
    RAISE EXCEPTION 'Não se pode finalizar uma etapa que não foi iniciada';
  END IF;
  IF _event = 'pausar' AND v_stage.is_paused THEN
    RAISE EXCEPTION 'Etapa já está em pausa';
  END IF;
  IF _event = 'retomar' AND NOT v_stage.is_paused THEN
    RAISE EXCEPTION 'Etapa não está em pausa';
  END IF;

  INSERT INTO public.stage_time_logs(order_stage_id, operator_id, event)
    VALUES (_order_stage_id, v_op.id, _event);

  v_last_ts := NULL;
  v_last_event := NULL;
  FOR rec IN
    SELECT event, event_at FROM public.stage_time_logs
     WHERE order_stage_id = _order_stage_id
     ORDER BY event_at ASC
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

CREATE OR REPLACE FUNCTION public.record_coli_stage_event(_order_coli_stage_id uuid, _operator_code text, _event text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_op public.operators;
  v_cs public.order_coli_stages;
  v_linked boolean;
  v_owner public.operators;
  v_is_admin boolean := false;
  v_delta_prod int := 0;
  v_delta_pause int := 0;
  v_now timestamptz := now();
BEGIN
  IF _event NOT IN ('iniciar','pausar','retomar','finalizar') THEN
    RAISE EXCEPTION 'Evento inválido: %', _event;
  END IF;

  SELECT * INTO v_op FROM public.operators WHERE code=_operator_code AND active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operador "%" não encontrado ou inativo', _operator_code; END IF;

  SELECT * INTO v_cs FROM public.order_coli_stages WHERE id=_order_coli_stage_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Etapa do coli não encontrada'; END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.operator_stages
    WHERE operator_id=v_op.id AND stage=v_cs.stage
  ) INTO v_linked;
  IF NOT v_linked THEN
    RAISE EXCEPTION 'O operador % não está atribuído à etapa %', v_op.code, v_cs.stage;
  END IF;

  -- Bloqueio de propriedade
  IF _event IN ('pausar','retomar','finalizar')
     AND v_cs.operator_id IS NOT NULL
     AND v_cs.operator_id <> v_op.id
     AND v_cs.started_at IS NOT NULL THEN
    IF v_op.user_id IS NOT NULL THEN
      SELECT public.has_role(v_op.user_id, 'admin') INTO v_is_admin;
    END IF;
    IF NOT COALESCE(v_is_admin, false) THEN
      SELECT * INTO v_owner FROM public.operators WHERE id = v_cs.operator_id;
      RAISE EXCEPTION 'Coli iniciado pelo operador % (%). Apenas esse operador pode continuar ou finalizar.',
        COALESCE(v_owner.code, '?'), COALESCE(v_owner.name, 'desconhecido');
    END IF;
  END IF;

  IF v_cs.status='concluida' THEN RAISE EXCEPTION 'Coli já concluído nesta etapa'; END IF;
  IF _event='pausar' AND v_cs.is_paused THEN RAISE EXCEPTION 'Coli já está em pausa'; END IF;
  IF _event='retomar' AND NOT v_cs.is_paused THEN RAISE EXCEPTION 'Coli não está em pausa'; END IF;
  IF _event='finalizar' AND v_cs.started_at IS NULL THEN RAISE EXCEPTION 'Não se pode finalizar um coli que não foi iniciado'; END IF;

  IF _event='iniciar' THEN
    UPDATE public.order_coli_stages SET
      status='em_curso'::stage_status,
      started_at=COALESCE(started_at, v_now),
      last_resume_at=v_now,
      pause_started_at=NULL,
      is_paused=false,
      operator_id=v_op.id
    WHERE id=_order_coli_stage_id;

  ELSIF _event='pausar' THEN
    IF v_cs.last_resume_at IS NOT NULL THEN
      v_delta_prod := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_cs.last_resume_at))::int);
    END IF;
    UPDATE public.order_coli_stages SET
      productive_seconds = productive_seconds + v_delta_prod,
      is_paused=true,
      pause_started_at=v_now,
      last_resume_at=NULL,
      operator_id=v_op.id
    WHERE id=_order_coli_stage_id;

  ELSIF _event='retomar' THEN
    IF v_cs.pause_started_at IS NOT NULL THEN
      v_delta_pause := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_cs.pause_started_at))::int);
    END IF;
    UPDATE public.order_coli_stages SET
      paused_seconds = paused_seconds + v_delta_pause,
      is_paused=false,
      pause_started_at=NULL,
      last_resume_at=v_now,
      status='em_curso'::stage_status,
      operator_id=v_op.id
    WHERE id=_order_coli_stage_id;

  ELSIF _event='finalizar' THEN
    IF NOT v_cs.is_paused AND v_cs.last_resume_at IS NOT NULL THEN
      v_delta_prod := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_cs.last_resume_at))::int);
    END IF;
    IF v_cs.is_paused AND v_cs.pause_started_at IS NOT NULL THEN
      v_delta_pause := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_cs.pause_started_at))::int);
    END IF;
    UPDATE public.order_coli_stages SET
      productive_seconds = productive_seconds + v_delta_prod,
      paused_seconds = paused_seconds + v_delta_pause,
      is_paused=false,
      pause_started_at=NULL,
      last_resume_at=NULL,
      finished_at=v_now,
      status='concluida'::stage_status,
      operator_id=v_op.id
    WHERE id=_order_coli_stage_id;
  END IF;

  PERFORM public.sync_order_stage_from_colis(v_cs.order_id, v_cs.stage);

  RETURN jsonb_build_object('ok', true, 'event', _event);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.record_stage_event(uuid,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_coli_stage_event(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_stage_event(uuid,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_coli_stage_event(uuid,text,text) TO authenticated, service_role;