
CREATE TABLE public.erp_product_map (
  product_id uuid PRIMARY KEY,
  product_code text,
  model_id uuid REFERENCES public.models(id),
  structure_type text,
  measure text,
  fabric_ref_tec text REFERENCES public.fabric_catalog(ref_tec),
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.erp_product_map TO authenticated;
GRANT ALL ON public.erp_product_map TO service_role;
ALTER TABLE public.erp_product_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "erp map office read" ON public.erp_product_map FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));
CREATE POLICY "erp map office write" ON public.erp_product_map FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));
CREATE POLICY "erp map office update" ON public.erp_product_map FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));
CREATE TRIGGER trg_erp_product_map_updated BEFORE UPDATE ON public.erp_product_map
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.erp_inbound_events (
  event_id uuid PRIMARY KEY,
  source_system text NOT NULL,
  sale_id uuid NOT NULL,
  line_id uuid NOT NULL,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.erp_inbound_events TO authenticated;
GRANT ALL ON public.erp_inbound_events TO service_role;
ALTER TABLE public.erp_inbound_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "erp inbound office read" ON public.erp_inbound_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));

CREATE TABLE public.erp_order_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system text NOT NULL,
  first_event_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  sale_number text NOT NULL,
  line_id uuid NOT NULL,
  product_id uuid NOT NULL,
  product_code text,
  unit_index integer NOT NULL CHECK (unit_index >= 1),
  line_quantity integer NOT NULL CHECK (line_quantity >= 1),
  order_id uuid NOT NULL UNIQUE REFERENCES public.production_orders(id),
  payload_hash text NOT NULL,
  description text NOT NULL,
  customization jsonb,
  mapping_status text NOT NULL CHECK (mapping_status IN ('mapeado','por_validar')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, sale_id, line_id, unit_index)
);
GRANT SELECT ON public.erp_order_links TO authenticated;
GRANT ALL ON public.erp_order_links TO service_role;
ALTER TABLE public.erp_order_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "erp links office read" ON public.erp_order_links FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));

