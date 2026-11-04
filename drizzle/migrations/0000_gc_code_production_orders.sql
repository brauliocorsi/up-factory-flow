ALTER TABLE public.production_orders ADD COLUMN IF NOT EXISTS gc_code text NULL;
ALTER TABLE public.production_orders ADD COLUMN IF NOT EXISTS gc_code_missing boolean GENERATED ALWAYS AS (gc_code IS NULL OR btrim(gc_code) = '') STORED;
COMMENT ON COLUMN public.production_orders.gc_code IS 'Código interno do produto no GestãoClick (CAM/SOF/SOM 18 car. ou EAN-13). Não único.';
CREATE INDEX IF NOT EXISTS idx_production_orders_gc_code ON public.production_orders (upper(btrim(gc_code)));
CREATE INDEX IF NOT EXISTS idx_production_orders_barcode ON public.production_orders (upper(btrim(barcode)));
CREATE INDEX IF NOT EXISTS idx_order_colis_barcode ON public.order_colis (upper(btrim(coli_barcode)));
ALTER TABLE public.production_orders DROP CONSTRAINT IF EXISTS production_orders_barcode_key;

-- Backfill só quando claro: barcode = <CAM/SOF/SOM 15-17 car. | EAN-13>-<order_number>
UPDATE public.production_orders
   SET gc_code = upper(left(barcode, length(barcode) - length(order_number) - 1))
 WHERE gc_code IS NULL AND barcode IS NOT NULL
   AND right(barcode, length(order_number) + 1) = '-' || order_number
   AND upper(left(barcode, length(barcode) - length(order_number) - 1)) ~ '^((CAM|SOF)[A-Z0-9]{15}|SOM[A-Z0-9]{14}|[0-9]{13})$';

