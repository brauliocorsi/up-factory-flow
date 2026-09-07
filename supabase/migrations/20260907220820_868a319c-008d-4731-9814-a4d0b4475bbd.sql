-- ============================================================
-- FASE 2 — Produção por volume (coli)
-- ============================================================

-- 1) Unicidade (idempotência das reparações)
DELETE FROM public.order_coli_stages a
 USING public.order_coli_stages b
 WHERE a.order_coli_id = b.order_coli_id
   AND a.stage = b.stage
   AND a.ctid > b.ctid
   AND a.status = 'pendente'
   AND a.started_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS order_coli_stages_coli_stage_uidx
  ON public.order_coli_stages(order_coli_id, stage);

-- 2) Dependências DENTRO do mesmo volume
CREATE OR REPLACE FUNCTION public.assert_coli_previous_stages_done(_order_coli_id uuid, _stage production_stage)
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pending text;
BEGIN
  SELECT string_agg(cs.stage::text, ', ' ORDER BY public.stage_order_index(cs.stage))
    INTO v_pending
    FROM public.order_coli_stages cs
   WHERE cs.order_coli_id = _order_coli_id
     AND cs.stage = ANY (public.stage_prerequisites(_stage))
     AND cs.status <> 'concluida';

  IF v_pending IS NOT NULL THEN
    RAISE EXCEPTION 'Não é possível iniciar % neste volume: falta concluir (%)', _stage, v_pending;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_coli_previous_stages_done(uuid, production_stage) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.enforce_coli_stage_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IN ('em_curso','concluida')
     AND COALESCE(OLD.status::text, '') <> NEW.status::text THEN
    PERFORM public.assert_coli_previous_stages_done(NEW.order_coli_id, NEW.stage);
  END IF;
  RETURN NEW;
END;
$function$;

-- 3) A etapa da encomenda passa a ser resumo derivado: não valida sequência
--    quando a encomenda tem volumes com etapas próprias.
CREATE OR REPLACE FUNCTION public.enforce_stage_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.order_coli_stages WHERE order_id = NEW.order_id) THEN
    RETURN NEW; -- resumo derivado dos volumes
  END IF;
  IF NEW.status IN ('em_curso','concluida')
     AND COALESCE(OLD.status::text, '') <> NEW.status::text
     AND NOT COALESCE(NEW.is_rework, false) THEN
    PERFORM public.assert_previous_stages_done(NEW.order_id, NEW.stage);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.order_stages_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branco_ok BOOLEAN;
  v_costura_ok BOOLEAN;
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_derived BOOLEAN;
BEGIN
  NEW.updated_at = now();

  SELECT EXISTS (SELECT 1 FROM public.order_coli_stages WHERE order_id = NEW.order_id) INTO v_derived;

  IF NOT v_derived AND NEW.stage = 'estofagem' AND NEW.status = 'em_curso' AND OLD.status <> 'em_curso' THEN
    SELECT (status='concluida' AND check_valid) INTO v_branco_ok
      FROM public.order_stages WHERE order_id = NEW.order_id AND stage = 'branco';
    SELECT (status='concluida' AND check_valid) INTO v_costura_ok
      FROM public.order_stages WHERE order_id = NEW.order_id AND stage = 'costura';
    IF NOT COALESCE(v_branco_ok,false) THEN v_missing := array_append(v_missing,'Branco'); END IF;
    IF NOT COALESCE(v_costura_ok,false) THEN v_missing := array_append(v_missing,'Costura'); END IF;
    IF array_length(v_missing,1) > 0 THEN
      RAISE EXCEPTION 'Estofagem bloqueada: é necessário concluir % primeiro.', array_to_string(v_missing,' e ');
    END IF;
  END IF;

  IF NEW.status = 'em_curso' AND OLD.status <> 'em_curso' AND NEW.started_at IS NULL THEN
    NEW.started_at = now();
  END IF;

  IF NEW.status = 'concluida' AND OLD.status <> 'concluida' THEN
    IF NEW.finished_at IS NULL THEN NEW.finished_at = now(); END IF;
    IF NEW.started_at IS NOT NULL THEN
      NEW.duration_minutes = CEIL(EXTRACT(EPOCH FROM (NEW.finished_at - NEW.started_at))/60.0)::INT;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 4) Conclusão da encomenda: só quando TODOS os volumes terminam embalagem
CREATE OR REPLACE FUNCTION public.order_stages_after_embalagem_finished()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  o RECORD;
  v_code text;
  v_total int;
  v_done int;
