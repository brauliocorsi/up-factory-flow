
-- 1) Registo de eventos por volume
CREATE TABLE IF NOT EXISTS public.coli_stage_time_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_coli_stage_id uuid NOT NULL REFERENCES public.order_coli_stages(id) ON DELETE CASCADE,
  order_id uuid,
  order_coli_id uuid,
  stage public.production_stage,
  operator_id uuid REFERENCES public.operators(id),
  event text NOT NULL,
  event_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coli_stage_time_logs_stage ON public.coli_stage_time_logs(order_coli_stage_id, event_at);
GRANT SELECT ON public.coli_stage_time_logs TO authenticated;
GRANT ALL ON public.coli_stage_time_logs TO service_role;
ALTER TABLE public.coli_stage_time_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read coli_stage_time_logs" ON public.coli_stage_time_logs;
CREATE POLICY "read coli_stage_time_logs" ON public.coli_stage_time_logs
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio')
  );

-- 2) Períodos de trabalho efetivo por pessoa
CREATE TABLE IF NOT EXISTS public.coli_stage_work_intervals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_coli_stage_id uuid NOT NULL REFERENCES public.order_coli_stages(id) ON DELETE CASCADE,
  order_id uuid,
  order_coli_id uuid,
  stage public.production_stage,
  operator_id uuid REFERENCES public.operators(id),
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  seconds int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coli_work_intervals_op ON public.coli_stage_work_intervals(operator_id, started_at);
CREATE INDEX IF NOT EXISTS idx_coli_work_intervals_stage ON public.coli_stage_work_intervals(order_coli_stage_id, started_at);
GRANT SELECT ON public.coli_stage_work_intervals TO authenticated;
GRANT ALL ON public.coli_stage_work_intervals TO service_role;
ALTER TABLE public.coli_stage_work_intervals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read coli_stage_work_intervals" ON public.coli_stage_work_intervals;
CREATE POLICY "read coli_stage_work_intervals" ON public.coli_stage_work_intervals
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio')
  );

-- 3) record_coli_stage_event passa a escrever o histórico
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
  v_seg_start timestamptz;
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

  IF _event='iniciar' AND v_cs.started_at IS NOT NULL AND v_cs.is_paused THEN
    v_effective := 'retomar';
  END IF;

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
      v_seg_start := v_cs.last_resume_at;
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
      v_seg_start := v_cs.last_resume_at;
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

  -- Histórico do evento
  INSERT INTO public.coli_stage_time_logs(
    order_coli_stage_id, order_id, order_coli_id, stage, operator_id, event, event_at)
  VALUES (_order_coli_stage_id, v_cs.order_id, v_cs.order_coli_id, v_cs.stage, v_op.id, v_effective, v_now);

  -- Período de trabalho efetivo fechado neste evento
  IF v_seg_start IS NOT NULL AND v_delta_prod > 0 THEN
    INSERT INTO public.coli_stage_work_intervals(
      order_coli_stage_id, order_id, order_coli_id, stage, operator_id, started_at, ended_at, seconds)
    VALUES (_order_coli_stage_id, v_cs.order_id, v_cs.order_coli_id, v_cs.stage,
            COALESCE(v_cs.operator_id, v_op.id), v_seg_start, v_now, v_delta_prod);
  END IF;

  PERFORM public.sync_order_stage_from_colis(v_cs.order_id, v_cs.stage);

  RETURN jsonb_build_object('ok', true, 'event', v_effective);
END;
$function$;

REVOKE ALL ON FUNCTION public.record_coli_stage_event(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_coli_stage_event(uuid, text, text) TO authenticated;

-- 4) Repartição por pessoa e por dia (Europe/Lisbon)
CREATE OR REPLACE FUNCTION public.labor_by_person(_from date, _to date)
RETURNS TABLE(day date, operator_id uuid, operator_code text, operator_name text, seconds bigint, stages bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio')) THEN
    RAISE EXCEPTION 'Sem permissão para consultar tempos por pessoa';
  END IF;
  IF _to < _from THEN RAISE EXCEPTION 'Intervalo de datas inválido'; END IF;

  RETURN QUERY
  WITH days AS (
    SELECT d::date AS day,
           (d::date::timestamp AT TIME ZONE 'Europe/Lisbon') AS day_start,
           ((d::date + 1)::timestamp AT TIME ZONE 'Europe/Lisbon') AS day_end
    FROM generate_series(_from, _to, interval '1 day') d
  ),
  parts AS (
    SELECT dy.day,
           w.operator_id,
           w.order_coli_stage_id,
           GREATEST(0, EXTRACT(EPOCH FROM (
             LEAST(w.ended_at, dy.day_end) - GREATEST(w.started_at, dy.day_start)
           )))::bigint AS secs
    FROM public.coli_stage_work_intervals w
    JOIN public.production_orders o ON o.id = w.order_id
    JOIN days dy ON w.started_at < dy.day_end AND w.ended_at > dy.day_start
    WHERE COALESCE(o.is_test, false) = false
  )
  SELECT p.day,
         p.operator_id,
         op.code,
         op.name,
         SUM(p.secs)::bigint,
         COUNT(DISTINCT p.order_coli_stage_id)::bigint
  FROM parts p
  LEFT JOIN public.operators op ON op.id = p.operator_id
  GROUP BY p.day, p.operator_id, op.code, op.name
  HAVING SUM(p.secs) > 0
  ORDER BY p.day DESC, SUM(p.secs) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.labor_by_person(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labor_by_person(date, date) TO authenticated;
