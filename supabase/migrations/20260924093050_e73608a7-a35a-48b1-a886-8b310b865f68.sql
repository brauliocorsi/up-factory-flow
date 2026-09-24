CREATE OR REPLACE FUNCTION public.cancel_order_stage_start(_order_stage_id uuid, _operator_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_os public.order_stages; v_op public.operators; v_office boolean; v_n int := 0; r record;
BEGIN
  v_office := public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio');
  SELECT * INTO v_os FROM public.order_stages WHERE id=_order_stage_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Etapa não encontrada'; END IF;
  SELECT * INTO v_op FROM public.operators WHERE code=_operator_code AND active;
  IF EXISTS (SELECT 1 FROM public.order_coli_stages WHERE order_id=v_os.order_id AND stage=v_os.stage) THEN
    FOR r IN SELECT id FROM public.order_coli_stages
             WHERE order_id=v_os.order_id AND stage=v_os.stage AND status='em_curso'
               AND (v_office OR operator_id = v_op.id)
    LOOP
      PERFORM public.cancel_coli_stage_start(r.id, _operator_code);
      v_n := v_n + 1;
    END LOOP;
    IF v_n = 0 THEN RAISE EXCEPTION 'Não há nada iniciado por ti nesta etapa.'; END IF;
  ELSE
    IF v_os.status <> 'em_curso' THEN RAISE EXCEPTION 'Só é possível cancelar uma etapa em curso.'; END IF;
    IF NOT v_office THEN
      IF v_op.id IS NULL THEN RAISE EXCEPTION 'Operador não encontrado'; END IF;
      PERFORM public.assert_operator_is_session(v_op);
      IF v_os.operator_id IS DISTINCT FROM v_op.id THEN RAISE EXCEPTION 'Só quem iniciou pode cancelar.'; END IF;
      IF v_os.started_at < now() - interval '10 minutes' THEN RAISE EXCEPTION 'Passaram mais de 10 minutos — pede ao escritório para cancelar.'; END IF;
      IF v_os.paused_seconds > 0 OR v_os.is_paused THEN RAISE EXCEPTION 'Etapa já teve pausas — pede ao escritório para cancelar.'; END IF;
    END IF;
    UPDATE public.order_stages SET status='pendente', started_at=NULL, finished_at=NULL, operator_id=NULL,
      is_paused=false, productive_seconds=0, paused_seconds=0
     WHERE id=_order_stage_id;
    v_n := 1;
  END IF;
  RETURN jsonb_build_object('ok', true, 'cancelled', v_n);
END $$;
REVOKE EXECUTE ON FUNCTION public.cancel_order_stage_start(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_order_stage_start(uuid,text) TO authenticated;