-- Atualiza códigos dos colis: 1 coli = BASE; >1 = BASE-C<n>. Não apaga nada.
CREATE OR REPLACE FUNCTION public.refresh_order_coli_barcodes(_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_base text; v_count int;
BEGIN
  SELECT COALESCE(NULLIF(upper(btrim(gc_code)), ''), NULLIF(btrim(barcode), ''), order_number)
    INTO v_base FROM public.production_orders WHERE id = _order_id;
  IF v_base IS NULL THEN RETURN; END IF;
  SELECT count(*) INTO v_count FROM public.order_colis WHERE order_id = _order_id;
  UPDATE public.order_colis
     SET coli_barcode = CASE WHEN v_count = 1 THEN v_base ELSE v_base || '-C' || coli_number END
   WHERE order_id = _order_id
     AND coli_barcode IS DISTINCT FROM (CASE WHEN v_count = 1 THEN v_base ELSE v_base || '-C' || coli_number END);
END $$;
REVOKE ALL ON FUNCTION public.refresh_order_coli_barcodes(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.production_orders_gc_code_sync()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.gc_code := NULLIF(upper(btrim(NEW.gc_code)), '');
  IF NEW.gc_code IS NOT NULL THEN NEW.barcode := NEW.gc_code; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_po_gc_code_sync ON public.production_orders;
CREATE TRIGGER trg_po_gc_code_sync BEFORE INSERT OR UPDATE OF gc_code ON public.production_orders
  FOR EACH ROW EXECUTE FUNCTION public.production_orders_gc_code_sync();

CREATE OR REPLACE FUNCTION public.production_orders_after_gc_code_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.gc_code IS DISTINCT FROM OLD.gc_code THEN
    PERFORM public.refresh_order_coli_barcodes(NEW.id);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_po_gc_code_refresh_colis ON public.production_orders;
CREATE TRIGGER trg_po_gc_code_refresh_colis AFTER UPDATE OF gc_code ON public.production_orders
  FOR EACH ROW EXECUTE FUNCTION public.production_orders_after_gc_code_update();

CREATE OR REPLACE FUNCTION public.create_order_colis(_order_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_cat text; v_struct text; v_barcode text; v_gc text; v_order_number text; v_base text;
  r RECORD; c RECORD; v_coli_id uuid;
  v_created int := 0; v_stages_added int := 0;
  v_route_found boolean := false; v_route_empty boolean := false; v_inserted int;
  v_stages public.production_stage[] := ARRAY['estrutura','corte','costura','branco','estofagem','qualidade','embalagem','picagem']::public.production_stage[];
  st public.production_stage;
BEGIN
  SELECT barcode, gc_code, order_number INTO v_barcode, v_gc, v_order_number
    FROM public.production_orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Encomenda não encontrada'; END IF;

  v_base := COALESCE(NULLIF(upper(btrim(v_gc)), ''), NULLIF(btrim(v_barcode), ''), v_order_number);
  IF v_base IS NULL OR v_base = '' THEN
    RAISE EXCEPTION 'Não foi possível criar volumes: encomenda sem código nem número';
  END IF;

  SELECT category_code, structure_code INTO v_cat, v_struct FROM public.get_order_route_keys(_order_id);

  FOR r IN SELECT id, coli_number, coli_name FROM public.structure_coli_routes
            WHERE category_code = v_cat AND structure_code = v_struct ORDER BY coli_number
  LOOP
    v_route_found := true;
    SELECT id INTO v_coli_id FROM public.order_colis WHERE order_id = _order_id AND coli_number = r.coli_number;
    IF v_coli_id IS NULL THEN
      INSERT INTO public.order_colis(order_id, coli_number, coli_name, coli_barcode)
      VALUES (_order_id, r.coli_number, r.coli_name, v_base || '-C' || r.coli_number)
      ON CONFLICT (order_id, coli_number) DO NOTHING RETURNING id INTO v_coli_id;
      IF v_coli_id IS NULL THEN
        SELECT id INTO v_coli_id FROM public.order_colis WHERE order_id = _order_id AND coli_number = r.coli_number;
      ELSE v_created := v_created + 1; END IF;
    END IF;
    INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage)
    SELECT v_coli_id, _order_id, scs.stage FROM public.structure_coli_stages scs
     WHERE scs.route_id = r.id AND scs.included = true
    ON CONFLICT (order_coli_id, stage) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT; v_stages_added := v_stages_added + v_inserted;
    IF NOT EXISTS (SELECT 1 FROM public.order_coli_stages WHERE order_coli_id = v_coli_id) THEN
      v_route_empty := true;
      FOREACH st IN ARRAY v_stages LOOP
        INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage) VALUES (v_coli_id, _order_id, st)
        ON CONFLICT (order_coli_id, stage) DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT; v_stages_added := v_stages_added + v_inserted;
      END LOOP;
    END IF;
  END LOOP;

  IF NOT v_route_found THEN
    SELECT id INTO v_coli_id FROM public.order_colis WHERE order_id = _order_id AND coli_number = 1;
    IF v_coli_id IS NULL THEN
      INSERT INTO public.order_colis(order_id, coli_number, coli_name, coli_barcode)
      VALUES (_order_id, 1, 'Produto completo', v_base)
      ON CONFLICT (order_id, coli_number) DO NOTHING RETURNING id INTO v_coli_id;
      IF v_coli_id IS NULL THEN
        SELECT id INTO v_coli_id FROM public.order_colis WHERE order_id = _order_id AND coli_number = 1;
      ELSE v_created := v_created + 1; END IF;
    END IF;
    FOREACH st IN ARRAY v_stages LOOP
      INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage) VALUES (v_coli_id, _order_id, st)
      ON CONFLICT (order_coli_id, stage) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT; v_stages_added := v_stages_added + v_inserted;
    END LOOP;
  END IF;

  FOR c IN SELECT oc.id FROM public.order_colis oc WHERE oc.order_id = _order_id
       AND NOT EXISTS (SELECT 1 FROM public.order_coli_stages s WHERE s.order_coli_id = oc.id)
  LOOP
    v_route_empty := true;
    FOREACH st IN ARRAY v_stages LOOP
      INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage) VALUES (c.id, _order_id, st)
      ON CONFLICT (order_coli_id, stage) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT; v_stages_added := v_stages_added + v_inserted;
    END LOOP;
  END LOOP;

  -- Só ajusta códigos quando foram criados volumes nesta chamada (1 coli = código sem sufixo).
  IF v_created > 0 THEN PERFORM public.refresh_order_coli_barcodes(_order_id); END IF;

  RETURN jsonb_build_object('ok', true, 'created', v_created, 'stages_added', v_stages_added,
    'route_found', v_route_found, 'route_without_stages', v_route_empty);