BEGIN
  IF NEW.stage <> 'embalagem' OR NEW.status <> 'concluida' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'concluida' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'concluida')
    INTO v_total, v_done
    FROM public.order_coli_stages
   WHERE order_id = NEW.order_id AND stage = 'embalagem';

  IF v_total > 0 AND v_done < v_total THEN
    RETURN NEW; -- há volumes por embalar
  END IF;

  SELECT po.id, po.order_number, po.product_description, po.barcode,
         m.code AS model_code
    INTO o
  FROM public.production_orders po
  LEFT JOIN public.models m ON m.id = po.model_id
  WHERE po.id = NEW.order_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_code := COALESCE(o.model_code, o.product_description);

  IF NOT EXISTS (SELECT 1 FROM public.finished_goods WHERE order_id = o.id) THEN
    INSERT INTO public.finished_goods(order_id, product_code, barcode, quantity, status, ready_for_transfer)
    VALUES (o.id, v_code, o.barcode, 1, 'em_stock', true);

    INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
    VALUES ('finished_good', o.id, 1, 'Embalagem concluída - enc ' || o.order_number);
  END IF;

  UPDATE public.production_orders
     SET status = 'concluida'::public.order_status
   WHERE id = o.id
     AND status NOT IN ('concluida','cancelada');

  RETURN NEW;
END;
$function$;

-- 5) Criação de volumes: rota sem etapas usa rota completa; falha é visível
CREATE OR REPLACE FUNCTION public.create_order_colis(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cat text; v_struct text;
  v_barcode text;
  v_order_number text;
  v_base text;
  r RECORD;
  v_coli_id uuid;
  v_created int := 0;
  v_route_found boolean := false;
  v_inserted int;
  v_stages public.production_stage[] := ARRAY[
    'estrutura','corte','costura','branco','estofagem','qualidade','embalagem','picagem'
  ]::public.production_stage[];
  st public.production_stage;
BEGIN
  IF EXISTS (SELECT 1 FROM public.order_colis WHERE order_id = _order_id) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true);
  END IF;

  SELECT barcode, order_number INTO v_barcode, v_order_number
    FROM public.production_orders WHERE id = _order_id;

  v_base := COALESCE(NULLIF(btrim(v_barcode), ''), v_order_number);
  IF v_base IS NULL OR v_base = '' THEN
    RAISE EXCEPTION 'Não foi possível criar volumes: encomenda sem código nem número';
  END IF;

  SELECT category_code, structure_code INTO v_cat, v_struct
    FROM public.get_order_route_keys(_order_id);

  FOR r IN
    SELECT id, coli_number, coli_name
      FROM public.structure_coli_routes
     WHERE category_code = v_cat AND structure_code = v_struct
     ORDER BY coli_number
  LOOP
    v_route_found := true;
    INSERT INTO public.order_colis(order_id, coli_number, coli_name, coli_barcode)
    VALUES (_order_id, r.coli_number, r.coli_name, v_base || '-C' || r.coli_number)
    RETURNING id INTO v_coli_id;

    INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage)
    SELECT v_coli_id, _order_id, scs.stage
      FROM public.structure_coli_stages scs
     WHERE scs.route_id = r.id AND scs.included = true
    ON CONFLICT (order_coli_id, stage) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 0 THEN
      -- rota sem etapas configuradas: usar rota completa em vez de volume vazio
      FOREACH st IN ARRAY v_stages LOOP
        INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage)
        VALUES (v_coli_id, _order_id, st)
        ON CONFLICT (order_coli_id, stage) DO NOTHING;
      END LOOP;
    END IF;

    v_created := v_created + 1;
  END LOOP;

  IF NOT v_route_found THEN
    INSERT INTO public.order_colis(order_id, coli_number, coli_name, coli_barcode)
    VALUES (_order_id, 1, 'Produto completo', v_base || '-C1')
    RETURNING id INTO v_coli_id;
    FOREACH st IN ARRAY v_stages LOOP
      INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage)
      VALUES (v_coli_id, _order_id, st)
      ON CONFLICT (order_coli_id, stage) DO NOTHING;
    END LOOP;
    v_created := 1;
  END IF;

  RETURN jsonb_build_object('ok', true, 'created', v_created, 'route_found', v_route_found);
END;
$function$;

CREATE OR REPLACE FUNCTION public.production_orders_after_insert_colis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.create_order_colis(NEW.id);
  RETURN NEW;
END;
$function$;

-- 6) REPARAÇÃO idempotente: volumes existentes sem etapas
CREATE OR REPLACE FUNCTION public.repair_missing_coli_stages()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c RECORD;
  v_keys RECORD;
  v_route_id uuid;
  v_inserted int;
  v_fixed int := 0;
  v_stages public.production_stage[] := ARRAY[
    'estrutura','corte','costura','branco','estofagem','qualidade','embalagem','picagem'
  ]::public.production_stage[];
  st public.production_stage;
