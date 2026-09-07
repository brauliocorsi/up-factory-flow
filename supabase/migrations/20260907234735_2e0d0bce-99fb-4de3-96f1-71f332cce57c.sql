-- Fase 6: marcação de registos de teste + vigilância de operações esquecidas

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_production_orders_is_test
  ON public.production_orders (is_test) WHERE is_test = true;

-- Marcar/desmarcar encomendas como teste (só admin/escritório)
CREATE OR REPLACE FUNCTION public.set_orders_test_flag(_order_ids uuid[], _is_test boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _n integer := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida';
  END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'escritorio')) THEN
    RAISE EXCEPTION 'Sem permissão para marcar encomendas de teste';
  END IF;
  IF _order_ids IS NULL OR array_length(_order_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.production_orders
     SET is_test = _is_test
   WHERE id = ANY(_order_ids)
     AND is_test IS DISTINCT FROM _is_test;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.set_orders_test_flag(uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_orders_test_flag(uuid[], boolean) TO authenticated;

-- Operações esquecidas: em curso, sem pausa, há mais de _min_hours
CREATE OR REPLACE FUNCTION public.list_forgotten_stages(_min_hours numeric DEFAULT 12)
RETURNS TABLE (
  order_coli_stage_id uuid,
  order_id uuid,
  order_number text,
  coli_number integer,
  total_colis integer,
  stage production_stage,
  operator_id uuid,
  operator_code text,
  operator_name text,
  started_at timestamptz,
  hours_running numeric,
  is_test boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida';
  END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'escritorio')) THEN
    RAISE EXCEPTION 'Sem permissão para consultar operações esquecidas';
  END IF;

  RETURN QUERY
  SELECT ocs.id,
         ocs.order_id,
         po.order_number,
         oc.coli_number,
         (SELECT count(*)::int FROM public.order_colis x WHERE x.order_id = ocs.order_id),
         ocs.stage,
         ocs.operator_id,
         op.code,
         op.name,
         ocs.started_at,
         round(EXTRACT(EPOCH FROM (now() - ocs.started_at)) / 3600.0, 1),
         po.is_test
    FROM public.order_coli_stages ocs
    JOIN public.order_colis oc ON oc.id = ocs.order_coli_id
    JOIN public.production_orders po ON po.id = ocs.order_id
    LEFT JOIN public.operators op ON op.id = ocs.operator_id
   WHERE ocs.status = 'em_curso'
     AND ocs.is_paused = false
     AND ocs.started_at IS NOT NULL
     AND ocs.started_at < now() - make_interval(mins => (GREATEST(_min_hours, 0) * 60)::int)
     AND po.status <> 'cancelada'
   ORDER BY ocs.started_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_forgotten_stages(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_forgotten_stages(numeric) TO authenticated;

-- Pausar por correção uma operação esquecida (só admin/escritório)
CREATE OR REPLACE FUNCTION public.admin_pause_forgotten_stage(_order_coli_stage_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.order_coli_stages;
  _elapsed integer;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida';
  END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'escritorio')) THEN
    RAISE EXCEPTION 'Sem permissão para corrigir operações';
  END IF;

  SELECT * INTO _row FROM public.order_coli_stages
   WHERE id = _order_coli_stage_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Operação não encontrada');
  END IF;
  IF _row.status <> 'em_curso' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'A operação já não está em curso');
  END IF;
  IF _row.is_paused THEN
    RETURN jsonb_build_object('ok', true, 'message', 'A operação já estava em pausa');
  END IF;

  _elapsed := GREATEST(
    0,
    EXTRACT(EPOCH FROM (now() - COALESCE(_row.last_resume_at, _row.started_at, now())))::int
  );

  UPDATE public.order_coli_stages
     SET is_paused = true,
         pause_started_at = now(),
         last_resume_at = NULL,
         productive_seconds = COALESCE(productive_seconds, 0) + _elapsed,
         notes = COALESCE(notes || E'\n', '') ||
                 'Pausa por correção (' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ')'
                 || COALESCE(': ' || NULLIF(btrim(_reason), ''), '')
   WHERE id = _order_coli_stage_id;

  RETURN jsonb_build_object('ok', true, 'message', 'Operação colocada em pausa');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_pause_forgotten_stage(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pause_forgotten_stage(uuid, text) TO authenticated;