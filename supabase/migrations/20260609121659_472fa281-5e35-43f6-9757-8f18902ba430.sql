
-- ============================================================
-- PROMPT 5b — Automação de semi-acabados (cascos, capas, tecido)
-- ============================================================

-- --------------------------------------------------------------
-- 1) Helper: resolver receita a partir de uma encomenda
-- Devolve a row do product_recipe correspondente à encomenda
-- fazendo joins defensivos (código vs nome) em estrutura/medida.
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_order_recipe(_order_id uuid)
RETURNS public.product_recipe
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o RECORD;
  v_model_code  text;
  v_cat_code    text;
  v_struct_code text;
  v_meas_code   text;
  rec public.product_recipe;
BEGIN
  SELECT po.*, m.code AS model_code, m.category_id
    INTO o
  FROM public.production_orders po
  LEFT JOIN public.models m ON m.id = po.model_id
  WHERE po.id = _order_id;

  IF NOT FOUND OR o.model_code IS NULL THEN
    RETURN NULL;
  END IF;

  v_model_code := o.model_code;

  SELECT c.code INTO v_cat_code
    FROM public.ref_categories c
   WHERE c.id = o.category_id;

  -- structure: aceitar code OU name
  SELECT s.code INTO v_struct_code
    FROM public.ref_structures s
   WHERE s.code = o.structure_type OR s.name = o.structure_type
   LIMIT 1;
  IF v_struct_code IS NULL THEN v_struct_code := o.structure_type; END IF;

  -- measure: aceitar code OU name
  SELECT mz.code INTO v_meas_code
    FROM public.ref_measures mz
   WHERE mz.code = o.measure OR mz.name = o.measure
   LIMIT 1;
  IF v_meas_code IS NULL THEN v_meas_code := o.measure; END IF;

  SELECT * INTO rec
    FROM public.product_recipe r
   WHERE r.model_code = v_model_code
     AND r.structure_code = v_struct_code
     AND r.measure_code = v_meas_code
     AND (v_cat_code IS NULL OR r.category_code = v_cat_code)
   LIMIT 1;

  RETURN rec;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_order_recipe(uuid) TO authenticated, service_role;

-- --------------------------------------------------------------
-- 2) Procurar capa correspondente a uma encomenda
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_matching_cover(_order_id uuid)
RETURNS public.covers
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o RECORD;
  m_code text;
  s_code text;
  z_code text;
  ft_code text;
  fr_code text;
  cl_code text;
  cv public.covers;
BEGIN
  SELECT po.*, mo.code AS model_code
    INTO o
  FROM public.production_orders po
  LEFT JOIN public.models mo ON mo.id = po.model_id
  WHERE po.id = _order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  m_code := o.model_code;

  SELECT code INTO s_code FROM public.ref_structures
    WHERE code = o.structure_type OR name = o.structure_type LIMIT 1;
  IF s_code IS NULL THEN s_code := o.structure_type; END IF;

  SELECT code INTO z_code FROM public.ref_measures
    WHERE code = o.measure OR name = o.measure LIMIT 1;
  IF z_code IS NULL THEN z_code := o.measure; END IF;

  SELECT code INTO ft_code FROM public.ref_fabric_types
    WHERE code = o.fabric_type OR name = o.fabric_type LIMIT 1;
  IF ft_code IS NULL THEN ft_code := o.fabric_type; END IF;

  SELECT code INTO fr_code FROM public.ref_fabric_refs
    WHERE code = o.fabric_ref OR name = o.fabric_ref LIMIT 1;
  IF fr_code IS NULL THEN fr_code := o.fabric_ref; END IF;

  SELECT code INTO cl_code FROM public.ref_colors
    WHERE code = o.color OR name = o.color LIMIT 1;
  IF cl_code IS NULL THEN cl_code := o.color; END IF;

  SELECT * INTO cv FROM public.covers c
   WHERE COALESCE(c.model_code,'') = COALESCE(m_code,'')
     AND COALESCE(c.structure_code,'') = COALESCE(s_code,'')
     AND COALESCE(c.measure_code,'') = COALESCE(z_code,'')
     AND COALESCE(c.fabric_type_code,'') = COALESCE(ft_code,'')
     AND COALESCE(c.fabric_ref_code,'') = COALESCE(fr_code,'')
     AND COALESCE(c.color_code,'') = COALESCE(cl_code,'')
     AND (c.quantity - COALESCE(c.reserved,0)) >= 1
   ORDER BY c.quantity - COALESCE(c.reserved,0) DESC
   LIMIT 1;

  RETURN cv;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_matching_cover(uuid) TO authenticated, service_role;

