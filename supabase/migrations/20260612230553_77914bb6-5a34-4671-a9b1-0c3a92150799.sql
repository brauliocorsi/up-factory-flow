
-- =============================================================
-- PART 1: COLIS FOUNDATION
-- Tables only. No UI/production logic changes.
-- =============================================================

-- ---------- structure_coli_routes ----------
CREATE TABLE public.structure_coli_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code text NOT NULL,
  structure_code text NOT NULL,
  coli_number int NOT NULL,
  coli_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(category_code, structure_code, coli_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.structure_coli_routes TO authenticated;
GRANT ALL ON public.structure_coli_routes TO service_role;
ALTER TABLE public.structure_coli_routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read routes auth" ON public.structure_coli_routes FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage routes" ON public.structure_coli_routes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_scr_updated BEFORE UPDATE ON public.structure_coli_routes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- structure_coli_stages ----------
CREATE TABLE public.structure_coli_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES public.structure_coli_routes(id) ON DELETE CASCADE,
  stage public.production_stage NOT NULL,
  included boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  UNIQUE(route_id, stage)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.structure_coli_stages TO authenticated;
GRANT ALL ON public.structure_coli_stages TO service_role;
ALTER TABLE public.structure_coli_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read coli stages auth" ON public.structure_coli_stages FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage coli stages" ON public.structure_coli_stages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------- order_colis ----------
CREATE TABLE public.order_colis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  coli_number int NOT NULL,
  coli_name text NOT NULL,
  coli_barcode text,
  status text NOT NULL DEFAULT 'pendente',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id, coli_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_colis TO authenticated;
GRANT ALL ON public.order_colis TO service_role;
ALTER TABLE public.order_colis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read order_colis" ON public.order_colis FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write order_colis" ON public.order_colis FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_order_colis_order ON public.order_colis(order_id);

-- ---------- order_coli_stages ----------
CREATE TABLE public.order_coli_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_coli_id uuid NOT NULL REFERENCES public.order_colis(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  stage public.production_stage NOT NULL,
  status public.stage_status NOT NULL DEFAULT 'pendente',
  started_at timestamptz,
  finished_at timestamptz,
  operator_id uuid REFERENCES public.operators(id),
  productive_seconds int NOT NULL DEFAULT 0,
  paused_seconds int NOT NULL DEFAULT 0,
  is_paused boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_coli_id, stage)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_coli_stages TO authenticated;
GRANT ALL ON public.order_coli_stages TO service_role;
ALTER TABLE public.order_coli_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read order_coli_stages" ON public.order_coli_stages FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write order_coli_stages" ON public.order_coli_stages FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_order_coli_stages_order ON public.order_coli_stages(order_id);
CREATE INDEX idx_order_coli_stages_coli ON public.order_coli_stages(order_coli_id);

-- =============================================================
-- Function: derive (category_code, structure_code) for an order
-- Uses real columns (model.category + order.structure_type).
-- =============================================================
CREATE OR REPLACE FUNCTION public.get_order_route_keys(_order_id uuid)
RETURNS TABLE(category_code text, structure_code text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cat text;
  v_struct text;
BEGIN
  SELECT c.code, COALESCE(s.code, po.structure_type)
    INTO v_cat, v_struct
  FROM public.production_orders po
  LEFT JOIN public.models m ON m.id = po.model_id
  LEFT JOIN public.ref_categories c ON c.id = m.category_id
  LEFT JOIN public.ref_structures s
         ON s.code = po.structure_type OR s.name = po.structure_type
  WHERE po.id = _order_id;
  category_code := v_cat;
  structure_code := v_struct;
  RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_order_route_keys(uuid) TO authenticated, service_role;

-- =============================================================
-- Function: create colis instances for an order (idempotent)
-- =============================================================
CREATE OR REPLACE FUNCTION public.create_order_colis(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cat text; v_struct text;
  v_barcode text;
  r RECORD;
  v_coli_id uuid;
  v_created int := 0;
  v_route_found boolean := false;
  v_stages public.production_stage[] := ARRAY[
    'estrutura','corte','costura','branco','estofagem','qualidade','embalagem','picagem'
  ]::public.production_stage[];
  st public.production_stage;
BEGIN
  -- Idempotency: skip if colis already exist
  IF EXISTS (SELECT 1 FROM public.order_colis WHERE order_id = _order_id) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true);
  END IF;

  SELECT barcode INTO v_barcode FROM public.production_orders WHERE id = _order_id;

  SELECT category_code, structure_code INTO v_cat, v_struct
    FROM public.get_order_route_keys(_order_id);

  -- Try to find a route
  FOR r IN
    SELECT id, coli_number, coli_name
      FROM public.structure_coli_routes
     WHERE category_code = v_cat AND structure_code = v_struct
     ORDER BY coli_number
  LOOP
    v_route_found := true;
    INSERT INTO public.order_colis(order_id, coli_number, coli_name, coli_barcode)
    VALUES (_order_id, r.coli_number, r.coli_name,
            CASE WHEN v_barcode IS NOT NULL THEN v_barcode || '-C' || r.coli_number ELSE NULL END)
    RETURNING id INTO v_coli_id;

    INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage)
    SELECT v_coli_id, _order_id, scs.stage
      FROM public.structure_coli_stages scs
     WHERE scs.route_id = r.id AND scs.included = true;

    v_created := v_created + 1;
  END LOOP;

  -- Fallback: single coli "Produto completo" with all stages
  IF NOT v_route_found THEN
    INSERT INTO public.order_colis(order_id, coli_number, coli_name, coli_barcode)
    VALUES (_order_id, 1, 'Produto completo',
            CASE WHEN v_barcode IS NOT NULL THEN v_barcode || '-C1' ELSE NULL END)
    RETURNING id INTO v_coli_id;
    FOREACH st IN ARRAY v_stages LOOP
      INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage)
      VALUES (v_coli_id, _order_id, st);
    END LOOP;
    v_created := 1;
  END IF;

  RETURN jsonb_build_object('ok', true, 'created', v_created, 'route_found', v_route_found);
