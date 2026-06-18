
-- 1) Bloqueio de Estofagem com erro visível
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
BEGIN
  NEW.updated_at = now();

  IF NEW.stage = 'estofagem' AND NEW.status = 'em_curso' AND OLD.status <> 'em_curso' THEN
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

-- 2) Consumo correto baseado no CODE+estado da nota "Concluída de stock (...)"
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

  -- ESTOFAGEM: consome o exato casco/capa reservados
  IF NEW.stage = 'estofagem' THEN
    SELECT notes INTO v_estr_notes FROM public.order_stages
     WHERE order_id = NEW.order_id AND stage = 'estrutura';

    IF v_estr_notes LIKE 'Concluída de stock%' AND rec.shell_id IS NOT NULL THEN
      -- Padrões aceites:
      --   "Concluída de stock (casco branco CODE)" -> estado 'branco'
      --   "Concluída de stock (casco CODE)"        -> estado 'casco'
      IF v_estr_notes ~ 'casco branco ' THEN
        v_shell_state := 'branco';
        v_shell_code := substring(v_estr_notes from 'casco branco ([^)]+)\)');
      ELSE
        v_shell_state := 'casco';
        v_shell_code := substring(v_estr_notes from 'casco ([^)]+)\)');
      END IF;

      SELECT id INTO v_sh_id FROM public.shells
        WHERE id = rec.shell_id
          AND state = v_shell_state::text
          AND (v_shell_code IS NULL OR code = v_shell_code)
          AND COALESCE(reserved,0) >= 1
        ORDER BY reserved DESC NULLS LAST
        LIMIT 1
        FOR UPDATE;

      IF v_sh_id IS NULL THEN
        -- fallback defensivo: qualquer linha do mesmo shell_id+estado com reserva
        SELECT id INTO v_sh_id FROM public.shells
          WHERE id = rec.shell_id AND state = v_shell_state::text AND COALESCE(reserved,0) >= 1
          ORDER BY reserved DESC LIMIT 1 FOR UPDATE;
      END IF;

      IF v_sh_id IS NOT NULL THEN
        UPDATE public.shells
           SET quantity = GREATEST(0, quantity - 1),
               reserved = GREATEST(0, COALESCE(reserved,0) - 1)
         WHERE id = v_sh_id;
        INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
          VALUES ('shell', v_sh_id, -1,
                  'Consumido na estofagem ['||v_shell_state||'] - enc ' || o.order_number);
      END IF;
    END IF;

    -- CAPA: o salto pode estar marcado em 'corte' (pronta=salta corte+costura; cortada=salta corte)
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
          WHERE code = v_cover_code AND state = v_cover_state::text AND COALESCE(reserved,0) >= 1
          ORDER BY reserved DESC LIMIT 1 FOR UPDATE;

        IF v_cv_id IS NOT NULL THEN
          UPDATE public.covers
             SET quantity = GREATEST(0, quantity - 1),
                 reserved = GREATEST(0, COALESCE(reserved,0) - 1)
           WHERE id = v_cv_id;
          INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
            VALUES ('cover', v_cv_id, -1,
                    'Consumido na estofagem ['||v_cover_state||'] - enc ' || o.order_number);
        END IF;
      END IF;
    END IF;
  END IF;

  -- CORTE: consumo de metros do rolo (apenas produção real)
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