-- --------------------------------------------------------------
-- 3) Reservar stock para encomenda (idempotente)
-- Marca as etapas como concluídas "de stock" quando aplicável.
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_reserve_for_order(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o RECORD;
  rec public.product_recipe;
  sh public.shells;
  cv public.covers;
  res jsonb := jsonb_build_object('shell', null, 'cover', null);
BEGIN
  SELECT * INTO o FROM public.production_orders WHERE id = _order_id;
  IF NOT FOUND THEN RETURN res; END IF;
  IF o.is_stock_production THEN RETURN res; END IF;
  IF o.status = 'cancelada' THEN RETURN res; END IF;

  -- Idempotência: se já há reservas registadas nas notes desta encomenda, sair
  IF EXISTS (
    SELECT 1 FROM public.order_stages
     WHERE order_id = _order_id
       AND notes LIKE 'Concluída de stock%'
  ) THEN
    RETURN res;
  END IF;

  rec := public.resolve_order_recipe(_order_id);
  IF rec.id IS NULL THEN
    RETURN res;
  END IF;

  -- CASCO
  IF rec.shell_id IS NOT NULL THEN
    SELECT * INTO sh FROM public.shells WHERE id = rec.shell_id FOR UPDATE;
    IF FOUND AND (sh.quantity - COALESCE(sh.reserved,0)) >= 1 THEN
      UPDATE public.shells SET reserved = COALESCE(reserved,0) + 1 WHERE id = sh.id;
      INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
        VALUES ('shell', sh.id, 0, 'Reservado para encomenda ' || o.order_number);
      UPDATE public.order_stages
         SET status = 'concluida', finished_at = now(), check_valid = true,
             notes = 'Concluída de stock (casco ' || sh.code || ')'
       WHERE order_id = _order_id AND stage IN ('estrutura','branco');
      res := jsonb_set(res, '{shell}', to_jsonb(sh.code));
    END IF;
  END IF;

  -- CAPA
  IF COALESCE(rec.cover_required, true) THEN
    cv := public.find_matching_cover(_order_id);
    IF cv.id IS NOT NULL THEN
      UPDATE public.covers SET reserved = COALESCE(reserved,0) + 1 WHERE id = cv.id;
      INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
        VALUES ('cover', cv.id, 0, 'Reservado para encomenda ' || o.order_number);
      UPDATE public.order_stages
         SET status = 'concluida', finished_at = now(), check_valid = true,
             notes = 'Concluída de stock (capa ' || cv.code || ')'
       WHERE order_id = _order_id AND stage IN ('corte','costura');
      res := jsonb_set(res, '{cover}', to_jsonb(cv.code));
    END IF;
  END IF;

  RETURN res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.try_reserve_for_order(uuid) TO authenticated, service_role;

-- --------------------------------------------------------------
-- 4) Trigger: ao inserir encomenda, tentar reservar
-- Executa DEPOIS do trigger create_default_stages (ordem alfabética
-- de nome: "zz_reserve" garante que corre por último).
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.production_orders_after_insert_reserve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE(NEW.is_stock_production, false) THEN
    PERFORM public.try_reserve_for_order(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_reserve_on_order_insert ON public.production_orders;
CREATE TRIGGER zz_reserve_on_order_insert
AFTER INSERT ON public.production_orders
FOR EACH ROW EXECUTE FUNCTION public.production_orders_after_insert_reserve();

-- --------------------------------------------------------------
-- 5) Trigger: ao concluir etapa, consumir stock
--   Estofagem → consome casco/capa reservados
--   Corte → consome metros do rolo (se produção real, não de stock)
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.order_stages_after_complete_consume()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o RECORD;
  rec public.product_recipe;
  cv public.covers;
  roll public.fabric_rolls;
  consume_meters numeric;
