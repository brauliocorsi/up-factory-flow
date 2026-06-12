
-- 1) Colunas para cronómetro por coli
ALTER TABLE public.order_coli_stages
  ADD COLUMN IF NOT EXISTS last_resume_at timestamptz,
  ADD COLUMN IF NOT EXISTS pause_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes text;

-- 2) GRANTs (idempotentes)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_colis TO authenticated;
GRANT ALL ON public.order_colis TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_coli_stages TO authenticated;
GRANT ALL ON public.order_coli_stages TO service_role;

-- 3) Realtime
DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='order_colis';
  IF NOT FOUND THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.order_colis';
  END IF;
  PERFORM 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='order_coli_stages';
  IF NOT FOUND THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.order_coli_stages';
  END IF;
END $$;

-- 4) Função auxiliar: sincroniza order_stages a partir do agregado dos colis
CREATE OR REPLACE FUNCTION public.sync_order_stage_from_colis(_order_id uuid, _stage public.production_stage)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int;
  v_done int;
  v_running int;
  v_paused int;
  v_prod int;
  v_pause int;
  v_min_started timestamptz;
  v_max_finished timestamptz;
  v_last_op uuid;
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status='concluida'),
    COUNT(*) FILTER (WHERE status='em_curso' AND NOT is_paused),
    COUNT(*) FILTER (WHERE is_paused),
    COALESCE(SUM(productive_seconds),0),
    COALESCE(SUM(paused_seconds),0),
    MIN(started_at),
    MAX(finished_at)
    INTO v_total, v_done, v_running, v_paused, v_prod, v_pause, v_min_started, v_max_finished
  FROM public.order_coli_stages
  WHERE order_id=_order_id AND stage=_stage;

  IF v_total = 0 THEN
    RETURN;
  END IF;

  SELECT operator_id INTO v_last_op
  FROM public.order_coli_stages
  WHERE order_id=_order_id AND stage=_stage AND operator_id IS NOT NULL
  ORDER BY COALESCE(finished_at, started_at, created_at) DESC NULLS LAST
  LIMIT 1;

  UPDATE public.order_stages SET
    status = CASE
      WHEN v_done = v_total THEN 'concluida'::stage_status
      WHEN v_running > 0 THEN 'em_curso'::stage_status
      WHEN v_paused > 0 THEN 'em_curso'::stage_status
      WHEN v_done > 0 THEN 'em_curso'::stage_status
      ELSE status
    END,
    is_paused = (v_paused > 0 AND v_running = 0),
    productive_seconds = v_prod,
    paused_seconds = v_pause,
    started_at = COALESCE(started_at, v_min_started),
    finished_at = CASE WHEN v_done = v_total THEN COALESCE(v_max_finished, now()) ELSE finished_at END,
    check_valid = CASE WHEN v_done = v_total THEN true ELSE check_valid END,
    operator_id = COALESCE(v_last_op, operator_id),
    updated_at = now()
  WHERE order_id=_order_id AND stage=_stage;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_order_stage_from_colis(uuid, public.production_stage) TO authenticated, service_role;

-- 5) RPC principal: eventos por coli
CREATE OR REPLACE FUNCTION public.record_coli_stage_event(
  _order_coli_stage_id uuid,
  _operator_code text,
  _event text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op public.operators;
  v_cs public.order_coli_stages;
  v_linked boolean;
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

  -- Validações
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

  -- Sincronizar order_stages agregado
  PERFORM public.sync_order_stage_from_colis(v_cs.order_id, v_cs.stage);

  RETURN jsonb_build_object('ok', true, 'event', _event);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_coli_stage_event(uuid, text, text) TO authenticated, service_role;
