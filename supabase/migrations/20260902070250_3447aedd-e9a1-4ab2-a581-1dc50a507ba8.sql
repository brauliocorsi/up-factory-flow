-- Embalagem concluída => encomenda concluída
CREATE OR REPLACE FUNCTION public.order_stages_after_embalagem_finished()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o RECORD;
  v_code text;
BEGIN
  IF NEW.stage <> 'embalagem' OR NEW.status <> 'concluida' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'concluida' THEN
    RETURN NEW;
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
$$;

-- Picagem apenas registra transferência; não altera o estado da encomenda
CREATE OR REPLACE FUNCTION public.order_stages_after_picagem_finished()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.order_stages_after_embalagem_finished() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.order_stages_after_picagem_finished() FROM PUBLIC, anon;

-- Normalizar dados existentes
UPDATE public.production_orders
   SET status = 'concluida'::public.order_status
 WHERE status = 'em_armazem'::public.order_status;

UPDATE public.production_orders po
   SET status = 'concluida'::public.order_status
 WHERE po.status NOT IN ('concluida','cancelada')
   AND EXISTS (
     SELECT 1 FROM public.order_stages os
      WHERE os.order_id = po.id
        AND os.stage = 'embalagem'
        AND os.status = 'concluida'
   );
