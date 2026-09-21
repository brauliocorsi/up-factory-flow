ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS stock_stages public.production_stage[];

-- Etapas por defeito: pedidos de stock com plano de etapas recebem só essas etapas
CREATE OR REPLACE FUNCTION public.create_default_stages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.is_stock_production, false)
     AND NEW.stock_stages IS NOT NULL
     AND array_length(NEW.stock_stages, 1) > 0 THEN
    INSERT INTO public.order_stages (order_id, stage)
    SELECT NEW.id, s
      FROM unnest(NEW.stock_stages) AS s
     ORDER BY public.stage_order_index(s);
  ELSIF COALESCE(NEW.line_kind, 'catalogo') = 'livre' THEN
    INSERT INTO public.order_stages (order_id, stage)
    SELECT NEW.id, s::public.production_stage
    FROM unnest(ARRAY['embalagem','picagem']) AS s;
  ELSE
    INSERT INTO public.order_stages (order_id, stage)
    SELECT NEW.id, s::public.production_stage
    FROM unnest(ARRAY['estrutura','corte','costura','branco','estofagem','qualidade','embalagem','picagem']) AS s;
  END IF;
  RETURN NEW;
END;
$function$;

-- Pedidos de stock com plano de etapas não geram volumes
CREATE OR REPLACE FUNCTION public.production_orders_after_insert_colis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.line_kind, 'catalogo') = 'livre' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.is_stock_production, false)
     AND NEW.stock_stages IS NOT NULL
     AND array_length(NEW.stock_stages, 1) > 0 THEN
    RETURN NEW;
  END IF;
  PERFORM public.create_order_colis(NEW.id);
  RETURN NEW;
END;
$function$;

-- Entrada em stock sem validação de cargo (uso interno, chamada pelo trigger)
CREATE OR REPLACE FUNCTION public.complete_stock_production_internal(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  o RECORD;
  v_new numeric;
BEGIN
  SELECT id, status, is_stock_production, stock_item_type, stock_item_id, stock_quantity
    INTO o
    FROM public.production_orders
   WHERE id = _order_id
     FOR UPDATE;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'message', 'Encomenda não encontrada'); END IF;
  IF NOT COALESCE(o.is_stock_production, false) THEN RETURN jsonb_build_object('ok', false, 'message', 'Não é ordem de stock'); END IF;
  IF o.status IN ('concluida','em_armazem','cancelada') THEN RETURN jsonb_build_object('ok', false, 'message', 'Ordem já finalizada'); END IF;
  IF o.stock_item_id IS NULL OR o.stock_item_type IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Ordem de stock sem item'); END IF;

  UPDATE public.production_orders
     SET status = 'concluida'::public.order_status
   WHERE id = o.id AND status = o.status;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'message', 'Ordem já finalizada por outra operação'); END IF;

  IF o.stock_item_type = 'shell' THEN
    UPDATE public.shells SET quantity = quantity + COALESCE(o.stock_quantity, 0)
     WHERE id = o.stock_item_id RETURNING quantity INTO v_new;
  ELSE
    UPDATE public.covers SET quantity = quantity + COALESCE(o.stock_quantity, 0)
     WHERE id = o.stock_item_id RETURNING quantity INTO v_new;
  END IF;

  IF v_new IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Item de stock não encontrado'); END IF;

  INSERT INTO public.stock_movements(item_type, item_id, delta, reason, user_id)
  VALUES (o.stock_item_type, o.stock_item_id, COALESCE(o.stock_quantity, 0),
          'Produção para stock (etapas concluídas) ' || o.id::text, auth.uid());

  RETURN jsonb_build_object('ok', true, 'new_value', v_new);
END;
$function$;

-- Trigger: ao concluir a última etapa do plano, dá entrada no stock
CREATE OR REPLACE FUNCTION public.order_stages_after_stock_plan_done()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  o RECORD;
  v_total int;
  v_done int;
BEGIN
  IF NEW.status <> 'concluida' OR COALESCE(OLD.status::text, '') = 'concluida' THEN
    RETURN NEW;
  END IF;

  SELECT id, status, is_stock_production, stock_stages
    INTO o
    FROM public.production_orders
   WHERE id = NEW.order_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NOT COALESCE(o.is_stock_production, false)
     OR o.stock_stages IS NULL
     OR array_length(o.stock_stages, 1) IS NULL THEN
    RETURN NEW;
  END IF;
  IF o.status IN ('concluida','em_armazem','cancelada') THEN RETURN NEW; END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'concluida')
    INTO v_total, v_done
    FROM public.order_stages
   WHERE order_id = NEW.order_id;

  IF v_total > 0 AND v_done >= v_total THEN
    PERFORM public.complete_stock_production_internal(NEW.order_id);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_order_stages_stock_plan_done ON public.order_stages;
CREATE TRIGGER trg_order_stages_stock_plan_done
AFTER UPDATE ON public.order_stages
FOR EACH ROW EXECUTE FUNCTION public.order_stages_after_stock_plan_done();

REVOKE ALL ON FUNCTION public.complete_stock_production_internal(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.order_stages_after_stock_plan_done() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_default_stages() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.production_orders_after_insert_colis() FROM PUBLIC, anon, authenticated;