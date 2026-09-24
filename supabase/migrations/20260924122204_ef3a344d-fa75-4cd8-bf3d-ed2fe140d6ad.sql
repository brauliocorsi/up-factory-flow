ALTER TABLE public.stage_pauses ALTER COLUMN order_coli_stage_id DROP NOT NULL;
ALTER TABLE public.stage_pauses ADD COLUMN order_stage_id uuid REFERENCES public.order_stages(id) ON DELETE CASCADE;
ALTER TABLE public.stage_pauses ADD CONSTRAINT stage_pauses_source_chk CHECK (order_coli_stage_id IS NOT NULL OR order_stage_id IS NOT NULL);
CREATE INDEX stage_pauses_open_os ON public.stage_pauses(order_stage_id) WHERE ended_at IS NULL;

CREATE TABLE public.stage_work_intervals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_stage_id uuid NOT NULL REFERENCES public.order_stages(id) ON DELETE CASCADE,
  order_id uuid,
  stage production_stage,
  operator_id uuid REFERENCES public.operators(id),
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  seconds integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX swi_op_time ON public.stage_work_intervals(operator_id, started_at);
GRANT SELECT ON public.stage_work_intervals TO authenticated;
GRANT ALL ON public.stage_work_intervals TO service_role;
ALTER TABLE public.stage_work_intervals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stage_work_intervals read office" ON public.stage_work_intervals FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));

CREATE OR REPLACE FUNCTION public.stage_logs_track_time()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_os public.order_stages; v_prev public.stage_time_logs;
BEGIN
  SELECT * INTO v_os FROM public.order_stages WHERE id = NEW.order_stage_id;
  IF NEW.event IN ('pausar','finalizar') THEN
    SELECT * INTO v_prev FROM public.stage_time_logs
     WHERE order_stage_id = NEW.order_stage_id AND id <> NEW.id AND event_at <= NEW.event_at
     ORDER BY event_at DESC, created_at DESC LIMIT 1;
    IF FOUND AND v_prev.event IN ('iniciar','retomar') AND NEW.event_at > v_prev.event_at THEN
      INSERT INTO public.stage_work_intervals(order_stage_id, order_id, stage, operator_id, started_at, ended_at, seconds)
      VALUES (NEW.order_stage_id, v_os.order_id, v_os.stage, COALESCE(NEW.operator_id, v_prev.operator_id),
              v_prev.event_at, NEW.event_at, GREATEST(0, extract(epoch FROM NEW.event_at - v_prev.event_at))::int);
    END IF;
  END IF;
  IF NEW.event = 'pausar' THEN
    INSERT INTO public.stage_pauses(order_stage_id, order_id, stage, operator_id, started_at)
    VALUES (NEW.order_stage_id, v_os.order_id, v_os.stage, NEW.operator_id, NEW.event_at);
  ELSIF NEW.event IN ('retomar','finalizar','iniciar') THEN
    UPDATE public.stage_pauses SET ended_at = NEW.event_at
     WHERE order_stage_id = NEW.order_stage_id AND ended_at IS NULL;
  ELSIF NEW.event = 'cancelar_inicio' THEN
    DELETE FROM public.stage_pauses WHERE order_stage_id = NEW.order_stage_id;
    DELETE FROM public.stage_work_intervals WHERE order_stage_id = NEW.order_stage_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.stage_logs_track_time() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_stage_logs_track_time AFTER INSERT ON public.stage_time_logs
  FOR EACH ROW EXECUTE FUNCTION public.stage_logs_track_time();

-- relatório: incluir trabalho sem volumes
DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.idle_report_impl(date,date)'::regprocedure);
  d := replace(d,
$a$   WHERE status='em_curso' AND NOT is_paused AND last_resume_at IS NOT NULL AND operator_id IS NOT NULL
), pauses AS ($a$,
$b$   WHERE status='em_curso' AND NOT is_paused AND last_resume_at IS NOT NULL AND operator_id IS NOT NULL
  UNION ALL
  SELECT operator_id, started_at, ended_at FROM stage_work_intervals
   WHERE started_at < timezone('Europe/Lisbon', (_to+1)::timestamp) AND ended_at >= timezone('Europe/Lisbon', _from::timestamp)
  UNION ALL
  SELECT os.operator_id, COALESCE((SELECT max(l.event_at) FROM stage_time_logs l WHERE l.order_stage_id=os.id AND l.event IN ('iniciar','retomar')), os.started_at), now()
    FROM order_stages os
   WHERE os.status='em_curso' AND NOT os.is_paused AND os.operator_id IS NOT NULL AND os.started_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM order_coli_stages c WHERE c.order_id=os.order_id AND c.stage=os.stage)
), pauses AS ($b$);
  IF position('stage_work_intervals' in d) = 0 THEN RAISE EXCEPTION 'idle_report_impl: padrão não encontrado'; END IF;
  EXECUTE d;

  d := pg_get_functiondef('public.get_public_factory_panel()'::regprocedure);
  d := replace(d, 'WHERE sp.order_coli_stage_id=r.ocs_id AND',
                  'WHERE (sp.order_coli_stage_id=r.ocs_id OR (r.ocs_id IS NULL AND sp.order_stage_id=r.item_id)) AND');
  IF position('sp.order_stage_id=r.item_id' in d) = 0 THEN RAISE EXCEPTION 'painel: padrão não encontrado'; END IF;
  EXECUTE d;
END $do$;

GRANT EXECUTE ON FUNCTION public.get_public_factory_panel() TO service_role;
GRANT EXECUTE ON FUNCTION public.idle_report_impl(date,date) TO service_role;