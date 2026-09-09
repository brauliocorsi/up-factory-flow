-- 1) record_stage_event: delegar aos volumes quando a etapa existe por volume
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
  v_has_coli boolean;
  v_applied int := 0;
  v_errors text[] := '{}';
BEGIN
  IF _event NOT IN ('iniciar','pausar','retomar','finalizar') THEN
    RAISE EXCEPTION 'Evento inválido: %', _event;
  END IF;

  SELECT * INTO v_stage FROM public.order_stages WHERE id = _order_stage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Etapa não encontrada';
  END IF;

  -- Encomendas com volumes: a verdade está em order_coli_stages. Aplicar o
  -- mesmo evento a todos os volumes desta etapa (o resumo é sincronizado lá).
  SELECT EXISTS(
    SELECT 1 FROM public.order_coli_stages
     WHERE order_id = v_stage.order_id AND stage = v_stage.stage
  ) INTO v_has_coli;

  IF v_has_coli THEN
    FOR rec IN
      SELECT cs.id, cs.status, cs.is_paused, cs.started_at
        FROM public.order_coli_stages cs
        JOIN public.order_colis c ON c.id = cs.order_coli_id
       WHERE cs.order_id = v_stage.order_id
         AND cs.stage = v_stage.stage
         AND cs.status <> 'concluida'
       ORDER BY c.coli_number
    LOOP
      -- estados incompatíveis: ignorar em silêncio
      IF _event = 'finalizar' AND rec.started_at IS NULL THEN CONTINUE; END IF;
      IF _event = 'pausar' AND (rec.status <> 'em_curso' OR rec.is_paused) THEN CONTINUE; END IF;
      IF _event = 'retomar' AND NOT rec.is_paused THEN CONTINUE; END IF;
      IF _event = 'iniciar' AND rec.status = 'em_curso' AND NOT rec.is_paused THEN CONTINUE; END IF;
      BEGIN
        PERFORM public.record_coli_stage_event(rec.id, _operator_code, _event);
        v_applied := v_applied + 1;
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors || SQLERRM;
      END;
    END LOOP;

    IF v_applied = 0 AND array_length(v_errors, 1) > 0 THEN
      RAISE EXCEPTION '%', v_errors[1];
    END IF;

    PERFORM public.sync_order_stage_from_colis(v_stage.order_id, v_stage.stage);
    SELECT * INTO v_stage FROM public.order_stages WHERE id = _order_stage_id;
    RETURN jsonb_build_object(
      'ok', true,
      'by_colis', true,
      'applied', v_applied,
      'status', v_stage.status,
      'productive_seconds', v_stage.productive_seconds,
      'paused_seconds', v_stage.paused_seconds,
      'is_paused', v_stage.is_paused
    );
  END IF;

  SELECT * INTO v_op FROM public.operators WHERE code = _operator_code AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operador "%" não encontrado ou inativo', _operator_code;
  END IF;

  PERFORM public.assert_operator_is_session(v_op);

  SELECT * INTO v_order FROM public.production_orders WHERE id = v_stage.order_id;

  SELECT EXISTS(
    SELECT 1 FROM public.operator_stages
    WHERE operator_id = v_op.id AND stage = v_stage.stage
  ) INTO v_linked;
  IF NOT v_linked THEN
    RAISE EXCEPTION 'O operador % não está atribuído à etapa %', v_op.code, v_stage.stage;
  END IF;

  IF _event = 'iniciar' AND v_stage.started_at IS NULL THEN
    IF v_order.status = 'cancelada' THEN
      RAISE EXCEPTION 'Encomenda cancelada — não pode ser produzida.';
    END IF;
    IF v_order.status = 'pendente' THEN
      RAISE EXCEPTION 'Aguarda libertação do escritório — esta encomenda ainda não está ativa na produção.';
    END IF;
    PERFORM public.assert_order_previous_stages_done_any(v_stage.order_id, v_stage.stage);
  END IF;

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

-- 2) Reparar histórico: etapas concluídas no resumo mas pendentes nos volumes.
--    Percorre por ordem de etapa e ignora os casos que ainda dependem de
--    etapas anteriores não concluídas.
DO $repair$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT cs.id, os.started_at, os.finished_at, os.operator_id, os.productive_seconds
      FROM public.order_coli_stages cs
      JOIN public.order_stages os
        ON os.order_id = cs.order_id AND os.stage = cs.stage
     WHERE os.status = 'concluida'
       AND cs.status = 'pendente'
       AND cs.started_at IS NULL
     ORDER BY public.stage_order_index(cs.stage)
  LOOP
    BEGIN
      UPDATE public.order_coli_stages
         SET status = 'concluida',
             started_at = COALESCE(started_at, r.started_at),
             finished_at = COALESCE(finished_at, r.finished_at, now()),
             operator_id = COALESCE(operator_id, r.operator_id),
             productive_seconds = GREATEST(productive_seconds, COALESCE(r.productive_seconds, 0)),
             is_paused = false
       WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- depende de etapas anteriores: fica como está
    END;
  END LOOP;
END
$repair$;
