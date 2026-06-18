
-- 1) Colunas estruturadas na encomenda
ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS reserved_shell_id uuid REFERENCES public.shells(id),
  ADD COLUMN IF NOT EXISTS reserved_shell_state text,
  ADD COLUMN IF NOT EXISTS reserved_cover_id uuid REFERENCES public.covers(id),
  ADD COLUMN IF NOT EXISTS reserved_cover_state text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_orders_reserved_shell_state_chk') THEN
    ALTER TABLE public.production_orders
      ADD CONSTRAINT production_orders_reserved_shell_state_chk
      CHECK (reserved_shell_state IS NULL OR reserved_shell_state IN ('casco','branco'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_orders_reserved_cover_state_chk') THEN
    ALTER TABLE public.production_orders
      ADD CONSTRAINT production_orders_reserved_cover_state_chk
      CHECK (reserved_cover_state IS NULL OR reserved_cover_state IN ('cortada','pronta'));
  END IF;
END $$;

-- 2) try_reserve_for_order: gravar reserved_*_id/state ao reservar
CREATE OR REPLACE FUNCTION public.try_reserve_for_order(_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF EXISTS (
    SELECT 1 FROM public.order_stages
     WHERE order_id = _order_id AND notes LIKE 'Concluída de stock%'
  ) THEN
    RETURN res;
  END IF;

  rec := public.resolve_order_recipe(_order_id);
  IF rec.id IS NULL THEN RETURN res; END IF;

  -- CASCO: preferir branco; fallback casco
  IF rec.shell_id IS NOT NULL THEN
    SELECT * INTO sh FROM public.shells
      WHERE id = rec.shell_id AND state = 'branco' FOR UPDATE;
    IF FOUND AND (sh.quantity - COALESCE(sh.reserved,0)) >= 1 THEN
      UPDATE public.shells SET reserved = COALESCE(reserved,0) + 1 WHERE id = sh.id;
      UPDATE public.production_orders
         SET reserved_shell_id = sh.id, reserved_shell_state = 'branco'
       WHERE id = _order_id;
      INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
        VALUES ('shell', sh.id, 0, 'Reservado (branco) para encomenda ' || o.order_number);
      UPDATE public.order_stages
         SET status = 'concluida', finished_at = now(), check_valid = true,
             notes = 'Concluída de stock (casco branco ' || sh.code || ')'
       WHERE order_id = _order_id AND stage IN ('estrutura','branco');
      res := jsonb_set(res, '{shell}', to_jsonb(sh.code || ' [branco]'));
    ELSE
      SELECT * INTO sh FROM public.shells
        WHERE id = rec.shell_id AND state = 'casco' FOR UPDATE;
      IF FOUND AND (sh.quantity - COALESCE(sh.reserved,0)) >= 1 THEN
        UPDATE public.shells SET reserved = COALESCE(reserved,0) + 1 WHERE id = sh.id;
        UPDATE public.production_orders
           SET reserved_shell_id = sh.id, reserved_shell_state = 'casco'
         WHERE id = _order_id;
        INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
          VALUES ('shell', sh.id, 0, 'Reservado (casco) para encomenda ' || o.order_number);
        UPDATE public.order_stages
           SET status = 'concluida', finished_at = now(), check_valid = true,
               notes = 'Concluída de stock (casco ' || sh.code || ')'
         WHERE order_id = _order_id AND stage = 'estrutura';
        res := jsonb_set(res, '{shell}', to_jsonb(sh.code || ' [casco]'));
      END IF;
    END IF;
  END IF;

  -- CAPA: preferir pronta; fallback cortada
  IF COALESCE(rec.cover_required, true) THEN
    cv := public.find_matching_cover_state(_order_id, 'pronta');
    IF cv.id IS NOT NULL THEN
      UPDATE public.covers SET reserved = COALESCE(reserved,0) + 1 WHERE id = cv.id;
      UPDATE public.production_orders
         SET reserved_cover_id = cv.id, reserved_cover_state = 'pronta'
       WHERE id = _order_id;
      INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
        VALUES ('cover', cv.id, 0, 'Reservado (pronta) para encomenda ' || o.order_number);
      UPDATE public.order_stages
         SET status = 'concluida', finished_at = now(), check_valid = true,
             notes = 'Concluída de stock (capa pronta ' || cv.code || ')'
       WHERE order_id = _order_id AND stage IN ('corte','costura');
      res := jsonb_set(res, '{cover}', to_jsonb(cv.code || ' [pronta]'));
    ELSE
      cv := public.find_matching_cover_state(_order_id, 'cortada');
      IF cv.id IS NOT NULL THEN
        UPDATE public.covers SET reserved = COALESCE(reserved,0) + 1 WHERE id = cv.id;
        UPDATE public.production_orders
           SET reserved_cover_id = cv.id, reserved_cover_state = 'cortada'
         WHERE id = _order_id;
        INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
          VALUES ('cover', cv.id, 0, 'Reservado (cortada) para encomenda ' || o.order_number);
        UPDATE public.order_stages
           SET status = 'concluida', finished_at = now(), check_valid = true,
               notes = 'Concluída de stock (capa cortada ' || cv.code || ')'
         WHERE order_id = _order_id AND stage = 'corte';
        res := jsonb_set(res, '{cover}', to_jsonb(cv.code || ' [cortada]'));
      END IF;
    END IF;
  END IF;

  RETURN res;
END;
$function$;

-- 3) Consumo na estofagem: ler das colunas; fallback de parsing para antigas
CREATE OR REPLACE FUNCTION public.order_stages_after_complete_consume()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  o RECORD;
  rec public.product_recipe;
  roll public.fabric_rolls;
  consume_meters numeric;
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
    -- CASCO: fonte de verdade = coluna reserved_shell_id
    IF o.reserved_shell_id IS NOT NULL THEN
      SELECT id INTO v_sh_id FROM public.shells
        WHERE id = o.reserved_shell_id FOR UPDATE;
      IF v_sh_id IS NOT NULL THEN
        UPDATE public.shells
           SET quantity = GREATEST(0, quantity - 1),
               reserved = GREATEST(0, COALESCE(reserved,0) - 1)
         WHERE id = v_sh_id;
        INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
          VALUES ('shell', v_sh_id, -1,
                  'Consumido na estofagem ['||COALESCE(o.reserved_shell_state,'?')||'] - enc ' || o.order_number);
        -- idempotência: marcar como consumido limpando o id (estado fica como histórico)
        UPDATE public.production_orders
           SET reserved_shell_id = NULL
         WHERE id = o.id;
      END IF;
    ELSE
      -- Fallback antigo: parsing das notas
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

    -- CAPA: fonte de verdade = coluna reserved_cover_id
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

  -- CORTE: consumo de metros (inalterado)
  IF NEW.stage = 'corte' AND rec.id IS NOT NULL
     AND COALESCE(rec.meters_per_unit, 0) > 0
     AND (NEW.notes IS NULL OR NEW.notes NOT LIKE 'Concluída de stock%') THEN
    consume_meters := rec.meters_per_unit;
    SELECT * INTO roll FROM public.fabric_rolls
      WHERE fabric_ref_code = o.fabric_ref
        AND (color_code = o.color OR color_code IS NULL)
        AND meters >= consume_meters
      ORDER BY meters ASC LIMIT 1;
    IF roll.id IS NOT NULL THEN
      UPDATE public.fabric_rolls SET meters = GREATEST(0, meters - consume_meters) WHERE id = roll.id;
      INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
        VALUES ('fabric_roll', roll.id, -consume_meters, 'Corte - enc ' || o.order_number);
    ELSE
      INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
        VALUES ('fabric_roll', gen_random_uuid(), 0,
                'AVISO: sem rolo com ' || consume_meters || 'm para enc ' || o.order_number);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 4) preview_cancel_order: usar colunas estruturadas