BEGIN
  IF NEW.status <> 'concluida' OR OLD.status = 'concluida' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO o FROM public.production_orders WHERE id = NEW.order_id;
  IF o.is_stock_production THEN RETURN NEW; END IF;

  rec := public.resolve_order_recipe(NEW.order_id);

  -- ESTOFAGEM: consome casco/capa reservados
  IF NEW.stage = 'estofagem' AND rec.id IS NOT NULL THEN
    IF rec.shell_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.order_stages
       WHERE order_id = NEW.order_id AND stage = 'estrutura'
         AND notes LIKE 'Concluída de stock%'
    ) THEN
      UPDATE public.shells
         SET quantity = GREATEST(0, quantity - 1),
             reserved = GREATEST(0, COALESCE(reserved,0) - 1)
       WHERE id = rec.shell_id;
      INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
        VALUES ('shell', rec.shell_id, -1, 'Consumido na estofagem - enc ' || o.order_number);
    END IF;

    -- Capa: encontrar a capa reservada via match (já registada nas notes)
    cv := public.find_matching_cover(NEW.order_id);
    IF cv.id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.order_stages
       WHERE order_id = NEW.order_id AND stage = 'corte'
         AND notes LIKE 'Concluída de stock%'
    ) THEN
      -- Encontrar a capa correta: usar a que tem reserved > 0 mais provável
      UPDATE public.covers
         SET quantity = GREATEST(0, quantity - 1),
             reserved = GREATEST(0, COALESCE(reserved,0) - 1)
       WHERE id = cv.id;
      INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
        VALUES ('cover', cv.id, -1, 'Consumido na estofagem - enc ' || o.order_number);
    END IF;
  END IF;

  -- CORTE: consome metros do rolo (apenas se for produção real, não de stock)
  IF NEW.stage = 'corte' AND rec.id IS NOT NULL
     AND COALESCE(rec.meters_per_unit, 0) > 0
     AND (NEW.notes IS NULL OR NEW.notes NOT LIKE 'Concluída de stock%') THEN
    consume_meters := rec.meters_per_unit;
    SELECT * INTO roll FROM public.fabric_rolls
      WHERE fabric_ref_code = o.fabric_ref
        AND (color_code = o.color OR color_code IS NULL)
        AND meters >= consume_meters
      ORDER BY meters ASC
      LIMIT 1;
    IF roll.id IS NOT NULL THEN
      UPDATE public.fabric_rolls
         SET meters = GREATEST(0, meters - consume_meters)
       WHERE id = roll.id;
      INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
        VALUES ('fabric_roll', roll.id, -consume_meters, 'Corte - enc ' || o.order_number);
    ELSE
      -- avisar mas não bloquear
      INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
        VALUES ('fabric_roll', gen_random_uuid(), 0, 'AVISO: sem rolo com ' || consume_meters || 'm para enc ' || o.order_number);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_consume_on_stage_complete ON public.order_stages;
CREATE TRIGGER zz_consume_on_stage_complete
AFTER UPDATE ON public.order_stages
FOR EACH ROW EXECUTE FUNCTION public.order_stages_after_complete_consume();

