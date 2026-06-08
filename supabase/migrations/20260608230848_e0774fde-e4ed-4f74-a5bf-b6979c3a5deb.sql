
-- Enums
CREATE TYPE public.production_stage AS ENUM ('estrutura','corte','costura','branco','estofagem','qualidade','embalagem','picagem');
CREATE TYPE public.order_status AS ENUM ('pendente','em_producao','concluida','cancelada');
CREATE TYPE public.stage_status AS ENUM ('pendente','em_curso','concluida','bloqueada');
CREATE TYPE public.app_role AS ENUM ('admin','operador','escritorio');

-- user_roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "users see own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admins manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- operators
CREATE TABLE public.operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operators TO authenticated;
GRANT ALL ON public.operators TO service_role;
ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read operators" ON public.operators FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage operators" ON public.operators FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- models
CREATE TABLE public.models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.models TO authenticated;
GRANT ALL ON public.models TO service_role;
ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read models" ON public.models FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage models" ON public.models FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- production_orders
CREATE TABLE public.production_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE,
  barcode TEXT UNIQUE,
  product_description TEXT NOT NULL,
  model_id UUID REFERENCES public.models(id),
  measure TEXT,
  fabric_type TEXT,
  fabric_ref TEXT,
  color TEXT,
  structure_type TEXT,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  status public.order_status NOT NULL DEFAULT 'pendente',
  priority INT NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_orders TO authenticated;
GRANT ALL ON public.production_orders TO service_role;
ALTER TABLE public.production_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read orders" ON public.production_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "operator/escritorio insert orders" ON public.production_orders FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'operador') OR public.has_role(auth.uid(),'escritorio') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "operator/escritorio update orders" ON public.production_orders FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'operador') OR public.has_role(auth.uid(),'escritorio') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin delete orders" ON public.production_orders FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- order_stages
CREATE TABLE public.order_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  stage public.production_stage NOT NULL,
  status public.stage_status NOT NULL DEFAULT 'pendente',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  operator_id UUID REFERENCES public.operators(id),
  duration_minutes INT,
  check_valid BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id, stage)
);
CREATE INDEX idx_order_stages_order ON public.order_stages(order_id);
CREATE INDEX idx_order_stages_stage_status ON public.order_stages(stage, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_stages TO authenticated;
GRANT ALL ON public.order_stages TO service_role;
ALTER TABLE public.order_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read stages" ON public.order_stages FOR SELECT TO authenticated USING (true);
CREATE POLICY "operator/escritorio write stages" ON public.order_stages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'operador') OR public.has_role(auth.uid(),'escritorio') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'operador') OR public.has_role(auth.uid(),'escritorio') OR public.has_role(auth.uid(),'admin'));

-- semi_finished_stock
CREATE TABLE public.semi_finished_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage public.production_stage NOT NULL,
  model_id UUID REFERENCES public.models(id),
  description TEXT,
  quantity INT NOT NULL DEFAULT 0,
  min_quantity INT NOT NULL DEFAULT 0,
  location TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.semi_finished_stock TO authenticated;
GRANT ALL ON public.semi_finished_stock TO service_role;
ALTER TABLE public.semi_finished_stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read stock" ON public.semi_finished_stock FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage stock" ON public.semi_finished_stock FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Trigger: create default stages on order insert
CREATE OR REPLACE FUNCTION public.create_default_stages()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.order_stages (order_id, stage)
  SELECT NEW.id, s::public.production_stage
  FROM unnest(ARRAY['estrutura','corte','costura','branco','estofagem','qualidade','embalagem','picagem']) AS s;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_create_default_stages
  AFTER INSERT ON public.production_orders
  FOR EACH ROW EXECUTE FUNCTION public.create_default_stages();

-- Trigger: calc duration + enforce estofagem flow + touch updated_at
CREATE OR REPLACE FUNCTION public.order_stages_before_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_estrut_ok BOOLEAN;
  v_costura_ok BOOLEAN;
BEGIN
  NEW.updated_at = now();

  -- Estofagem dependency check
  IF NEW.stage = 'estofagem' AND NEW.status = 'em_curso' AND OLD.status <> 'em_curso' THEN
    SELECT (status='concluida' AND check_valid) INTO v_estrut_ok
      FROM public.order_stages WHERE order_id = NEW.order_id AND stage = 'estrutura';
    SELECT (status='concluida' AND check_valid) INTO v_costura_ok
      FROM public.order_stages WHERE order_id = NEW.order_id AND stage = 'costura';
    IF NOT COALESCE(v_estrut_ok,false) OR NOT COALESCE(v_costura_ok,false) THEN
      NEW.status = 'bloqueada';
      RAISE NOTICE 'Estofagem bloqueada: estrutura/costura pendentes';
    END IF;
  END IF;

  -- Set started_at automatically
  IF NEW.status = 'em_curso' AND OLD.status <> 'em_curso' AND NEW.started_at IS NULL THEN
    NEW.started_at = now();
  END IF;

  -- Calc duration on completion
  IF NEW.status = 'concluida' AND OLD.status <> 'concluida' THEN
    IF NEW.finished_at IS NULL THEN NEW.finished_at = now(); END IF;
    IF NEW.started_at IS NOT NULL THEN
      NEW.duration_minutes = CEIL(EXTRACT(EPOCH FROM (NEW.finished_at - NEW.started_at))/60.0)::INT;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_order_stages_before_update
  BEFORE UPDATE ON public.order_stages
  FOR EACH ROW EXECUTE FUNCTION public.order_stages_before_update();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.production_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_stages;