END;
$function$;

CREATE OR REPLACE FUNCTION public.scan_picking_coli(_order_id uuid, _scanned_code text, _operator_code text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_op public.operators; v_linked boolean; v_coli public.order_colis; v_cs public.order_coli_stages;
  v_clean text := upper(btrim(_scanned_code));
  v_total int; v_done int; v_embalagem_done boolean; v_is_order_code boolean;
  v_suffix_base text; v_suffix_n int;
BEGIN
  IF v_clean IS NULL OR v_clean = '' THEN RAISE EXCEPTION 'Código vazio'; END IF;

  SELECT * INTO v_op FROM public.operators WHERE code = _operator_code AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operador "%" não encontrado ou inativo', _operator_code; END IF;
  SELECT EXISTS(SELECT 1 FROM public.operator_stages WHERE operator_id = v_op.id AND stage = 'picagem') INTO v_linked;
  IF NOT v_linked THEN RAISE EXCEPTION 'O operador % não está atribuído à etapa de Picagem', v_op.code; END IF;
  PERFORM public.assert_picking_actor(v_op);

  SELECT (status = 'concluida') INTO v_embalagem_done FROM public.order_stages WHERE order_id = _order_id AND stage = 'embalagem';
  IF NOT COALESCE(v_embalagem_done, false) THEN RAISE EXCEPTION 'Encomenda ainda não foi embalada na fábrica.'; END IF;

  -- 1) Código exato do volume, sempre dentro desta encomenda
  SELECT * INTO v_coli FROM public.order_colis
   WHERE order_id = _order_id AND upper(btrim(coli_barcode)) = v_clean LIMIT 1;

  -- 2) Código GC/encomenda com sufixo -C<n> (ex.: 2048996022703-C1 numa encomenda de 1 coli)
  IF NOT FOUND AND v_clean ~ '-C[0-9]+$' THEN
    v_suffix_base := regexp_replace(v_clean, '-C[0-9]+$', '');
    v_suffix_n := substring(v_clean from '-C([0-9]+)$')::int;
    IF EXISTS (SELECT 1 FROM public.production_orders o WHERE o.id = _order_id
        AND (upper(btrim(COALESCE(o.gc_code,''))) = v_suffix_base
             OR upper(btrim(COALESCE(o.barcode,''))) = v_suffix_base
             OR upper(btrim(o.order_number)) = v_suffix_base)) THEN
      SELECT * INTO v_coli FROM public.order_colis WHERE order_id = _order_id AND coli_number = v_suffix_n;
    END IF;
  END IF;

  -- 3) Código do produto/encomenda sem sufixo: próximo volume por ler
  IF v_coli.id IS NULL THEN
    SELECT EXISTS(SELECT 1 FROM public.production_orders o WHERE o.id = _order_id
       AND (upper(btrim(o.order_number)) = v_clean
            OR upper(btrim(COALESCE(o.barcode,''))) = v_clean
            OR upper(btrim(COALESCE(o.gc_code,''))) = v_clean
            OR upper(btrim(COALESCE(o.customer_order,''))) = v_clean)) INTO v_is_order_code;
    IF v_is_order_code THEN
      SELECT c.* INTO v_coli FROM public.order_colis c
        JOIN public.order_coli_stages cs ON cs.order_coli_id = c.id AND cs.stage = 'picagem'
       WHERE c.order_id = _order_id AND cs.status <> 'concluida'
       ORDER BY c.coli_number LIMIT 1;
      IF NOT FOUND THEN RAISE EXCEPTION 'Todos os colis desta encomenda já foram lidos.'; END IF;
    ELSE
      RAISE EXCEPTION 'Código "%" não pertence a esta encomenda.', v_clean;
    END IF;
  END IF;

  SELECT * INTO v_cs FROM public.order_coli_stages WHERE order_coli_id = v_coli.id AND stage = 'picagem' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Etapa de Picagem do coli % não encontrada.', v_coli.coli_number; END IF;
  IF v_cs.status = 'concluida' THEN RAISE EXCEPTION 'Coli % já foi lido.', v_coli.coli_number; END IF;

  UPDATE public.order_coli_stages
     SET status = 'concluida'::stage_status, started_at = COALESCE(started_at, now()), finished_at = now(),
         is_paused = false, pause_started_at = NULL, last_resume_at = NULL, operator_id = v_op.id
   WHERE id = v_cs.id;

  PERFORM public.sync_order_stage_from_colis(_order_id, 'picagem'::production_stage);

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status='concluida') INTO v_total, v_done
    FROM public.order_coli_stages WHERE order_id = _order_id AND stage = 'picagem';

  RETURN jsonb_build_object('ok', true, 'coli_number', v_coli.coli_number, 'coli_name', v_coli.coli_name,
    'done', v_done, 'total', v_total, 'completed', v_done = v_total);