EXCEPTION WHEN OTHERS THEN
  -- Defensive: never break order creation
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_order_colis(uuid) TO authenticated, service_role;

-- Trigger on production_orders insert
CREATE OR REPLACE FUNCTION public.production_orders_after_insert_colis()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.create_order_colis(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- never break inserts
END;
$$;

DROP TRIGGER IF EXISTS trg_po_create_colis ON public.production_orders;
CREATE TRIGGER trg_po_create_colis
  AFTER INSERT ON public.production_orders
  FOR EACH ROW EXECUTE FUNCTION public.production_orders_after_insert_colis();

-- =============================================================
-- Seed examples (only for real existing structures: 01, 03)
-- =============================================================
DO $$
DECLARE
  v_route_id uuid;
  v_all public.production_stage[] := ARRAY[
    'estrutura','corte','costura','branco','estofagem','qualidade','embalagem','picagem'
  ]::public.production_stage[];
  st public.production_stage;
BEGIN
  -- CAM 01 Simples: Cabeceira + Box
  INSERT INTO public.structure_coli_routes(category_code, structure_code, coli_number, coli_name)
  VALUES ('CAM','01',1,'Cabeceira') RETURNING id INTO v_route_id;
  FOREACH st IN ARRAY v_all LOOP
    INSERT INTO public.structure_coli_stages(route_id, stage, included) VALUES (v_route_id, st, true);
  END LOOP;

  INSERT INTO public.structure_coli_routes(category_code, structure_code, coli_number, coli_name)
  VALUES ('CAM','01',2,'Box / Ilhargas + Peseira') RETURNING id INTO v_route_id;
  FOREACH st IN ARRAY v_all LOOP
    INSERT INTO public.structure_coli_stages(route_id, stage, included) VALUES (v_route_id, st, true);
  END LOOP;

  -- CAM 03 Alongada: Cabeceira + Box
  INSERT INTO public.structure_coli_routes(category_code, structure_code, coli_number, coli_name)
  VALUES ('CAM','03',1,'Cabeceira') RETURNING id INTO v_route_id;
  FOREACH st IN ARRAY v_all LOOP
    INSERT INTO public.structure_coli_stages(route_id, stage, included) VALUES (v_route_id, st, true);
  END LOOP;

  INSERT INTO public.structure_coli_routes(category_code, structure_code, coli_number, coli_name)
  VALUES ('CAM','03',2,'Box / Ilhargas + Peseira') RETURNING id INTO v_route_id;
  FOREACH st IN ARRAY v_all LOOP
    INSERT INTO public.structure_coli_stages(route_id, stage, included) VALUES (v_route_id, st, true);
  END LOOP;
END $$;
