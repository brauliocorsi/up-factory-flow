ALTER TABLE public.models ADD COLUMN IF NOT EXISTS meters_per_unit numeric;

CREATE TABLE IF NOT EXISTS public.fabric_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.production_orders(id) ON DELETE CASCADE,
  roll_id uuid REFERENCES public.fabric_rolls(id) ON DELETE SET NULL,
  fabric_ref_code text,
  color_code text,
  meters numeric NOT NULL,
  operator_id uuid REFERENCES public.operators(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.fabric_consumptions TO authenticated;
GRANT ALL ON public.fabric_consumptions TO service_role;
ALTER TABLE public.fabric_consumptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fabric_consumptions_select" ON public.fabric_consumptions;
CREATE POLICY "fabric_consumptions_select" ON public.fabric_consumptions
  FOR SELECT TO authenticated USING (true);

-- desligar consumo automático de metros no corte
CREATE OR REPLACE FUNCTION public.order_stages_after_complete_consume()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  o RECORD;
  rec public.product_recipe;
  v_estr_notes text;
  v_corte_notes text;
  v_costura_notes text;
  v_cover_notes text;
  v_shell_state text;
  v_shell_code text;
  v_cover_state text;
  v_cover_code text;
  v_sh_id uuid;
  v_cv_id uuid;
BEGIN
  IF NEW.status <> 'concluida' OR OLD.status = 'concluida' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO o FROM public.production_orders WHERE id = NEW.order_id;
  IF o.is_stock_production THEN RETURN NEW; END IF;

  rec := public.resolve_order_recipe(NEW.order_id);

  IF NEW.stage = 'estofagem' THEN
    IF o.reserved_shell_id IS NOT NULL THEN
      SELECT id INTO v_sh_id FROM public.shells WHERE id = o.reserved_shell_id FOR UPDATE;
      IF v_sh_id IS NOT NULL THEN
        UPDATE public.shells
           SET quantity = GREATEST(0, quantity - 1),
               reserved = GREATEST(0, COALESCE(reserved,0) - 1)
         WHERE id = v_sh_id;
        INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
          VALUES ('shell', v_sh_id, -1,
                  'Consumido na estofagem ['||COALESCE(o.reserved_shell_state,'?')||'] - enc ' || o.order_number);
        UPDATE public.production_orders SET reserved_shell_id = NULL WHERE id = o.id;
      END IF;
    ELSE
      SELECT notes INTO v_estr_notes FROM public.order_stages
       WHERE order_id = NEW.order_id AND stage = 'estrutura';
      IF v_estr_notes LIKE 'Concluída de stock%' AND rec.shell_id IS NOT NULL THEN
        IF v_estr_notes ~ 'casco branco ' THEN
          v_shell_state := 'branco';
          v_shell_code := substring(v_estr_notes from 'casco branco ([^)]+)\)');
        ELSE
          v_shell_state := 'casco';
          v_shell_code := substring(v_estr_notes from 'casco (?!branco )([^)]+)\)');
        END IF;
        SELECT id INTO v_sh_id FROM public.shells
          WHERE id = rec.shell_id AND state = v_shell_state
            AND (v_shell_code IS NULL OR code = v_shell_code)
            AND COALESCE(reserved,0) >= 1
          ORDER BY reserved DESC NULLS LAST LIMIT 1 FOR UPDATE;
        IF v_sh_id IS NOT NULL THEN
          UPDATE public.shells
             SET quantity = GREATEST(0, quantity - 1),
                 reserved = GREATEST(0, COALESCE(reserved,0) - 1)
           WHERE id = v_sh_id;
          INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
            VALUES ('shell', v_sh_id, -1,
                    'Consumido na estofagem ['||v_shell_state||'] (fallback) - enc ' || o.order_number);
        END IF;
      END IF;
    END IF;

    IF o.reserved_cover_id IS NOT NULL THEN
      SELECT id INTO v_cv_id FROM public.covers WHERE id = o.reserved_cover_id FOR UPDATE;
      IF v_cv_id IS NOT NULL THEN
        UPDATE public.covers
           SET quantity = GREATEST(0, quantity - 1),
               reserved = GREATEST(0, COALESCE(reserved,0) - 1)
         WHERE id = v_cv_id;
        INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
          VALUES ('cover', v_cv_id, -1,
                  'Consumido na estofagem ['||COALESCE(o.reserved_cover_state,'?')||'] - enc ' || o.order_number);
        UPDATE public.production_orders SET reserved_cover_id = NULL WHERE id = o.id;
      END IF;
    ELSE
      SELECT notes INTO v_corte_notes   FROM public.order_stages WHERE order_id = NEW.order_id AND stage = 'corte';
      SELECT notes INTO v_costura_notes FROM public.order_stages WHERE order_id = NEW.order_id AND stage = 'costura';
      v_cover_notes := COALESCE(
        CASE WHEN v_corte_notes   LIKE 'Concluída de stock%' THEN v_corte_notes   END,
        CASE WHEN v_costura_notes LIKE 'Concluída de stock%' THEN v_costura_notes END
      );
      IF v_cover_notes IS NOT NULL THEN
        IF v_cover_notes ~ 'capa pronta ' THEN
          v_cover_state := 'pronta';
          v_cover_code := substring(v_cover_notes from 'capa pronta ([^)]+)\)');
        ELSIF v_cover_notes ~ 'capa cortada ' THEN
          v_cover_state := 'cortada';
          v_cover_code := substring(v_cover_notes from 'capa cortada ([^)]+)\)');
        END IF;
        IF v_cover_code IS NOT NULL THEN
          SELECT id INTO v_cv_id FROM public.covers
            WHERE code = v_cover_code AND state = v_cover_state AND COALESCE(reserved,0) >= 1
            ORDER BY reserved DESC LIMIT 1 FOR UPDATE;
          IF v_cv_id IS NOT NULL THEN
            UPDATE public.covers
               SET quantity = GREATEST(0, quantity - 1),
                   reserved = GREATEST(0, COALESCE(reserved,0) - 1)
             WHERE id = v_cv_id;
            INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
              VALUES ('cover', v_cv_id, -1,
                      'Consumido na estofagem ['||v_cover_state||'] (fallback) - enc ' || o.order_number);
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  -- CORTE: consumo de metros agora é manual (botão "Consumir")
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.consume_fabric_for_order(
  _order_id uuid,
  _roll_id uuid,
  _meters numeric,
  _operator_code text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  o RECORD;
  roll public.fabric_rolls;
  op public.operators;
  is_staff boolean;
  can_cut boolean := false;
BEGIN
  is_staff := public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'escritorio');

  IF _operator_code IS NOT NULL AND length(trim(_operator_code)) > 0 THEN
    SELECT * INTO op FROM public.operators WHERE code = trim(_operator_code) AND active LIMIT 1;
    IF op.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'message', 'Operador não encontrado ou inativo.');
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.operator_stages WHERE operator_id = op.id AND stage = 'corte'
    ) INTO can_cut;
  END IF;

  IF NOT is_staff AND NOT can_cut THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Sem permissão para consumir tecido (admin, escritório ou operador de corte).');
  END IF;

  SELECT * INTO o FROM public.production_orders WHERE id = _order_id;
  IF o.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Encomenda não encontrada.');
  END IF;

  IF _meters IS NULL OR _meters <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Metros a consumir inválidos. Define os metros no modelo.');
  END IF;

  IF EXISTS (SELECT 1 FROM public.fabric_consumptions WHERE order_id = _order_id) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Tecido já consumido para esta encomenda.');
  END IF;

  SELECT * INTO roll FROM public.fabric_rolls WHERE id = _roll_id FOR UPDATE;
  IF roll.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Rolo de tecido não encontrado.');
  END IF;
  IF roll.meters < _meters THEN
    RETURN jsonb_build_object('ok', false, 'message',
      'Metros insuficientes no rolo (' || roll.meters || 'm disponíveis).');
  END IF;

  UPDATE public.fabric_rolls SET meters = GREATEST(0, meters - _meters), updated_at = now()
   WHERE id = roll.id;

  INSERT INTO public.fabric_consumptions(order_id, roll_id, fabric_ref_code, color_code, meters, operator_id)
    VALUES (_order_id, roll.id, roll.fabric_ref_code, roll.color_code, _meters, op.id);

  INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
    VALUES ('fabric_roll', roll.id, -_meters, 'Corte (manual) - enc ' || o.order_number);

  RETURN jsonb_build_object('ok', true, 'meters', _meters, 'roll_id', roll.id,
    'fabric_ref_code', roll.fabric_ref_code, 'color_code', roll.color_code);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.undo_fabric_consumption(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  c public.fabric_consumptions;
  o RECORD;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'escritorio')) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Sem permissão para anular consumo de tecido.');
  END IF;

  SELECT * INTO c FROM public.fabric_consumptions WHERE order_id = _order_id;
  IF c.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Não existe consumo registado para esta encomenda.');
  END IF;

  SELECT * INTO o FROM public.production_orders WHERE id = _order_id;

  IF c.roll_id IS NOT NULL THEN
    UPDATE public.fabric_rolls SET meters = meters + c.meters, updated_at = now() WHERE id = c.roll_id;
    INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
      VALUES ('fabric_roll', c.roll_id, c.meters, 'Anulação de consumo - enc ' || COALESCE(o.order_number,'?'));
  END IF;

  DELETE FROM public.fabric_consumptions WHERE id = c.id;
  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.consume_fabric_for_order(uuid, uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.undo_fabric_consumption(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_fabric_for_order(uuid, uuid, numeric, text) FROM anon;
REVOKE ALL ON FUNCTION public.undo_fabric_consumption(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.consume_fabric_for_order(uuid, uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.undo_fabric_consumption(uuid) TO authenticated, service_role;