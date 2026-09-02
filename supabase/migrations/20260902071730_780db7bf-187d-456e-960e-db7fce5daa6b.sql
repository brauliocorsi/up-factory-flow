-- 1) Não cancelar encomendas concluídas / em armazém
CREATE OR REPLACE FUNCTION public.cancel_order_with_recovery(_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status public.order_status;
BEGIN
  SELECT status INTO v_status FROM public.production_orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Encomenda não encontrada'; END IF;
  IF v_status = 'cancelada' THEN RAISE EXCEPTION 'Encomenda já cancelada'; END IF;
  IF v_status IN ('concluida','em_armazem') THEN
    RAISE EXCEPTION 'Encomenda já concluída/expedida — não pode ser cancelada';
  END IF;
  RETURN public.cancel_order_with_recovery_impl(_order_id);
END;
$function$;

-- 2) Cascos: validar vínculo de etapa e propriedade do lote
CREATE OR REPLACE FUNCTION public.assert_shell_batch_actor(_batch public.shell_batches, _op public.operators)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.operator_stages os
    WHERE os.operator_id = _op.id AND os.stage IN ('estrutura','branco')
  ) THEN
    RAISE EXCEPTION 'O operador % não está atribuído a estrutura/branco', _op.code;
  END IF;

  IF _batch.operator_id IS NOT NULL
     AND _batch.operator_id <> _op.id
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Lote iniciado por outro operador — só ele (ou um administrador) pode continuar';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assert_shell_batch_actor(public.shell_batches, public.operators) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_shell_batch_actor(public.shell_batches, public.operators) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_shell_batch_event(
  _batch_id uuid,
  _operator_code text,
  _event text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op public.operators;
  v_batch public.shell_batches;
  v_prod int := 0;
  v_pause int := 0;
  v_last_ts timestamptz;
  v_last_event text;
  v_is_paused boolean := false;
  rec RECORD;
BEGIN
  IF _event NOT IN ('pausar','retomar') THEN
    RAISE EXCEPTION 'Evento inválido para record_shell_batch_event: %', _event;
  END IF;

  SELECT * INTO v_op FROM public.operators WHERE code = _operator_code AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operador "%" não encontrado', _operator_code; END IF;

  SELECT * INTO v_batch FROM public.shell_batches WHERE id = _batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote não encontrado'; END IF;
  IF v_batch.status = 'concluido' THEN RAISE EXCEPTION 'Lote já concluído'; END IF;

  PERFORM public.assert_shell_batch_actor(v_batch, v_op);

  IF _event = 'pausar' AND v_batch.is_paused THEN RAISE EXCEPTION 'Lote já em pausa'; END IF;
  IF _event = 'retomar' AND NOT v_batch.is_paused THEN RAISE EXCEPTION 'Lote não está em pausa'; END IF;

  INSERT INTO public.shell_batch_logs(batch_id, operator_id, event) VALUES (_batch_id, v_op.id, _event);

  v_last_ts := NULL; v_last_event := NULL;
  FOR rec IN SELECT event, event_at FROM public.shell_batch_logs WHERE batch_id = _batch_id ORDER BY event_at ASC LOOP
    IF v_last_event IN ('iniciar','retomar') AND rec.event IN ('pausar','finalizar') THEN
      v_prod := v_prod + GREATEST(0, EXTRACT(EPOCH FROM (rec.event_at - v_last_ts))::int);
    ELSIF v_last_event = 'pausar' AND rec.event IN ('retomar','finalizar') THEN
      v_pause := v_pause + GREATEST(0, EXTRACT(EPOCH FROM (rec.event_at - v_last_ts))::int);
    END IF;
    v_last_event := rec.event; v_last_ts := rec.event_at;
  END LOOP;
  v_is_paused := (v_last_event = 'pausar');

  UPDATE public.shell_batches SET
    productive_seconds = v_prod,
    paused_seconds = v_pause,
    is_paused = v_is_paused
  WHERE id = _batch_id;

  RETURN jsonb_build_object('ok', true, 'productive_seconds', v_prod, 'paused_seconds', v_pause, 'is_paused', v_is_paused);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_shell_batch_event(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_shell_batch_event(uuid, text, text) TO authenticated, service_role;

-- finalize_shell_batch: adicionar a mesma validação no início (wrapper)
CREATE OR REPLACE FUNCTION public.finalize_shell_batch(_batch_id uuid, _operator_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op public.operators;
  v_batch public.shell_batches;
BEGIN
  SELECT * INTO v_op FROM public.operators WHERE code = _operator_code AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operador "%" não encontrado', _operator_code; END IF;

  SELECT * INTO v_batch FROM public.shell_batches WHERE id = _batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote não encontrado'; END IF;
  IF v_batch.status = 'concluido' THEN RAISE EXCEPTION 'Lote já concluído'; END IF;

  PERFORM public.assert_shell_batch_actor(v_batch, v_op);

  RETURN public.finalize_shell_batch_impl(_batch_id, _operator_code);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finalize_shell_batch(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_shell_batch(uuid, text) TO authenticated, service_role;

-- 3) Concluir grupo: não finalizar etapas nunca iniciadas
CREATE OR REPLACE FUNCTION public.finalize_stage_group(
  _order_stage_ids uuid[],
  _operator_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op public.operators;
  v_stage_id uuid;
  v_stage public.order_stages;
  v_processed int := 0;
  v_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  IF _order_stage_ids IS NULL OR array_length(_order_stage_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Lista vazia';
  END IF;

  SELECT * INTO v_op FROM public.operators WHERE code = _operator_code AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operador "%" não encontrado ou inativo', _operator_code;
  END IF;

  FOREACH v_stage_id IN ARRAY _order_stage_ids LOOP
    BEGIN
      SELECT * INTO v_stage FROM public.order_stages WHERE id = v_stage_id;
      IF NOT FOUND THEN
        v_errors := v_errors || jsonb_build_object('id', v_stage_id, 'error', 'Etapa não encontrada');
        CONTINUE;
      END IF;

      IF v_stage.status = 'concluida' THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      IF v_stage.status = 'bloqueada' THEN
        v_errors := v_errors || jsonb_build_object('id', v_stage_id, 'error', 'Etapa bloqueada');
        CONTINUE;
      END IF;

      IF v_stage.started_at IS NULL THEN
        v_errors := v_errors || jsonb_build_object('id', v_stage_id, 'error', 'Etapa não iniciada — inicia o grupo antes de concluir');
        CONTINUE;
      END IF;

      IF v_stage.is_paused THEN
        PERFORM public.record_stage_event(v_stage_id, _operator_code, 'retomar');
      END IF;

      PERFORM public.record_stage_event(v_stage_id, _operator_code, 'finalizar');
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('id', v_stage_id, 'error', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'processed', v_processed,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finalize_stage_group(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_stage_group(uuid[], text) TO authenticated, service_role;