-- --------------------------------------------------------------
-- 6) Pré-visualizar e executar cancelamento
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preview_cancel_order(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o RECORD;
  rec public.product_recipe;
  cv public.covers;
  shell_reserved boolean := false;
  cover_reserved boolean := false;
  shell_produced boolean := false;
  cover_produced boolean := false;
  estrut_done boolean;
  branco_done boolean;
  corte_done boolean;
  costura_done boolean;
  estof_done boolean;
  notes_estrutura text;
  notes_corte text;
  shell_code text;
  cover_code text;
BEGIN
  SELECT * INTO o FROM public.production_orders WHERE id = _order_id;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
  rec := public.resolve_order_recipe(_order_id);
  cv := public.find_matching_cover(_order_id);

  SELECT (status='concluida'), notes INTO estrut_done, notes_estrutura
    FROM public.order_stages WHERE order_id=_order_id AND stage='estrutura';
  SELECT (status='concluida') INTO branco_done
    FROM public.order_stages WHERE order_id=_order_id AND stage='branco';
  SELECT (status='concluida'), notes INTO corte_done, notes_corte
    FROM public.order_stages WHERE order_id=_order_id AND stage='corte';
  SELECT (status='concluida') INTO costura_done
    FROM public.order_stages WHERE order_id=_order_id AND stage='costura';
  SELECT (status='concluida') INTO estof_done
    FROM public.order_stages WHERE order_id=_order_id AND stage='estofagem';

  shell_reserved := COALESCE(notes_estrutura LIKE 'Concluída de stock%', false) AND NOT COALESCE(estof_done,false);
  cover_reserved := COALESCE(notes_corte LIKE 'Concluída de stock%', false) AND NOT COALESCE(estof_done,false);
  shell_produced := COALESCE(estrut_done,false) AND COALESCE(branco_done,false)
                    AND NOT COALESCE(notes_estrutura LIKE 'Concluída de stock%', false)
                    AND NOT COALESCE(estof_done,false);
  cover_produced := COALESCE(corte_done,false) AND COALESCE(costura_done,false)
                    AND NOT COALESCE(notes_corte LIKE 'Concluída de stock%', false)
                    AND NOT COALESCE(estof_done,false);

  IF rec.shell_id IS NOT NULL THEN
    SELECT code INTO shell_code FROM public.shells WHERE id = rec.shell_id;
  END IF;
  IF cv.id IS NOT NULL THEN
    cover_code := cv.code;
  END IF;

  RETURN jsonb_build_object(
    'order_number', o.order_number,
    'shell_code', shell_code,
    'cover_code', cover_code,
    'shell_reserved_to_release', shell_reserved,
    'cover_reserved_to_release', cover_reserved,
    'shell_to_return_to_stock', shell_produced,
    'cover_to_return_to_stock', cover_produced
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_cancel_order(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_order_with_recovery(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o RECORD;
  prev jsonb;
  rec public.product_recipe;
  cv public.covers;
  new_cover_id uuid;
BEGIN
  SELECT * INTO o FROM public.production_orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Encomenda não encontrada'; END IF;
  IF o.status = 'cancelada' THEN RAISE EXCEPTION 'Encomenda já cancelada'; END IF;

  prev := public.preview_cancel_order(_order_id);
  rec := public.resolve_order_recipe(_order_id);

  -- 1) Libertar reservas não consumidas
  IF (prev->>'shell_reserved_to_release')::boolean AND rec.shell_id IS NOT NULL THEN
    UPDATE public.shells SET reserved = GREATEST(0, COALESCE(reserved,0) - 1)
     WHERE id = rec.shell_id;
    INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
      VALUES ('shell', rec.shell_id, 0, 'Libertação de reserva - cancelamento enc ' || o.order_number);
  END IF;

  cv := public.find_matching_cover(_order_id);
  IF (prev->>'cover_reserved_to_release')::boolean AND cv.id IS NOT NULL THEN
    UPDATE public.covers SET reserved = GREATEST(0, COALESCE(reserved,0) - 1)
     WHERE id = cv.id;
    INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
      VALUES ('cover', cv.id, 0, 'Libertação de reserva - cancelamento enc ' || o.order_number);
  END IF;

  -- 2) Recuperar trabalho já feito
  IF (prev->>'shell_to_return_to_stock')::boolean AND rec.shell_id IS NOT NULL THEN
    UPDATE public.shells SET quantity = quantity + 1 WHERE id = rec.shell_id;
    INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
      VALUES ('shell', rec.shell_id, 1, 'Recuperado de cancelamento - enc ' || o.order_number);
  END IF;

  IF (prev->>'cover_to_return_to_stock')::boolean THEN
    IF cv.id IS NOT NULL THEN
      UPDATE public.covers SET quantity = quantity + 1 WHERE id = cv.id;
      INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
        VALUES ('cover', cv.id, 1, 'Recuperado de cancelamento - enc ' || o.order_number);
    ELSE
      -- criar capa nova com os códigos da encomenda
      INSERT INTO public.covers(code, name, model_code, structure_code, measure_code,
                                fabric_type_code, fabric_ref_code, color_code, quantity)
      VALUES ('AUTO-' || substring(o.order_number,1,16),
              'Capa recuperada ' || o.order_number,
              (SELECT code FROM public.models WHERE id = o.model_id),
              o.structure_type, o.measure, o.fabric_type, o.fabric_ref, o.color, 1)
      RETURNING id INTO new_cover_id;
      INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
        VALUES ('cover', new_cover_id, 1, 'Capa criada de cancelamento - enc ' || o.order_number);
    END IF;
  END IF;

  -- 3) Marcar etapas futuras como bloqueadas com nota "Cancelada"
  UPDATE public.order_stages
     SET status = 'bloqueada', notes = COALESCE(notes,'') || ' [Cancelada]'
   WHERE order_id = _order_id AND status <> 'concluida';

  -- 4) Marcar encomenda como cancelada
  UPDATE public.production_orders SET status = 'cancelada' WHERE id = _order_id;

  RETURN prev;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_order_with_recovery(uuid) TO authenticated, service_role;
