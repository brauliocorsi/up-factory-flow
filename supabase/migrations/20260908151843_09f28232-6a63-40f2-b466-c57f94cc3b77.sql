CREATE OR REPLACE FUNCTION public.sync_order_stage_from_colis(_order_id uuid, _stage public.production_stage)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total int; v_done int; v_running int; v_paused int;
  v_prod int; v_pause int;
  v_min_started timestamptz; v_max_finished timestamptz;
  v_last_op uuid;
  v_status public.stage_status;
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
    RETURN; -- etapa não aplicável por volume: agregado é autoritativo
  END IF;

  SELECT operator_id INTO v_last_op
  FROM public.order_coli_stages
  WHERE order_id=_order_id AND stage=_stage AND operator_id IS NOT NULL
  ORDER BY COALESCE(finished_at, started_at, created_at) DESC NULLS LAST
  LIMIT 1;

  v_status := CASE
    WHEN v_done = v_total THEN 'concluida'::public.stage_status
    WHEN v_running > 0 OR v_paused > 0 OR v_done > 0 THEN 'em_curso'::public.stage_status
    WHEN v_min_started IS NOT NULL THEN 'em_curso'::public.stage_status
    ELSE 'pendente'::public.stage_status
  END;

  -- Garantir a linha de resumo (encomendas antigas podem não a ter)
  INSERT INTO public.order_stages(order_id, stage, status)
  VALUES (_order_id, _stage, v_status)
  ON CONFLICT (order_id, stage) DO NOTHING;

  UPDATE public.order_stages SET
    status = v_status,
    is_paused = (v_paused > 0 AND v_running = 0),
    productive_seconds = v_prod,
    paused_seconds = v_pause,
    started_at = CASE WHEN v_min_started IS NULL THEN NULL ELSE LEAST(COALESCE(started_at, v_min_started), v_min_started) END,
    finished_at = CASE WHEN v_done = v_total THEN COALESCE(v_max_finished, now()) ELSE NULL END,
    check_valid = CASE WHEN v_done = v_total THEN check_valid ELSE false END,
    operator_id = COALESCE(v_last_op, operator_id),
    updated_at = now()
  WHERE order_id=_order_id AND stage=_stage;
END;
$function$;