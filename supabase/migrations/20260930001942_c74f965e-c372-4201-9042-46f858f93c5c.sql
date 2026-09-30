
ALTER TABLE public.erp_outbox
  ADD COLUMN lease_owner uuid,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX erp_outbox_due_idx ON public.erp_outbox(state, next_attempt_at);

ALTER TABLE public.erp_order_links
  ADD COLUMN validated_by uuid,
  ADD COLUMN validated_at timestamptz;
GRANT UPDATE ON public.erp_order_links TO service_role;

CREATE TABLE public.erp_integration_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  worker_enabled boolean NOT NULL DEFAULT false,
  worker_enabled_by uuid,
  worker_enabled_at timestamptz,
  last_ack_at timestamptz,
  last_run_at timestamptz,
  last_run_summary text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.erp_integration_settings(id) VALUES (1) ON CONFLICT DO NOTHING;
GRANT SELECT ON public.erp_integration_settings TO authenticated;
GRANT ALL ON public.erp_integration_settings TO service_role;
ALTER TABLE public.erp_integration_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "erp settings office read" ON public.erp_integration_settings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));
CREATE TRIGGER trg_erp_settings_updated BEFORE UPDATE ON public.erp_integration_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Claim atómico com lease. Recupera leases expirados. Respeita ordem produced -> warehouse_received.
CREATE OR REPLACE FUNCTION public.erp_outbox_claim(_owner uuid, _limit integer, _lease_seconds integer)
RETURNS SETOF public.erp_outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _limit < 1 OR _limit > 50 OR _lease_seconds < 10 OR _lease_seconds > 600 THEN
    RAISE EXCEPTION 'parâmetros de claim inválidos';
  END IF;
  RETURN QUERY
  WITH due AS (
    SELECT o.event_id FROM erp_outbox o
     WHERE ((o.state IN ('pendente','erro','incerto') AND o.next_attempt_at <= now())
         OR (o.state = 'a_enviar' AND o.lease_expires_at < now()))
       AND (o.event_status = 'produced' OR EXISTS (
             SELECT 1 FROM erp_outbox p WHERE p.order_id = o.order_id
               AND p.event_status = 'produced' AND p.state = 'entregue'))
     ORDER BY o.created_at
     LIMIT _limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE erp_outbox o
     SET state = 'a_enviar', lease_owner = _owner,
         lease_expires_at = now() + make_interval(secs => _lease_seconds),
         attempts = o.attempts + 1, last_attempt_at = now()
    FROM due WHERE o.event_id = due.event_id
  RETURNING o.*;
END $$;

-- Conclusão condicionada ao owner do lease; backoff exponencial (1 min .. 6 h).
CREATE OR REPLACE FUNCTION public.erp_outbox_complete(_event_id uuid, _owner uuid, _state text, _code integer, _error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF _state NOT IN ('entregue','erro','incerto') THEN RAISE EXCEPTION 'estado inválido'; END IF;
  UPDATE erp_outbox SET
    state = _state, last_response_code = _code, last_error = left(_error, 500),
    acked_at = CASE WHEN _state = 'entregue' THEN now() ELSE NULL END,
    next_attempt_at = CASE WHEN _state = 'entregue' THEN next_attempt_at
      ELSE now() + make_interval(secs => LEAST(21600, 60 * power(2, GREATEST(attempts - 1, 0))::int)) END,
    lease_owner = NULL, lease_expires_at = NULL
  WHERE event_id = _event_id AND lease_owner = _owner AND state = 'a_enviar';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 1 AND _state = 'entregue' THEN
    UPDATE erp_integration_settings SET last_ack_at = now() WHERE id = 1;
  END IF;
  RETURN n = 1;
END $$;

-- Reenvio manual autorizado: antecipa a próxima tentativa (não força envio concorrente).
CREATE OR REPLACE FUNCTION public.erp_outbox_retry_now(_event_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  PERFORM public.assert_office_or_admin('reenviar eventos ERP');
  UPDATE erp_outbox SET next_attempt_at = now()
   WHERE event_id = _event_id AND state IN ('pendente','erro','incerto');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $$;

CREATE OR REPLACE FUNCTION public.erp_set_worker_enabled(_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s erp_integration_settings;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Só admin pode alterar o envio automático';
  END IF;
  SELECT * INTO s FROM erp_integration_settings WHERE id = 1 FOR UPDATE;
  IF _enabled AND s.last_ack_at IS NULL THEN
    RAISE EXCEPTION 'Faça primeiro um envio manual confirmado pelo ERP (ensaio) antes de ligar o envio automático';
  END IF;
  UPDATE erp_integration_settings SET worker_enabled = _enabled,
    worker_enabled_by = CASE WHEN _enabled THEN auth.uid() END,
    worker_enabled_at = CASE WHEN _enabled THEN now() END
   WHERE id = 1;
  RETURN jsonb_build_object('ok', true, 'worker_enabled', _enabled);
END $$;

CREATE OR REPLACE FUNCTION public.erp_record_run(_summary text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE erp_integration_settings SET last_run_at = now(), last_run_summary = left(_summary, 300) WHERE id = 1;
$$;

-- Bloqueio: OPs ERP por validar não iniciam etapas.
CREATE OR REPLACE FUNCTION public.erp_block_unvalidated_start()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'em_curso' AND OLD.status IS DISTINCT FROM 'em_curso'
     AND EXISTS (SELECT 1 FROM erp_order_links WHERE order_id = NEW.order_id AND mapping_status = 'por_validar') THEN
    RAISE EXCEPTION 'Encomenda do ERP com produto por validar: o escritório tem de confirmar a correspondência antes de iniciar.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_erp_block_start_order_stages BEFORE UPDATE OF status ON public.order_stages
  FOR EACH ROW EXECUTE FUNCTION public.erp_block_unvalidated_start();
CREATE TRIGGER trg_erp_block_start_coli_stages BEFORE UPDATE OF status ON public.order_coli_stages
  FOR EACH ROW EXECUTE FUNCTION public.erp_block_unvalidated_start();

-- Validação explícita da correspondência por admin/escritório.
CREATE OR REPLACE FUNCTION public.erp_validate_mapping(_product_id uuid, _model_id uuid, _structure_type text, _measure text, _fabric_ref_tec text, _notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_orders int := 0; v_code text;
BEGIN
  PERFORM public.assert_office_or_admin('validar correspondência ERP');
  IF _model_id IS NULL OR NOT EXISTS (SELECT 1 FROM models WHERE id = _model_id AND active) THEN
    RAISE EXCEPTION 'Modelo inválido ou inativo';
  END IF;
  IF _fabric_ref_tec IS NOT NULL AND NOT EXISTS (SELECT 1 FROM fabric_catalog WHERE ref_tec = _fabric_ref_tec) THEN
    RAISE EXCEPTION 'Tecido inexistente';
  END IF;
  SELECT product_code INTO v_code FROM erp_order_links WHERE product_id = _product_id LIMIT 1;
  INSERT INTO erp_product_map(product_id, product_code, model_id, structure_type, measure, fabric_ref_tec, notes, active)
  VALUES (_product_id, v_code, _model_id, nullif(_structure_type,''), nullif(_measure,''), nullif(_fabric_ref_tec,''), _notes, true)
  ON CONFLICT (product_id) DO UPDATE SET model_id = EXCLUDED.model_id, structure_type = EXCLUDED.structure_type,
    measure = EXCLUDED.measure, fabric_ref_tec = EXCLUDED.fabric_ref_tec, notes = EXCLUDED.notes, active = true;

  FOR r IN SELECT l.id, l.order_id FROM erp_order_links l
            WHERE l.product_id = _product_id AND l.mapping_status = 'por_validar' FOR UPDATE LOOP
    -- só OPs ainda não iniciadas (garantido pelo bloqueio); personalização não é tocada
    IF EXISTS (SELECT 1 FROM order_coli_stages WHERE order_id = r.order_id AND status <> 'pendente')
       OR EXISTS (SELECT 1 FROM order_stages WHERE order_id = r.order_id AND status <> 'pendente') THEN
      CONTINUE;
    END IF;
    UPDATE production_orders SET model_id = _model_id,
      structure_type = nullif(_structure_type,''), measure = nullif(_measure,''),
      fabric_ref_tec = nullif(_fabric_ref_tec,''),
      notes = replace(coalesce(notes,''), 'Produto sem correspondência validada', 'Correspondência validada (antes: sem correspondência)')
     WHERE id = r.order_id;
    -- volumes provisórios (nunca iniciados) refeitos segundo a rota do modelo
    DELETE FROM order_coli_stages WHERE order_id = r.order_id;
    DELETE FROM order_colis WHERE order_id = r.order_id;
    PERFORM public.create_order_colis(r.order_id);
    UPDATE erp_order_links SET mapping_status = 'mapeado', validated_by = auth.uid(), validated_at = now() WHERE id = r.id;
    v_orders := v_orders + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'orders_updated', v_orders);
END $$;

REVOKE ALL ON FUNCTION public.erp_outbox_claim(uuid,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.erp_outbox_complete(uuid,uuid,text,integer,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.erp_record_run(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.erp_block_unvalidated_start() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_outbox_claim(uuid,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.erp_outbox_complete(uuid,uuid,text,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.erp_record_run(text) TO service_role;
REVOKE ALL ON FUNCTION public.erp_outbox_retry_now(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.erp_set_worker_enabled(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.erp_validate_mapping(uuid,uuid,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.erp_outbox_retry_now(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.erp_set_worker_enabled(boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.erp_validate_mapping(uuid,uuid,text,text,text,text) TO authenticated, service_role;