END;
$function$;

CREATE OR REPLACE FUNCTION public.erp_ingest_order(_p jsonb, _hash text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_event uuid := (_p->>'event_id')::uuid;
  v_sale uuid := (_p->>'sale_id')::uuid;
  v_line uuid := (_p->>'line_id')::uuid;
  v_prod uuid := (_p->>'product_id')::uuid;
  v_src text := _p->>'source_system';
  v_qty int := (_p->>'quantity')::int;
  v_num text := trim(_p->>'sale_number');
  v_desc text := _p->>'description';
  v_gc text := NULLIF(upper(btrim(_p->>'product_code')), '');
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
      fabric_ref_tec, due_date, entry_date, priority, notes, customization, line_kind, barcode, gc_code)
    VALUES (v_onum, v_num, v_desc,
      CASE WHEN v_status='mapeado' THEN v_map.model_id END,
      CASE WHEN v_status='mapeado' THEN v_map.structure_type END,
      CASE WHEN v_status='mapeado' THEN v_map.measure END,
      CASE WHEN v_status='mapeado' THEN v_map.fabric_ref_tec END,
      nullif(_p->>'due_date','')::date, current_date, 0,
      v_notes || ' Unidade '||i||'/'||v_qty||'.',
      CASE WHEN jsonb_typeof(_p->'customization')='object' THEN (_p->'customization')::text END,
      'catalogo', COALESCE(v_gc, 'UP'||replace(v_onum,'-','')), v_gc)
    RETURNING id INTO v_order;
    INSERT INTO erp_order_links(source_system,first_event_id,sale_id,sale_number,line_id,product_id,product_code,unit_index,line_quantity,order_id,payload_hash,description,customization,mapping_status)
    VALUES (v_src,v_event,v_sale,v_num,v_line,v_prod,_p->>'product_code',i,v_qty,v_order,_hash,v_desc,
      CASE WHEN jsonb_typeof(_p->'customization')='object' THEN _p->'customization' END, v_status);
    v_out := v_out || jsonb_build_object('id',v_order,'order_number',v_onum,'unit_index',i);
  END LOOP;
  RETURN jsonb_build_object('ok',true,'replay',false,'orders',v_out);
END $function$;