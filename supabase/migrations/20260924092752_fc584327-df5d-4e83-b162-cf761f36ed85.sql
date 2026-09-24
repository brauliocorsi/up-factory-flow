
CREATE TABLE public.pause_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  requires_note boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.pause_reasons TO authenticated;
GRANT ALL ON public.pause_reasons TO service_role;
ALTER TABLE public.pause_reasons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pause_reasons read" ON public.pause_reasons FOR SELECT TO authenticated USING (true);
CREATE POLICY "pause_reasons insert office" ON public.pause_reasons FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));
CREATE POLICY "pause_reasons update office" ON public.pause_reasons FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));
CREATE TRIGGER trg_pause_reasons_updated BEFORE UPDATE ON public.pause_reasons FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.pause_reasons(label, sort_order, requires_note) VALUES
 ('Organização de Material',1,false),('Casa de Banho',2,false),('Escritório',3,false),
 ('Falta de material',4,false),('Manutenção de máquina',5,false),('Outro',99,true);

CREATE TABLE public.stage_pauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_coli_stage_id uuid NOT NULL REFERENCES public.order_coli_stages(id) ON DELETE CASCADE,
  order_id uuid,
  stage production_stage,
  operator_id uuid REFERENCES public.operators(id),
  reason_id uuid REFERENCES public.pause_reasons(id),
  notes text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stage_pauses_op_time ON public.stage_pauses(operator_id, started_at);