CREATE TABLE public.erp_outbox (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.erp_order_links(id),
  order_id uuid NOT NULL REFERENCES public.production_orders(id),
  event_status text NOT NULL CHECK (event_status IN ('produced','warehouse_received')),
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pendente' CHECK (state IN ('pendente','a_enviar','entregue','erro','incerto')),
  attempts integer NOT NULL DEFAULT 0,
  last_response_code integer,
  last_error text,
  last_attempt_at timestamptz,
  acked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, event_status)
);
GRANT SELECT ON public.erp_outbox TO authenticated;
GRANT ALL ON public.erp_outbox TO service_role;
ALTER TABLE public.erp_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "erp outbox office read" ON public.erp_outbox FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));
CREATE TRIGGER trg_erp_outbox_updated BEFORE UPDATE ON public.erp_outbox
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Enfileira eventos apenas para OPs com vínculo ERP, nas transições reais de estado.
CREATE OR REPLACE FUNCTION public.erp_outbox_on_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l erp_order_links; k text; eid uuid := gen_random_uuid();
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status = 'concluida' THEN k := 'produced';
  ELSIF NEW.status = 'em_armazem' THEN k := 'warehouse_received';
  ELSE RETURN NEW; END IF;
  SELECT * INTO l FROM erp_order_links WHERE order_id = NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  -- warehouse_received implica produced; garante que produced existe (ordem de envio).
  IF k = 'warehouse_received' AND NOT EXISTS (SELECT 1 FROM erp_outbox WHERE order_id=NEW.id AND event_status='produced') THEN
    PERFORM public.erp_outbox_enqueue(l, 'produced', now());
  END IF;
  PERFORM public.erp_outbox_enqueue(l, k, now());
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.erp_outbox_enqueue(l erp_order_links, k text, at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eid uuid := gen_random_uuid();
BEGIN
  INSERT INTO erp_outbox(event_id, link_id, order_id, event_status, occurred_at, payload)
  VALUES (eid, l.id, l.order_id, k, at, jsonb_build_object(
    'schema_version',1,'event_id',eid,'source_system','up-fabrica',
    'sale_id',l.sale_id,'line_id',l.line_id,'order_id',l.order_id,
    'unit_index',l.unit_index,'status',k,'quantity',1,'occurred_at',at))
  ON CONFLICT (order_id, event_status) DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION public.erp_outbox_on_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.erp_outbox_enqueue(erp_order_links,text,timestamptz) FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_erp_outbox_on_status AFTER UPDATE OF status ON public.production_orders
  FOR EACH ROW EXECUTE FUNCTION public.erp_outbox_on_status();

-- Ingestão transacional e idempotente. Só service_role (rota verificada por token).
CREATE OR REPLACE FUNCTION public.erp_ingest_order(_p jsonb, _hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event uuid := (_p->>'event_id')::uuid;
  v_sale uuid := (_p->>'sale_id')::uuid;
  v_line uuid := (_p->>'line_id')::uuid;
  v_prod uuid := (_p->>'product_id')::uuid;
  v_src text := _p->>'source_system';
  v_qty int := (_p->>'quantity')::int;
  v_num text := trim(_p->>'sale_number');
  v_desc text := _p->>'description';
  v_ev erp_inbound_events;
  v_map erp_product_map;
  v_existing int; v_hash_other text;
  v_seq int := 0; v_n int; r record; i int;
  v_order uuid; v_onum text; v_status text; v_notes text;
  v_out jsonb := '[]'::jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('erp:'||v_src||':'||v_sale::text||':'||v_line::text));
  PERFORM pg_advisory_xact_lock(hashtext('erp-num:'||v_num));

  SELECT * INTO v_ev FROM erp_inbound_events WHERE event_id = v_event;
  IF FOUND AND v_ev.payload_hash <> _hash THEN
    RETURN jsonb_build_object('ok',false,'code','event_conflict','message','event_id já recebido com conteúdo diferente');
  END IF;

  SELECT count(*), min(payload_hash) INTO v_existing, v_hash_other
    FROM erp_order_links WHERE source_system=v_src AND sale_id=v_sale AND line_id=v_line;
  IF v_existing > 0 THEN
    IF v_hash_other <> _hash OR EXISTS (SELECT 1 FROM erp_order_links WHERE source_system=v_src AND sale_id=v_sale AND line_id=v_line AND payload_hash<>_hash) THEN
      RETURN jsonb_build_object('ok',false,'code','line_conflict','message','linha já recebida com conteúdo diferente; requer análise');
    END IF;
    IF v_ev.event_id IS NULL THEN
      INSERT INTO erp_inbound_events(event_id,source_system,sale_id,line_id,payload_hash,payload)
      VALUES (v_event,v_src,v_sale,v_line,_hash,_p);
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.order_id,'order_number',po.order_number,'unit_index',l.unit_index) ORDER BY l.unit_index),'[]')
      INTO v_out FROM erp_order_links l JOIN production_orders po ON po.id=l.order_id
      WHERE l.source_system=v_src AND l.sale_id=v_sale AND l.line_id=v_line;
    RETURN jsonb_build_object('ok',true,'replay',true,'orders',v_out);
  END IF;

  IF v_ev.event_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok',false,'code','event_conflict','message','event_id já usado noutra linha');
  END IF;

  SELECT * INTO v_map FROM erp_product_map WHERE product_id=v_prod AND active;
  IF FOUND AND v_map.model_id IS NOT NULL THEN v_status := 'mapeado'; ELSE v_status := 'por_validar'; END IF;
  v_notes := CASE WHEN v_status='por_validar'
    THEN '[ERP] Produto sem correspondência validada (product_id '||v_prod||coalesce(', código '||(_p->>'product_code'),'')||'). Validar modelo/medida/tecido antes de produzir.'
    ELSE '[ERP] Venda '||v_num END;

  FOR r IN SELECT order_number FROM production_orders WHERE order_number=v_num OR order_number LIKE v_num||'-%' LOOP
    v_n := coalesce(nullif(substring(r.order_number from '-(\d{1,3})$'),'')::int, 0);
    IF v_n > v_seq THEN v_seq := v_n; END IF;
  END LOOP;

  INSERT INTO erp_inbound_events(event_id,source_system,sale_id,line_id,payload_hash,payload)
  VALUES (v_event,v_src,v_sale,v_line,_hash,_p);

  FOR i IN 1..v_qty LOOP
    v_onum := v_num || '-' || lpad((v_seq+i)::text, 2, '0');
    INSERT INTO production_orders(order_number, customer_order, product_description, model_id, structure_type, measure,
      fabric_ref_tec, due_date, entry_date, priority, notes, customization, line_kind, barcode)
    VALUES (v_onum, v_num, v_desc,
      CASE WHEN v_status='mapeado' THEN v_map.model_id END,
      CASE WHEN v_status='mapeado' THEN v_map.structure_type END,
      CASE WHEN v_status='mapeado' THEN v_map.measure END,
      CASE WHEN v_status='mapeado' THEN v_map.fabric_ref_tec END,
      nullif(_p->>'due_date','')::date, current_date, 0,
      v_notes || ' Unidade '||i||'/'||v_qty||'.',
      CASE WHEN jsonb_typeof(_p->'customization')='object' THEN (_p->'customization')::text END,
      'catalogo', 'UP'||replace(v_onum,'-',''))
    RETURNING id INTO v_order;
    INSERT INTO erp_order_links(source_system,first_event_id,sale_id,sale_number,line_id,product_id,product_code,unit_index,line_quantity,order_id,payload_hash,description,customization,mapping_status)
    VALUES (v_src,v_event,v_sale,v_num,v_line,v_prod,_p->>'product_code',i,v_qty,v_order,_hash,v_desc,
      CASE WHEN jsonb_typeof(_p->'customization')='object' THEN _p->'customization' END, v_status);
    v_out := v_out || jsonb_build_object('id',v_order,'order_number',v_onum,'unit_index',i);
  END LOOP;
  RETURN jsonb_build_object('ok',true,'replay',false,'orders',v_out);
END $$;
REVOKE ALL ON FUNCTION public.erp_ingest_order(jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_ingest_order(jsonb,text) TO service_role;