CREATE OR REPLACE FUNCTION public.preview_cancel_order(_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  o RECORD;
  estrut_done boolean;
  branco_done boolean;
  corte_done boolean;
  costura_done boolean;
  estof_done boolean;
  shell_reserved boolean := false;
  cover_reserved boolean := false;
  shell_produced boolean := false;
  cover_produced boolean := false;
  notes_estrutura text;
  notes_corte text;
  shell_code text;
  cover_code text;
BEGIN
  SELECT * INTO o FROM public.production_orders WHERE id = _order_id;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;

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

  -- Há reserva ainda por consumir? coluna != null e estofagem não concluída
  shell_reserved := o.reserved_shell_id IS NOT NULL AND NOT COALESCE(estof_done,false);
  cover_reserved := o.reserved_cover_id IS NOT NULL AND NOT COALESCE(estof_done,false);

  -- Produção real concluída a recuperar para stock?
  shell_produced := COALESCE(estrut_done,false) AND COALESCE(branco_done,false)
                    AND COALESCE(notes_estrutura,'') NOT LIKE 'Concluída de stock%'
                    AND NOT COALESCE(estof_done,false);
  cover_produced := COALESCE(corte_done,false) AND COALESCE(costura_done,false)
                    AND COALESCE(notes_corte,'') NOT LIKE 'Concluída de stock%'
                    AND NOT COALESCE(estof_done,false);

  IF o.reserved_shell_id IS NOT NULL THEN
    SELECT code INTO shell_code FROM public.shells WHERE id = o.reserved_shell_id;
  END IF;
  IF o.reserved_cover_id IS NOT NULL THEN
    SELECT code INTO cover_code FROM public.covers WHERE id = o.reserved_cover_id;
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
$function$;

-- 5) cancel_order_with_recovery: usar colunas estruturadas, nunca inventar capa
CREATE OR REPLACE FUNCTION public.cancel_order_with_recovery(_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  o RECORD;
  prev jsonb;
  rec public.product_recipe;
  new_cover_id uuid;
BEGIN
  SELECT * INTO o FROM public.production_orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Encomenda não encontrada'; END IF;
  IF o.status = 'cancelada' THEN RAISE EXCEPTION 'Encomenda já cancelada'; END IF;

  prev := public.preview_cancel_order(_order_id);
  rec := public.resolve_order_recipe(_order_id);

  -- 1) Libertar reservas não consumidas (linha exata)
  IF (prev->>'shell_reserved_to_release')::boolean AND o.reserved_shell_id IS NOT NULL THEN
    UPDATE public.shells SET reserved = GREATEST(0, COALESCE(reserved,0) - 1)
     WHERE id = o.reserved_shell_id;
    INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
      VALUES ('shell', o.reserved_shell_id, 0,
              'Libertação de reserva ['||COALESCE(o.reserved_shell_state,'?')||'] - cancelamento enc ' || o.order_number);
    UPDATE public.production_orders SET reserved_shell_id = NULL WHERE id = o.id;
  END IF;

  IF (prev->>'cover_reserved_to_release')::boolean AND o.reserved_cover_id IS NOT NULL THEN
    UPDATE public.covers SET reserved = GREATEST(0, COALESCE(reserved,0) - 1)
     WHERE id = o.reserved_cover_id;
    INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
      VALUES ('cover', o.reserved_cover_id, 0,
              'Libertação de reserva ['||COALESCE(o.reserved_cover_state,'?')||'] - cancelamento enc ' || o.order_number);
    UPDATE public.production_orders SET reserved_cover_id = NULL WHERE id = o.id;
  END IF;

  -- 2) Recuperar trabalho real (devolver +1 ao shell_id da receita, estado 'branco')
  IF (prev->>'shell_to_return_to_stock')::boolean AND rec.shell_id IS NOT NULL THEN
    UPDATE public.shells SET quantity = quantity + 1
     WHERE id = rec.shell_id AND state = 'branco';
    IF NOT FOUND THEN
      UPDATE public.shells SET quantity = quantity + 1 WHERE id = rec.shell_id;
    END IF;
    INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
      VALUES ('shell', rec.shell_id, 1, 'Recuperado de cancelamento [branco] - enc ' || o.order_number);
  END IF;

  IF (prev->>'cover_to_return_to_stock')::boolean THEN
    -- Procurar capa 'pronta' que case com a encomenda
    DECLARE cv public.covers;
    BEGIN
      cv := public.find_matching_cover_state(_order_id, 'pronta');
      IF cv.id IS NOT NULL THEN
        UPDATE public.covers SET quantity = quantity + 1 WHERE id = cv.id;
        INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
          VALUES ('cover', cv.id, 1, 'Recuperado de cancelamento [pronta] - enc ' || o.order_number);
      ELSE
        INSERT INTO public.covers(code, name, model_code, structure_code, measure_code,
                                  fabric_type_code, fabric_ref_code, color_code, quantity, state)
        VALUES ('AUTO-' || substring(o.order_number,1,16),
                'Capa recuperada ' || o.order_number,
                (SELECT code FROM public.models WHERE id = o.model_id),
                o.structure_type, o.measure, o.fabric_type, o.fabric_ref, o.color, 1, 'pronta')
        RETURNING id INTO new_cover_id;
        INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
          VALUES ('cover', new_cover_id, 1, 'Capa criada de cancelamento [pronta] - enc ' || o.order_number);
      END IF;
    END;
  END IF;

  UPDATE public.order_stages
     SET status = 'bloqueada', notes = COALESCE(notes,'') || ' [Cancelada]'
   WHERE order_id = _order_id AND status <> 'concluida';

  UPDATE public.production_orders SET status = 'cancelada' WHERE id = _order_id;

  RETURN prev;