CREATE INDEX stage_pauses_open ON public.stage_pauses(order_coli_stage_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS cswi_op_time ON public.coli_stage_work_intervals(operator_id, started_at);
GRANT SELECT ON public.stage_pauses TO authenticated;
GRANT ALL ON public.stage_pauses TO service_role;
ALTER TABLE public.stage_pauses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stage_pauses read office" ON public.stage_pauses FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));

-- Abre/fecha pausas automaticamente a partir do histórico de eventos
CREATE OR REPLACE FUNCTION public.coli_logs_track_pauses()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.event = 'pausar' THEN
    INSERT INTO public.stage_pauses(order_coli_stage_id, order_id, stage, operator_id, started_at)
    VALUES (NEW.order_coli_stage_id, NEW.order_id, NEW.stage, NEW.operator_id, NEW.event_at);
  ELSIF NEW.event IN ('retomar','finalizar','iniciar','cancelar_inicio') THEN
    UPDATE public.stage_pauses SET ended_at = NEW.event_at
     WHERE order_coli_stage_id = NEW.order_coli_stage_id AND ended_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.coli_logs_track_pauses() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_coli_logs_track_pauses AFTER INSERT ON public.coli_stage_time_logs
  FOR EACH ROW EXECUTE FUNCTION public.coli_logs_track_pauses();

-- Guardar motivo nas pausas abertas do operador (sem motivo ainda)
CREATE OR REPLACE FUNCTION public.set_open_pause_reason(_operator_code text, _reason_id uuid, _notes text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_op public.operators; v_n int; v_r public.pause_reasons;
BEGIN
  SELECT * INTO v_op FROM public.operators WHERE code=_operator_code AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operador não encontrado'; END IF;
  PERFORM public.assert_operator_is_session(v_op);
  SELECT * INTO v_r FROM public.pause_reasons WHERE id=_reason_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Motivo de pausa inválido'; END IF;
  IF v_r.requires_note AND COALESCE(btrim(_notes),'') = '' THEN RAISE EXCEPTION 'Indica o motivo da pausa'; END IF;
  UPDATE public.stage_pauses SET reason_id=_reason_id, notes=NULLIF(btrim(_notes),'')
   WHERE operator_id=v_op.id AND ended_at IS NULL AND reason_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_open_pause_reason(text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_open_pause_reason(text,uuid,text) TO authenticated;

-- Cancelar início por engano
CREATE OR REPLACE FUNCTION public.cancel_coli_stage_start(_order_coli_stage_id uuid, _operator_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_op public.operators; v_cs public.order_coli_stages; v_office boolean;
BEGIN
  v_office := public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio');
  SELECT * INTO v_op FROM public.operators WHERE code=_operator_code AND active;
  IF NOT v_office THEN
    IF v_op.id IS NULL THEN RAISE EXCEPTION 'Operador não encontrado'; END IF;
    PERFORM public.assert_operator_is_session(v_op);
  END IF;
  SELECT * INTO v_cs FROM public.order_coli_stages WHERE id=_order_coli_stage_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Etapa não encontrada'; END IF;
  IF v_cs.status <> 'em_curso' THEN RAISE EXCEPTION 'Só é possível cancelar uma etapa em curso.'; END IF;
  IF NOT v_office THEN
    IF v_cs.operator_id IS DISTINCT FROM v_op.id THEN RAISE EXCEPTION 'Só quem iniciou pode cancelar.'; END IF;
    IF v_cs.started_at < now() - interval '10 minutes' THEN RAISE EXCEPTION 'Passaram mais de 10 minutos — pede ao escritório para cancelar.'; END IF;
    IF v_cs.paused_seconds > 0 OR v_cs.is_paused THEN RAISE EXCEPTION 'Etapa já teve pausas — pede ao escritório para cancelar.'; END IF;
  END IF;
  UPDATE public.order_coli_stages SET status='pendente', started_at=NULL, finished_at=NULL,
    last_resume_at=NULL, pause_started_at=NULL, is_paused=false, operator_id=NULL,
    productive_seconds=0, paused_seconds=0
   WHERE id=_order_coli_stage_id;
  DELETE FROM public.coli_stage_work_intervals WHERE order_coli_stage_id=_order_coli_stage_id;
  INSERT INTO public.coli_stage_time_logs(order_coli_stage_id, order_id, order_coli_id, stage, operator_id, event, event_at)
  VALUES (_order_coli_stage_id, v_cs.order_id, v_cs.order_coli_id, v_cs.stage, COALESCE(v_op.id, v_cs.operator_id), 'cancelar_inicio', now());
  DELETE FROM public.stage_pauses WHERE order_coli_stage_id=_order_coli_stage_id;
  PERFORM public.sync_order_stage_from_colis(v_cs.order_id, v_cs.stage);
  -- resumo: se nenhum volume ficou iniciado, repõe a etapa da encomenda
  UPDATE public.order_stages os SET status='pendente', started_at=NULL, operator_id=NULL, is_paused=false,
      productive_seconds=0, paused_seconds=0
   WHERE os.order_id=v_cs.order_id AND os.stage=v_cs.stage AND os.status <> 'concluida'
     AND NOT EXISTS (SELECT 1 FROM public.order_coli_stages c WHERE c.order_id=v_cs.order_id AND c.stage=v_cs.stage AND c.started_at IS NOT NULL);
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.cancel_coli_stage_start(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_coli_stage_start(uuid,text) TO authenticated;

-- Relatório de ocioso/pausas (minuto a minuto dentro do turno)
CREATE OR REPLACE FUNCTION public.idle_report_impl(_from date, _to date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
WITH days AS (
  SELECT d::date AS day FROM generate_series(_from, _to, interval '1 day') d
  WHERE extract(isodow FROM d) < 6
), blocks(bs, be) AS (VALUES (480,600),(615,720),(810,960),(975,1050)),
mins AS (
  SELECT dy.day, m,
    timezone('Europe/Lisbon', dy.day::timestamp + make_interval(mins => m)) AS t
  FROM days dy CROSS JOIN blocks b CROSS JOIN LATERAL generate_series(b.bs, b.be-1) m
), mins_el AS (SELECT * FROM mins WHERE t < now()),
work AS (
  SELECT operator_id, started_at s, ended_at e FROM coli_stage_work_intervals
   WHERE started_at < timezone('Europe/Lisbon', (_to+1)::timestamp) AND ended_at >= timezone('Europe/Lisbon', _from::timestamp)
  UNION ALL
  SELECT operator_id, last_resume_at, now() FROM order_coli_stages
   WHERE status='em_curso' AND NOT is_paused AND last_resume_at IS NOT NULL AND operator_id IS NOT NULL
), pauses AS (
  SELECT p.operator_id, p.started_at s, COALESCE(p.ended_at, now()) e, COALESCE(r.label,'Sem motivo') reason
  FROM stage_pauses p LEFT JOIN pause_reasons r ON r.id=p.reason_id
  WHERE p.started_at < timezone('Europe/Lisbon', (_to+1)::timestamp) AND COALESCE(p.ended_at, now()) >= timezone('Europe/Lisbon', _from::timestamp)
), present AS (
  SELECT DISTINCT operator_id, (timezone('Europe/Lisbon', s))::date AS day FROM work
  UNION SELECT DISTINCT operator_id, (timezone('Europe/Lisbon', s))::date FROM pauses
  UNION SELECT operator_id, work_date FROM stage_day_assignment WHERE present AND work_date BETWEEN _from AND _to
), grid AS (
  SELECT pr.operator_id, me.day, me.m,
    CASE WHEN EXISTS (SELECT 1 FROM work w WHERE w.operator_id=pr.operator_id AND w.s <= me.t + interval '30 seconds' AND w.e > me.t + interval '30 seconds') THEN 'prod'
         ELSE COALESCE((SELECT 'pausa:'||p.reason FROM pauses p WHERE p.operator_id=pr.operator_id AND p.s <= me.t + interval '30 seconds' AND p.e > me.t + interval '30 seconds' LIMIT 1), 'ocioso') END AS st
  FROM present pr JOIN mins_el me ON me.day = pr.day
), isl AS (
  SELECT *, m - row_number() OVER (PARTITION BY operator_id, day, st ORDER BY m) AS g FROM grid
), segs AS (
  SELECT operator_id, day, st, min(m) AS a, max(m)+1 AS b FROM isl GROUP BY operator_id, day, st, g
), per AS (
  SELECT g.operator_id, g.day,
    count(*) FILTER (WHERE st='prod') prod, count(*) FILTER (WHERE st LIKE 'pausa:%') pausa,
    count(*) FILTER (WHERE st='ocioso') ocioso, count(*) total
  FROM grid g GROUP BY 1,2
)
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'operator_id', op.id, 'operator_code', op.code, 'operator_name', op.name, 'day', per.day,
  'productive_min', per.prod, 'pause_min', per.pausa, 'idle_min', per.ocioso, 'shift_min', per.total,
  'pause_by_reason', COALESCE((SELECT jsonb_object_agg(r, n) FROM (SELECT substr(st,7) r, count(*) n FROM grid g WHERE g.operator_id=per.operator_id AND g.day=per.day AND st LIKE 'pausa:%' GROUP BY 1) x), '{}'::jsonb),
  'segments', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', split_part(st,':',1), 'reason', NULLIF(substr(st,7),''), 'from', a, 'to', b) ORDER BY a) FROM segs s WHERE s.operator_id=per.operator_id AND s.day=per.day), '[]'::jsonb),
  'current_pause_reason', (SELECT COALESCE(r.label,'Sem motivo') FROM stage_pauses p LEFT JOIN pause_reasons r ON r.id=p.reason_id WHERE p.operator_id=op.id AND p.ended_at IS NULL ORDER BY p.started_at DESC LIMIT 1)
) ORDER BY per.day, op.name), '[]'::jsonb)
FROM per JOIN operators op ON op.id=per.operator_id;
$$;
REVOKE EXECUTE ON FUNCTION public.idle_report_impl(date,date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_idle_report(_from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio')) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  IF _to - _from > 31 THEN RAISE EXCEPTION 'Período máximo: 31 dias'; END IF;
  RETURN public.idle_report_impl(_from, _to);
END $$;
REVOKE EXECUTE ON FUNCTION public.get_idle_report(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_idle_report(date,date) TO authenticated;
