-- 1) A dispensa geral de sequência por retrabalho é removida
CREATE OR REPLACE FUNCTION public.enforce_stage_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.order_coli_stages WHERE order_id = NEW.order_id) THEN
    RETURN NEW; -- resumo derivado dos volumes
  END IF;
  IF NEW.status IN ('em_curso','concluida')
     AND COALESCE(OLD.status::text, '') <> NEW.status::text THEN
    PERFORM public.assert_previous_stages_done(NEW.order_id, NEW.stage);
  END IF;
  RETURN NEW;
END;
$function$;

-- 2) Retrabalho com bloqueio, idempotência e âmbito por volume
CREATE OR REPLACE FUNCTION public.send_to_rework(
  _order_id uuid,
  _detected_stage public.production_stage,
  _target_stage public.production_stage,
  _operator_code text,
  _reason_id uuid,
  _reason_notes text,
  _order_coli_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op public.operators;
  v_order public.production_orders;
  v_linked boolean;
  v_event_id uuid;
  v_prev uuid;
  v_transferred int := 0;
  v_di int := public.stage_order_index(_detected_stage);
  v_ti int := public.stage_order_index(_target_stage);
BEGIN
  IF v_ti IS NULL OR v_di IS NULL THEN
    RAISE EXCEPTION 'Etapa inválida';
  END IF;
  IF NOT (_target_stage = ANY (public.stage_prerequisites(_detected_stage))) THEN
    RAISE EXCEPTION 'A etapa de destino não é uma etapa anterior de %', _detected_stage;
  END IF;

  SELECT * INTO v_op FROM public.operators WHERE code = _operator_code AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operador "%" não encontrado ou inativo', _operator_code;
  END IF;

  PERFORM public.assert_operator_is_session(v_op);

  SELECT EXISTS(
    SELECT 1 FROM public.operator_stages
    WHERE operator_id = v_op.id AND stage = _detected_stage
  ) INTO v_linked;
  IF NOT v_linked THEN
    RAISE EXCEPTION 'O operador % não está atribuído à etapa %', v_op.code, _detected_stage;
  END IF;

  -- Bloqueio da encomenda: evita dois retrabalhos simultâneos
  SELECT * INTO v_order FROM public.production_orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Encomenda não encontrada'; END IF;
  IF v_order.status = 'cancelada' THEN
    RAISE EXCEPTION 'Encomenda cancelada — não pode ir para retrabalho.';
  END IF;

  IF _order_coli_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.order_colis WHERE id = _order_coli_id AND order_id = _order_id
  ) THEN
    RAISE EXCEPTION 'O volume indicado não pertence a esta encomenda';
  END IF;

  -- Produto já transferido: exige correção administrativa explícita
  SELECT COUNT(*) INTO v_transferred FROM public.finished_goods
   WHERE order_id = _order_id AND status = 'transferido';
  IF v_transferred > 0 THEN
    RAISE EXCEPTION 'Produto já transferido para o armazém externo. Pede correção administrativa antes de reabrir a produção.';
  END IF;

  -- Idempotência: pedido repetido nos últimos 2 minutos devolve o mesmo evento
  SELECT id INTO v_prev FROM public.rework_events
   WHERE order_id = _order_id
     AND detected_at_stage = _detected_stage
     AND sent_to_stage = _target_stage
     AND operator_id = v_op.id
     AND status = 'aberto'
     AND created_at > now() - interval '2 minutes'
   ORDER BY created_at DESC LIMIT 1;
  IF v_prev IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'repeated', true, 'rework_event_id', v_prev);
  END IF;

  INSERT INTO public.rework_events(
    order_id, detected_at_stage, sent_to_stage, reason_id, reason_notes, operator_id
  ) VALUES (_order_id, _detected_stage, _target_stage, _reason_id, _reason_notes, v_op.id)
  RETURNING id INTO v_event_id;

  -- Etapas dos volumes afetados (todos ou apenas o volume indicado)
  UPDATE public.order_coli_stages cs
     SET status = 'pendente',
         is_paused = false,
         started_at = NULL,
         finished_at = NULL,
         last_resume_at = NULL,
         pause_started_at = NULL,
         notes = COALESCE(cs.notes,'') || ' [Retrabalho ' || v_event_id::text || ']'
   WHERE cs.order_id = _order_id
     AND (_order_coli_id IS NULL OR cs.order_coli_id = _order_coli_id)
     AND public.stage_order_index(cs.stage) <= v_di
     AND (cs.stage = _target_stage OR _target_stage = ANY (public.stage_prerequisites(cs.stage)));

  -- Resumo da encomenda: recalculado a partir dos volumes quando existem
  IF EXISTS (SELECT 1 FROM public.order_coli_stages WHERE order_id = _order_id) THEN
    PERFORM public.sync_order_stage_from_colis(_order_id, s.stage)
      FROM (SELECT DISTINCT stage FROM public.order_coli_stages WHERE order_id = _order_id) s;
    UPDATE public.order_stages os
       SET is_rework = true,
           rework_count = CASE WHEN os.stage = _target_stage THEN os.rework_count + 1 ELSE os.rework_count END,
           notes = COALESCE(os.notes,'') || ' [Retrabalho ' || v_event_id::text || ']'
     WHERE os.order_id = _order_id
       AND (os.stage = _target_stage OR _target_stage = ANY (public.stage_prerequisites(os.stage)));
  ELSE
    UPDATE public.order_stages os
       SET status = 'pendente',
           is_rework = true,
           is_paused = false,
           started_at = NULL,
           finished_at = NULL,
           check_valid = false,
           rework_count = CASE WHEN os.stage = _target_stage THEN os.rework_count + 1 ELSE os.rework_count END,
           notes = COALESCE(os.notes,'') || ' [Retrabalho ' || v_event_id::text || ']'
     WHERE os.order_id = _order_id
       AND public.stage_order_index(os.stage) <= v_di
       AND (os.stage = _target_stage OR _target_stage = ANY (public.stage_prerequisites(os.stage)));
  END IF;

  -- Produto deixa de estar disponível para transferência
  UPDATE public.finished_goods
     SET ready_for_transfer = false
   WHERE order_id = _order_id AND status <> 'transferido';

  UPDATE public.production_orders
     SET status = 'em_producao'
   WHERE id = _order_id AND status NOT IN ('cancelada');

  RETURN jsonb_build_object(
    'ok', true,
    'rework_event_id', v_event_id,
    'scope', CASE WHEN _order_coli_id IS NULL THEN 'encomenda' ELSE 'volume' END,
    'reopened_from', _target_stage,
    'reopened_to', _detected_stage
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.send_to_rework(uuid, public.production_stage, public.production_stage, text, uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_to_rework(uuid, public.production_stage, public.production_stage, text, uuid, text, uuid) TO authenticated;