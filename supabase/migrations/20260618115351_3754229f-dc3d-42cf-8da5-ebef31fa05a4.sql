
-- 1) States
ALTER TABLE public.shells
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'branco'
  CHECK (state IN ('casco','branco'));

ALTER TABLE public.covers
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'pronta'
  CHECK (state IN ('cortada','pronta'));

-- 2) Convergência: estofagem espera por BRANCO (não estrutura) + COSTURA
CREATE OR REPLACE FUNCTION public.order_stages_before_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_branco_ok BOOLEAN;
  v_costura_ok BOOLEAN;
BEGIN
  NEW.updated_at = now();

  -- Convergência: Estofagem só arranca quando Branco E Costura estão concluídos
  -- (ou foram saltados de stock, que também ficam com status='concluida').
  IF NEW.stage = 'estofagem' AND NEW.status = 'em_curso' AND OLD.status <> 'em_curso' THEN
    SELECT (status='concluida' AND check_valid) INTO v_branco_ok
      FROM public.order_stages WHERE order_id = NEW.order_id AND stage = 'branco';
    SELECT (status='concluida' AND check_valid) INTO v_costura_ok
      FROM public.order_stages WHERE order_id = NEW.order_id AND stage = 'costura';
    IF NOT COALESCE(v_branco_ok,false) OR NOT COALESCE(v_costura_ok,false) THEN
      NEW.status = 'bloqueada';
      RAISE NOTICE 'Estofagem bloqueada: branco/costura pendentes';
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

-- 3) find_matching_cover passa a aceitar filtro de estado mínimo
CREATE OR REPLACE FUNCTION public.find_matching_cover_state(_order_id uuid, _state text)
 RETURNS covers
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  o RECORD;
  m_code text; s_code text; z_code text; ft_code text; fr_code text; cl_code text;
  cv public.covers;
BEGIN
  SELECT po.*, mo.code AS model_code
    INTO o
  FROM public.production_orders po
  LEFT JOIN public.models mo ON mo.id = po.model_id
  WHERE po.id = _order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  m_code := o.model_code;
  SELECT code INTO s_code FROM public.ref_structures WHERE code = o.structure_type OR name = o.structure_type LIMIT 1;
  IF s_code IS NULL THEN s_code := o.structure_type; END IF;
  SELECT code INTO z_code FROM public.ref_measures WHERE code = o.measure OR name = o.measure LIMIT 1;
  IF z_code IS NULL THEN z_code := o.measure; END IF;
  SELECT code INTO ft_code FROM public.ref_fabric_types WHERE code = o.fabric_type OR name = o.fabric_type LIMIT 1;
  IF ft_code IS NULL THEN ft_code := o.fabric_type; END IF;
  SELECT code INTO fr_code FROM public.ref_fabric_refs WHERE code = o.fabric_ref OR name = o.fabric_ref LIMIT 1;
  IF fr_code IS NULL THEN fr_code := o.fabric_ref; END IF;
  SELECT code INTO cl_code FROM public.ref_colors WHERE code = o.color OR name = o.color LIMIT 1;
  IF cl_code IS NULL THEN cl_code := o.color; END IF;

  SELECT * INTO cv FROM public.covers c
   WHERE COALESCE(c.model_code,'') = COALESCE(m_code,'')
     AND COALESCE(c.structure_code,'') = COALESCE(s_code,'')
     AND COALESCE(c.measure_code,'') = COALESCE(z_code,'')
     AND COALESCE(c.fabric_type_code,'') = COALESCE(ft_code,'')
     AND COALESCE(c.fabric_ref_code,'') = COALESCE(fr_code,'')
     AND COALESCE(c.color_code,'') = COALESCE(cl_code,'')
     AND c.state = _state
     AND (c.quantity - COALESCE(c.reserved,0)) >= 1
   ORDER BY c.quantity - COALESCE(c.reserved,0) DESC
   LIMIT 1;
  RETURN cv;
END;
$function$;

-- 4) Reservar respeitando estados; preferir o mais avançado.
--    - Casco em estado 'branco'  → salta Estrutura+Branco
--    - Casco em estado 'casco'   → salta só Estrutura
--    - Capa  em estado 'pronta'  → salta Corte+Costura
--    - Capa  em estado 'cortada' → salta só Corte
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

  -- Idempotência
  IF EXISTS (
    SELECT 1 FROM public.order_stages
     WHERE order_id = _order_id AND notes LIKE 'Concluída de stock%'
  ) THEN
    RETURN res;
  END IF;

  rec := public.resolve_order_recipe(_order_id);
  IF rec.id IS NULL THEN RETURN res; END IF;

  -- CASCO: preferir 'branco' (mais avançado); se não houver, tentar 'casco'.
  IF rec.shell_id IS NOT NULL THEN
    SELECT * INTO sh FROM public.shells
      WHERE id = rec.shell_id AND state = 'branco' FOR UPDATE;
    IF FOUND AND (sh.quantity - COALESCE(sh.reserved,0)) >= 1 THEN
      UPDATE public.shells SET reserved = COALESCE(reserved,0) + 1 WHERE id = sh.id;
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
        INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
          VALUES ('shell', sh.id, 0, 'Reservado (casco) para encomenda ' || o.order_number);
        -- Salta só Estrutura; Branco continua a ser feito.
        UPDATE public.order_stages
           SET status = 'concluida', finished_at = now(), check_valid = true,
               notes = 'Concluída de stock (casco ' || sh.code || ')'
         WHERE order_id = _order_id AND stage = 'estrutura';
        res := jsonb_set(res, '{shell}', to_jsonb(sh.code || ' [casco]'));
      END IF;
    END IF;
  END IF;

  -- CAPA: preferir 'pronta'; se não houver, tentar 'cortada'.
  IF COALESCE(rec.cover_required, true) THEN
    cv := public.find_matching_cover_state(_order_id, 'pronta');
    IF cv.id IS NOT NULL THEN
      UPDATE public.covers SET reserved = COALESCE(reserved,0) + 1 WHERE id = cv.id;
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
        INSERT INTO public.stock_movements(item_type, item_id, delta, reason)
          VALUES ('cover', cv.id, 0, 'Reservado (cortada) para encomenda ' || o.order_number);
        -- Salta só Corte; Costura continua a ser feita.
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

-- 5) Manter find_matching_cover original (sem state) para consumo na estofagem.
--    Já existe; sem alterações.
