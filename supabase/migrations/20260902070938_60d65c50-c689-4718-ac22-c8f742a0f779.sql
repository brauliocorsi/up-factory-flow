-- ============ 1. Sequência de etapas em qualquer transição ============
CREATE OR REPLACE FUNCTION public.enforce_stage_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('em_curso','concluida')
     AND COALESCE(OLD.status::text, '') <> NEW.status::text
     AND NOT COALESCE(NEW.is_rework, false) THEN
    PERFORM public.assert_previous_stages_done(NEW.order_id, NEW.stage);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_coli_stage_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('em_curso','concluida')
     AND COALESCE(OLD.status::text, '') <> NEW.status::text THEN
    PERFORM public.assert_previous_stages_done(NEW.order_id, NEW.stage);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_stage_sequence() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enforce_coli_stage_sequence() FROM PUBLIC, anon;

-- ============ 2. Stock atómico ============
CREATE OR REPLACE FUNCTION public.adjust_stock_atomic(
  _item_type text,
  _item_id uuid,
  _delta numeric,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new numeric;
BEGIN
  IF _item_type NOT IN ('fabric','shell','cover') THEN
    RAISE EXCEPTION 'Tipo de item inválido: %', _item_type;
  END IF;

  IF _item_type = 'fabric' THEN
    UPDATE public.fabric_rolls
       SET meters = GREATEST(0, meters + _delta)
     WHERE id = _item_id
    RETURNING meters INTO v_new;
  ELSIF _item_type = 'shell' THEN
    UPDATE public.shells
       SET quantity = GREATEST(0, quantity + _delta)::int
     WHERE id = _item_id
    RETURNING quantity INTO v_new;
  ELSE
    UPDATE public.covers
       SET quantity = GREATEST(0, quantity + _delta)::int
     WHERE id = _item_id
    RETURNING quantity INTO v_new;
  END IF;

  IF v_new IS NULL THEN
    RAISE EXCEPTION 'Item de stock não encontrado';
  END IF;

  INSERT INTO public.stock_movements(item_type, item_id, delta, reason, user_id)
  VALUES (_item_type, _item_id, _delta, _reason, auth.uid());

  RETURN jsonb_build_object('ok', true, 'new_value', v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_stock_production(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o RECORD;
  v_new numeric;
BEGIN
  -- Bloqueia a encomenda: impede duplo clique / execuções concorrentes
  SELECT id, status, is_stock_production, stock_item_type, stock_item_id, stock_quantity
    INTO o
    FROM public.production_orders
   WHERE id = _order_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Encomenda não encontrada';
  END IF;
  IF NOT COALESCE(o.is_stock_production, false) THEN
    RAISE EXCEPTION 'Não é ordem de stock';
  END IF;
  IF o.status IN ('concluida','em_armazem','cancelada') THEN
    RAISE EXCEPTION 'Ordem já finalizada';
  END IF;
  IF o.stock_item_id IS NULL OR o.stock_item_type IS NULL THEN
    RAISE EXCEPTION 'Ordem de stock sem item associado';
  END IF;

  UPDATE public.production_orders
     SET status = 'concluida'::public.order_status
   WHERE id = o.id
     AND status = o.status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ordem já finalizada por outra operação';
  END IF;

  IF o.stock_item_type = 'shell' THEN
    UPDATE public.shells
       SET quantity = quantity + COALESCE(o.stock_quantity, 0)
     WHERE id = o.stock_item_id
    RETURNING quantity INTO v_new;
  ELSE
    UPDATE public.covers
       SET quantity = quantity + COALESCE(o.stock_quantity, 0)
     WHERE id = o.stock_item_id
    RETURNING quantity INTO v_new;
  END IF;

  IF v_new IS NULL THEN
    RAISE EXCEPTION 'Item de stock não encontrado';
  END IF;

  INSERT INTO public.stock_movements(item_type, item_id, delta, reason, user_id)
  VALUES (o.stock_item_type, o.stock_item_id, COALESCE(o.stock_quantity, 0),
          'Produção para stock ' || o.id::text, auth.uid());

  RETURN jsonb_build_object('ok', true, 'new_value', v_new);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.adjust_stock_atomic(text, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_stock_production(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock_atomic(text, uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_stock_production(uuid) TO authenticated, service_role;