BEGIN
  FOR c IN
    SELECT oc.id, oc.order_id, oc.coli_number
      FROM public.order_colis oc
     WHERE NOT EXISTS (
       SELECT 1 FROM public.order_coli_stages s WHERE s.order_coli_id = oc.id
     )
  LOOP
    SELECT category_code, structure_code INTO v_keys
      FROM public.get_order_route_keys(c.order_id);

    SELECT id INTO v_route_id
      FROM public.structure_coli_routes
     WHERE category_code = v_keys.category_code
       AND structure_code = v_keys.structure_code
       AND coli_number = c.coli_number
     LIMIT 1;

    v_inserted := 0;
    IF v_route_id IS NOT NULL THEN
      INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage)
      SELECT c.id, c.order_id, scs.stage
        FROM public.structure_coli_stages scs
       WHERE scs.route_id = v_route_id AND scs.included = true
      ON CONFLICT (order_coli_id, stage) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
    END IF;

    IF v_inserted = 0 THEN
      FOREACH st IN ARRAY v_stages LOOP
        INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage)
        VALUES (c.id, c.order_id, st)
        ON CONFLICT (order_coli_id, stage) DO NOTHING;
      END LOOP;
    END IF;

    v_fixed := v_fixed + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'colis_reparados', v_fixed);
END;
$function$;

REVOKE ALL ON FUNCTION public.repair_missing_coli_stages() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repair_missing_coli_stages() TO authenticated, service_role;

SELECT public.repair_missing_coli_stages();

-- 7) Retrabalho: reabre também as etapas dos volumes, por dependências reais
CREATE OR REPLACE FUNCTION public.send_to_rework(_order_id uuid, _detected_stage production_stage, _target_stage production_stage, _operator_code text, _reason_id uuid, _reason_notes text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op public.operators;
  v_linked boolean;
  v_event_id uuid;
  v_di int := public.stage_order_index(_detected_stage);
  v_ti int := public.stage_order_index(_target_stage);
BEGIN
  IF v_ti IS NULL OR v_di IS NULL THEN
    RAISE EXCEPTION 'Etapa inválida';
  END IF;
  IF v_ti >= v_di THEN
    RAISE EXCEPTION 'A etapa de destino tem de ser anterior à etapa atual';
  END IF;

  SELECT * INTO v_op FROM public.operators WHERE code = _operator_code AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operador "%" não encontrado ou inativo', _operator_code;
  END IF;

  PERFORM public.assert_operator_is_session(v_op);

  SELECT EXISTS(
    SELECT 1 FROM public.operator_stages
    WHERE operator_id = v_op.id AND stage = _detected_stage
  ) INTO v_linked;
  IF NOT v_linked THEN
    RAISE EXCEPTION 'O operador % não está atribuído à etapa %', v_op.code, _detected_stage;
  END IF;

  INSERT INTO public.rework_events(
    order_id, detected_at_stage, sent_to_stage, reason_id, reason_notes, operator_id
  ) VALUES (_order_id, _detected_stage, _target_stage, _reason_id, _reason_notes, v_op.id)
  RETURNING id INTO v_event_id;

  -- Etapas dos volumes: o destino e tudo o que depende dele, até à etapa detetada
  UPDATE public.order_coli_stages cs
     SET status = 'pendente',
         is_paused = false,
         started_at = NULL,
         finished_at = NULL,
         last_resume_at = NULL,
         pause_started_at = NULL,
         notes = COALESCE(cs.notes,'') || ' [Retrabalho ' || v_event_id::text || ']'
   WHERE cs.order_id = _order_id
     AND public.stage_order_index(cs.stage) <= v_di
     AND (cs.stage = _target_stage OR _target_stage = ANY (public.stage_prerequisites(cs.stage)));

  -- Resumo da encomenda
  UPDATE public.order_stages os
     SET status = 'pendente',
         is_rework = true,
         is_paused = false,
         started_at = NULL,
         finished_at = NULL,
         check_valid = false,
         rework_count = CASE WHEN os.stage = _target_stage THEN os.rework_count + 1 ELSE os.rework_count END,
         notes = COALESCE(os.notes,'') || ' [Retrabalho ' || v_event_id::text || ']'
   WHERE os.order_id = _order_id
     AND public.stage_order_index(os.stage) <= v_di
     AND (os.stage = _target_stage OR _target_stage = ANY (public.stage_prerequisites(os.stage)));

  -- Produto deixa de estar disponível para transferência
  UPDATE public.finished_goods
     SET ready_for_transfer = false
   WHERE order_id = _order_id
     AND status <> 'transferido';

  UPDATE public.production_orders
     SET status = 'em_producao'
   WHERE id = _order_id AND status NOT IN ('cancelada');

  RETURN jsonb_build_object(
    'ok', true,
    'rework_event_id', v_event_id,
    'reopened_from', _target_stage,
    'reopened_to', _detected_stage
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.send_to_rework(uuid, production_stage, production_stage, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_to_rework(uuid, production_stage, production_stage, text, uuid, text) TO authenticated, service_role;