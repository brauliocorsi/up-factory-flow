
-- ============================================================
-- PROMPT 7: Tela de Produção do Operador
-- ============================================================

-- 1. operator_stages: vínculo operador ↔ etapa
CREATE TABLE IF NOT EXISTS public.operator_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  stage public.production_stage NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operator_id, stage)
);

GRANT SELECT ON public.operator_stages TO authenticated;
GRANT ALL ON public.operator_stages TO service_role;

ALTER TABLE public.operator_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read operator_stages" ON public.operator_stages
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admins manage operator_stages" ON public.operator_stages
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 2. app_settings: configuração global (single row)
CREATE TABLE IF NOT EXISTS public.app_settings (
  id int PRIMARY KEY DEFAULT 1,
  identification_mode text NOT NULL DEFAULT 'codigo',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1),
  CONSTRAINT identification_mode_valid CHECK (identification_mode IN ('codigo','sessao'))
);

INSERT INTO public.app_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

GRANT SELECT ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read app_settings" ON public.app_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admins update app_settings" ON public.app_settings
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 3. stage_time_logs: eventos de tempo (iniciar/pausar/retomar/finalizar)
CREATE TABLE IF NOT EXISTS public.stage_time_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_stage_id uuid NOT NULL REFERENCES public.order_stages(id) ON DELETE CASCADE,
  operator_id uuid REFERENCES public.operators(id),
  event text NOT NULL CHECK (event IN ('iniciar','pausar','retomar','finalizar')),
  event_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stage_time_logs_order_stage ON public.stage_time_logs(order_stage_id, event_at);

GRANT SELECT, INSERT ON public.stage_time_logs TO authenticated;
GRANT ALL ON public.stage_time_logs TO service_role;

ALTER TABLE public.stage_time_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read stage_time_logs" ON public.stage_time_logs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated insert stage_time_logs" ON public.stage_time_logs
  FOR INSERT TO authenticated WITH CHECK (true);

-- 4. order_stages: colunas de medição de tempo
ALTER TABLE public.order_stages
  ADD COLUMN IF NOT EXISTS productive_seconds int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paused_seconds int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_paused boolean NOT NULL DEFAULT false;

-- 5. RPC: record_stage_event(order_stage_id, operator_code, event)
-- - Valida vínculo operador↔etapa
-- - Insere log
-- - Recalcula productive_seconds / paused_seconds a partir dos logs
-- - Atualiza order_stages.status, started_at, finished_at, is_paused
CREATE OR REPLACE FUNCTION public.record_stage_event(
  _order_stage_id uuid,
  _operator_code text,
  _event text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Verificar vínculo
  SELECT EXISTS(
    SELECT 1 FROM public.operator_stages
    WHERE operator_id = v_op.id AND stage = v_stage.stage
  ) INTO v_linked;
  IF NOT v_linked THEN
    RAISE EXCEPTION 'O operador % não está atribuído à etapa %', v_op.code, v_stage.stage;
  END IF;

  -- Validações de transição
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

  -- Inserir o evento
  INSERT INTO public.stage_time_logs(order_stage_id, operator_id, event)
    VALUES (_order_stage_id, v_op.id, _event);

  -- Recalcular totais a partir do histórico de logs
  v_last_ts := NULL;
  v_last_event := NULL;
  FOR rec IN
    SELECT event, event_at FROM public.stage_time_logs
     WHERE order_stage_id = _order_stage_id
     ORDER BY event_at ASC
  LOOP
    IF v_last_event IN ('iniciar','retomar') AND rec.event IN ('pausar','finalizar') THEN
      v_prod_seconds := v_prod_seconds + GREATEST(0, EXTRACT(EPOCH FROM (rec.event_at - v_last_ts))::int);
    ELSIF v_last_event = 'pausar' AND rec.event IN ('retomar','finalizar') THEN
      v_pause_seconds := v_pause_seconds + GREATEST(0, EXTRACT(EPOCH FROM (rec.event_at - v_last_ts))::int);
    END IF;
    v_last_event := rec.event;
    v_last_ts := rec.event_at;
  END LOOP;

  -- Determinar estado atual
  v_is_paused := (v_last_event = 'pausar');
  v_started_at := v_stage.started_at;
  v_finished_at := v_stage.finished_at;

  IF _event = 'iniciar' AND v_started_at IS NULL THEN
    v_started_at := now();
  END IF;
  IF _event = 'finalizar' THEN
    v_finished_at := now();
  END IF;

  -- Atualizar a etapa
  UPDATE public.order_stages
     SET productive_seconds = v_prod_seconds,
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
         check_valid = CASE WHEN _event = 'finalizar' THEN true ELSE check_valid END
   WHERE id = _order_stage_id;

  RETURN jsonb_build_object(
    'ok', true,
    'productive_seconds', v_prod_seconds,
    'paused_seconds', v_pause_seconds,
    'is_paused', v_is_paused,
    'operator', v_op.code
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_stage_event(uuid, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.record_stage_event(uuid, text, text) TO authenticated;

-- 6. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.stage_time_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.operator_stages;

-- 7. Seed: vincular operadores existentes à etapa estofagem
INSERT INTO public.operator_stages (operator_id, stage)
SELECT id, 'estofagem'::public.production_stage FROM public.operators WHERE code IN ('01','02','03')
ON CONFLICT DO NOTHING;
