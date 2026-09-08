CREATE OR REPLACE FUNCTION public.record_coli_stage_event(_order_coli_stage_id uuid, _operator_code text, _event text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op public.operators;
  v_cs public.order_coli_stages;
  v_order public.production_orders;
  v_linked boolean;
  v_owner public.operators;
  v_is_admin boolean := false;
  v_delta_prod int := 0;
  v_delta_pause int := 0;
  v_now timestamptz := now();
  v_effective text := _event;
BEGIN
  IF _event NOT IN ('iniciar','pausar','retomar','finalizar') THEN
    RAISE EXCEPTION 'Evento inválido: %', _event;
  END IF;

  SELECT * INTO v_op FROM public.operators WHERE code=_operator_code AND active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operador "%" não encontrado ou inativo', _operator_code; END IF;

  PERFORM public.assert_operator_is_session(v_op);

  SELECT * INTO v_cs FROM public.order_coli_stages WHERE id=_order_coli_stage_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Etapa do coli não encontrada'; END IF;

  SELECT * INTO v_order FROM public.production_orders WHERE id = v_cs.order_id;

  SELECT EXISTS(
    SELECT 1 FROM public.operator_stages
    WHERE operator_id=v_op.id AND stage=v_cs.stage
  ) INTO v_linked;
  IF NOT v_linked THEN
    RAISE EXCEPTION 'O operador % não está atribuído à etapa %', v_op.code, v_cs.stage;
  END IF;

  IF v_order.status = 'cancelada' THEN
    RAISE EXCEPTION 'Encomenda cancelada — não pode ser produzida.';
  END IF;
  IF _event = 'iniciar' AND v_cs.started_at IS NULL AND v_order.status = 'pendente' THEN
    RAISE EXCEPTION 'Aguarda libertação do escritório — esta encomenda ainda não está ativa na produção.';
  END IF;

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

  -- "Iniciar" num volume já iniciado e em pausa = retomar (não perder o tempo de pausa)
  IF _event='iniciar' AND v_cs.started_at IS NOT NULL AND v_cs.is_paused THEN
    v_effective := 'retomar';
  END IF;

  -- Idempotência
  IF v_cs.status='concluida' THEN
    RETURN jsonb_build_object('ok', true, 'repeated', true, 'status', 'concluida');
  END IF;
  IF v_effective='iniciar' AND v_cs.status='em_curso' AND NOT v_cs.is_paused THEN
    RETURN jsonb_build_object('ok', true, 'repeated', true, 'status', 'em_curso');
  END IF;
  IF v_effective='pausar' AND v_cs.is_paused THEN
    RETURN jsonb_build_object('ok', true, 'repeated', true, 'is_paused', true);
  END IF;
  IF v_effective='retomar' AND NOT v_cs.is_paused AND v_cs.started_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'repeated', true, 'is_paused', false);
  END IF;
  IF v_effective='finalizar' AND v_cs.started_at IS NULL THEN RAISE EXCEPTION 'Não se pode finalizar um coli que não foi iniciado'; END IF;
  IF v_effective='retomar' AND v_cs.started_at IS NULL THEN RAISE EXCEPTION 'Coli não está em pausa'; END IF;

  IF v_effective='iniciar' THEN
    UPDATE public.order_coli_stages SET
      status='em_curso'::stage_status,
      started_at=COALESCE(started_at, v_now),
      last_resume_at=v_now,
      pause_started_at=NULL,
      is_paused=false,
      operator_id=v_op.id
    WHERE id=_order_coli_stage_id;

  ELSIF v_effective='pausar' THEN
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

  ELSIF v_effective='retomar' THEN
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

  ELSIF v_effective='finalizar' THEN
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

  RETURN jsonb_build_object('ok', true, 'event', v_effective);
END;
$function$;