END;
$function$;

-- 6) Backfill best-effort para encomendas em curso
DO $$
DECLARE
  r RECORD;
  v_state text; v_code text; v_sh_id uuid; v_cv_id uuid;
  v_notes_estr text; v_notes_corte text; v_notes_costura text; v_notes text;
  rec public.product_recipe;
BEGIN
  FOR r IN
    SELECT po.id, po.order_number
      FROM public.production_orders po
     WHERE po.status NOT IN ('cancelada','concluida')
       AND (po.reserved_shell_id IS NULL OR po.reserved_cover_id IS NULL)
  LOOP
    rec := public.resolve_order_recipe(r.id);

    -- Shell
    SELECT notes INTO v_notes_estr FROM public.order_stages
     WHERE order_id = r.id AND stage = 'estrutura' AND notes LIKE 'Concluída de stock%';
    IF v_notes_estr IS NOT NULL AND rec.shell_id IS NOT NULL THEN
      IF v_notes_estr ~ 'casco branco ' THEN
        v_state := 'branco';
        v_code := substring(v_notes_estr from 'casco branco ([^)]+)\)');
      ELSE
        v_state := 'casco';
        v_code := substring(v_notes_estr from 'casco (?!branco )([^)]+)\)');
      END IF;
      SELECT id INTO v_sh_id FROM public.shells
       WHERE id = rec.shell_id AND state = v_state
         AND (v_code IS NULL OR code = v_code)
       LIMIT 1;
      IF v_sh_id IS NOT NULL THEN
        UPDATE public.production_orders
           SET reserved_shell_id = v_sh_id, reserved_shell_state = v_state
         WHERE id = r.id AND reserved_shell_id IS NULL;
      END IF;
    END IF;

    -- Cover
    SELECT notes INTO v_notes_corte   FROM public.order_stages WHERE order_id = r.id AND stage = 'corte';
    SELECT notes INTO v_notes_costura FROM public.order_stages WHERE order_id = r.id AND stage = 'costura';
    v_notes := COALESCE(
      CASE WHEN v_notes_corte   LIKE 'Concluída de stock%' THEN v_notes_corte   END,
      CASE WHEN v_notes_costura LIKE 'Concluída de stock%' THEN v_notes_costura END
    );
    IF v_notes IS NOT NULL THEN
      IF v_notes ~ 'capa pronta ' THEN
        v_state := 'pronta';
        v_code := substring(v_notes from 'capa pronta ([^)]+)\)');
      ELSIF v_notes ~ 'capa cortada ' THEN
        v_state := 'cortada';
        v_code := substring(v_notes from 'capa cortada ([^)]+)\)');
      ELSE
        v_code := NULL;
      END IF;
      IF v_code IS NOT NULL THEN
        SELECT id INTO v_cv_id FROM public.covers
         WHERE code = v_code AND state = v_state LIMIT 1;
        IF v_cv_id IS NOT NULL THEN
          UPDATE public.production_orders
             SET reserved_cover_id = v_cv_id, reserved_cover_state = v_state
           WHERE id = r.id AND reserved_cover_id IS NULL;
        END IF;
      END IF;
    END IF;
  END LOOP;
END $$;
