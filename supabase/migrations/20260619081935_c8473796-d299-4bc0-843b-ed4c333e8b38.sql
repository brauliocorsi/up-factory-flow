
-- 1) Trigger: when order_stages.picagem -> concluida, set production_orders.status='em_armazem'
CREATE OR REPLACE FUNCTION public.order_stages_after_picagem_finished()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.stage <> 'picagem' OR NEW.status <> 'concluida' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'concluida' THEN
    RETURN NEW;
  END IF;

  UPDATE public.production_orders
     SET status = 'em_armazem'::public.order_status
   WHERE id = NEW.order_id
     AND status NOT IN ('em_armazem','cancelada');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_stages_after_picagem_finished ON public.order_stages;
CREATE TRIGGER trg_order_stages_after_picagem_finished
AFTER UPDATE ON public.order_stages
FOR EACH ROW
EXECUTE FUNCTION public.order_stages_after_picagem_finished();

-- 2) Function to scan a coli by barcode for picking
CREATE OR REPLACE FUNCTION public.scan_picking_coli(_order_id uuid, _scanned_code text, _operator_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_op public.operators;
  v_linked boolean;
  v_coli public.order_colis;
  v_cs public.order_coli_stages;
  v_clean text := btrim(_scanned_code);
  v_total int;
  v_done int;
  v_embalagem_done boolean;
BEGIN
  IF v_clean IS NULL OR v_clean = '' THEN
    RAISE EXCEPTION 'Código vazio';
  END IF;

  -- Validate operator exists and is linked to picagem
  SELECT * INTO v_op FROM public.operators WHERE code = _operator_code AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operador "%" não encontrado ou inativo', _operator_code;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.operator_stages WHERE operator_id = v_op.id AND stage = 'picagem'
  ) INTO v_linked;
  IF NOT v_linked THEN
    RAISE EXCEPTION 'O operador % não está atribuído à etapa de Picagem', v_op.code;
  END IF;

  -- Ensure embalagem is concluded
  SELECT (status = 'concluida') INTO v_embalagem_done
    FROM public.order_stages WHERE order_id = _order_id AND stage = 'embalagem';
  IF NOT COALESCE(v_embalagem_done, false) THEN
    RAISE EXCEPTION 'Encomenda ainda não foi embalada na fábrica.';
  END IF;

  -- Find coli by barcode within this order
  SELECT * INTO v_coli FROM public.order_colis
   WHERE order_id = _order_id AND coli_barcode = v_clean
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Código "%" não pertence a esta encomenda.', v_clean;
  END IF;

  -- Find the picagem stage for this coli
  SELECT * INTO v_cs FROM public.order_coli_stages
   WHERE order_coli_id = v_coli.id AND stage = 'picagem'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Etapa de Picagem do coli % não encontrada.', v_coli.coli_number;
  END IF;

  IF v_cs.status = 'concluida' THEN
    RAISE EXCEPTION 'Coli % já foi lido.', v_coli.coli_number;
  END IF;

  -- Mark this coli's picagem as concluida atomically
  UPDATE public.order_coli_stages
     SET status = 'concluida'::stage_status,
         started_at = COALESCE(started_at, now()),
         finished_at = now(),
         is_paused = false,
         pause_started_at = NULL,
         last_resume_at = NULL,
         operator_id = v_op.id
   WHERE id = v_cs.id;

  -- Sync aggregate stage (this triggers picagem -> concluida when all done, which fires order status update)
  PERFORM public.sync_order_stage_from_colis(_order_id, 'picagem'::production_stage);

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status='concluida')
    INTO v_total, v_done
   FROM public.order_coli_stages
  WHERE order_id = _order_id AND stage = 'picagem';

  RETURN jsonb_build_object(
    'ok', true,
    'coli_number', v_coli.coli_number,
    'coli_name', v_coli.coli_name,
    'done', v_done,
    'total', v_total,
    'completed', v_done = v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.scan_picking_coli(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scan_picking_coli(uuid, text, text) TO authenticated, service_role;
