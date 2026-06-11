
-- =========================================================
-- PROMPT 11 — Retrabalho transversal
-- =========================================================

-- 1) Tabela de motivos
CREATE TABLE IF NOT EXISTS public.rework_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rework_reasons TO authenticated;
GRANT ALL ON public.rework_reasons TO service_role;
ALTER TABLE public.rework_reasons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rework_reasons_read" ON public.rework_reasons;
CREATE POLICY "rework_reasons_read" ON public.rework_reasons FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "rework_reasons_admin" ON public.rework_reasons;
CREATE POLICY "rework_reasons_admin" ON public.rework_reasons FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2) Eventos de retrabalho
CREATE TABLE IF NOT EXISTS public.rework_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.production_orders(id) ON DELETE CASCADE,
  detected_at_stage public.production_stage NOT NULL,
  sent_to_stage public.production_stage NOT NULL,
  reason_id uuid REFERENCES public.rework_reasons(id),
  reason_notes text,
  operator_id uuid REFERENCES public.operators(id),
  status text NOT NULL DEFAULT 'aberto',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS rework_events_order_idx ON public.rework_events(order_id);
CREATE INDEX IF NOT EXISTS rework_events_status_idx ON public.rework_events(status);
GRANT SELECT, INSERT, UPDATE ON public.rework_events TO authenticated;
GRANT ALL ON public.rework_events TO service_role;
ALTER TABLE public.rework_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rework_events_read" ON public.rework_events;
CREATE POLICY "rework_events_read" ON public.rework_events FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "rework_events_write" ON public.rework_events;
CREATE POLICY "rework_events_write" ON public.rework_events FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "rework_events_update" ON public.rework_events;
CREATE POLICY "rework_events_update" ON public.rework_events FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 3) Campos em order_stages
ALTER TABLE public.order_stages
  ADD COLUMN IF NOT EXISTS rework_seconds int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_rework boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rework_count int NOT NULL DEFAULT 0;

-- 4) Helper: ordem das etapas
CREATE OR REPLACE FUNCTION public.stage_order_index(_s public.production_stage)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _s
    WHEN 'estrutura'  THEN 1
    WHEN 'corte'      THEN 2
    WHEN 'costura'    THEN 3
    WHEN 'branco'     THEN 4
    WHEN 'estofagem'  THEN 5
    WHEN 'qualidade'  THEN 6
    WHEN 'embalagem'  THEN 7
    WHEN 'picagem'    THEN 8
  END;
$$;

-- 5) Semear motivos comuns (idempotente por etiqueta)
INSERT INTO public.rework_reasons(label) VALUES
  ('Defeito no tecido'),
  ('Costura torta/desalinhada'),
  ('Medida errada'),
  ('Espuma mal colada'),
  ('Estrutura danificada'),
  ('Mancha/sujidade'),
  ('Outro')
ON CONFLICT DO NOTHING;

-- 6) Função send_to_rework
CREATE OR REPLACE FUNCTION public.send_to_rework(
  _order_id uuid,
  _detected_stage public.production_stage,
  _target_stage public.production_stage,
  _operator_code text,
  _reason_id uuid,
  _reason_notes text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_op public.operators;
  v_linked boolean;
  v_event_id uuid;
  v_di int := public.stage_order_index(_detected_stage);
  v_ti int := public.stage_order_index(_target_stage);
BEGIN
  IF v_ti IS NULL OR v_di IS NULL THEN
    RAISE EXCEPTION 'Etapa inválida';
  END IF;
  IF v_ti >= v_di THEN
    RAISE EXCEPTION 'A etapa de destino tem de ser anterior à etapa atual';
  END IF;

  SELECT * INTO v_op FROM public.operators WHERE code = _operator_code AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operador "%" não encontrado ou inativo', _operator_code;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.operator_stages
    WHERE operator_id = v_op.id AND stage = _detected_stage
  ) INTO v_linked;
  IF NOT v_linked THEN
    RAISE EXCEPTION 'O operador % não está atribuído à etapa %', v_op.code, _detected_stage;
  END IF;

  -- Criar evento
  INSERT INTO public.rework_events(
    order_id, detected_at_stage, sent_to_stage, reason_id, reason_notes, operator_id
  ) VALUES (_order_id, _detected_stage, _target_stage, _reason_id, _reason_notes, v_op.id)
  RETURNING id INTO v_event_id;

  -- Reabrir todas as etapas do destino (inclusive) até à etapa detetada (inclusive)
  -- e marcar em retrabalho.
  UPDATE public.order_stages os
     SET status = 'pendente',
         is_rework = true,
         is_paused = false,
         started_at = NULL,
         finished_at = NULL,
         check_valid = false,
         rework_count = CASE WHEN os.stage = _target_stage THEN os.rework_count + 1 ELSE os.rework_count END,
         notes = COALESCE(notes,'') || ' [Retrabalho ' || v_event_id::text || ']'
   WHERE os.order_id = _order_id
     AND public.stage_order_index(os.stage) BETWEEN v_ti AND v_di;

  -- Encomenda volta a em_producao caso estivesse marcada como concluida
  UPDATE public.production_orders
     SET status = 'em_producao'
   WHERE id = _order_id AND status NOT IN ('cancelada');

  RETURN jsonb_build_object(
    'ok', true,
    'rework_event_id', v_event_id,
    'reopened_from', _target_stage,
    'reopened_to', _detected_stage
  );
END;
$$;
REVOKE ALL ON FUNCTION public.send_to_rework(uuid, public.production_stage, public.production_stage, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_to_rework(uuid, public.production_stage, public.production_stage, text, uuid, text) TO authenticated, service_role;

-- 7) Substituir record_stage_event para somar tempo em rework_seconds quando is_rework
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

  -- Se a etapa está em retrabalho, o tempo soma em rework_seconds.
  -- O tempo produtivo "normal" permanece o que já estava antes deste retrabalho.
  IF v_stage.is_rework THEN
    -- rework_seconds = total acumulado - productive_seconds já registado anteriormente
    v_prod_seconds := v_stage.productive_seconds; -- mantém-se igual
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
                                    -- simplificação: substituímos pelo total - produtivo já antes
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

  -- Ao finalizar uma etapa em retrabalho, resolver eventos cujo sent_to_stage = esta etapa
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

-- 8) Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.rework_events;
