
-- Camada C: fechar leitura RLS das tabelas sensíveis aos operadores.
-- Apenas admin + escritorio podem ler. Triggers/RPCs SECURITY DEFINER continuam a funcionar.

-- product_recipe
DROP POLICY IF EXISTS "authenticated read product_recipe" ON public.product_recipe;
CREATE POLICY "admin/escritorio read product_recipe"
  ON public.product_recipe FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));

-- shells
DROP POLICY IF EXISTS "authenticated read shells" ON public.shells;
CREATE POLICY "admin/escritorio read shells"
  ON public.shells FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));

-- covers
DROP POLICY IF EXISTS "authenticated read covers" ON public.covers;
CREATE POLICY "admin/escritorio read covers"
  ON public.covers FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));

-- fabric_rolls
DROP POLICY IF EXISTS "authenticated read fabric_rolls" ON public.fabric_rolls;
CREATE POLICY "admin/escritorio read fabric_rolls"
  ON public.fabric_rolls FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));

-- stock_movements
DROP POLICY IF EXISTS "authenticated read movements" ON public.stock_movements;
CREATE POLICY "admin/escritorio read movements"
  ON public.stock_movements FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));

-- finished_goods (tinha "auth read finished_goods" USING (true) e ALL "auth manage finished_goods" USING(true) — fechar ambos)
DROP POLICY IF EXISTS "auth read finished_goods" ON public.finished_goods;
DROP POLICY IF EXISTS "auth manage finished_goods" ON public.finished_goods;
CREATE POLICY "admin/escritorio read finished_goods"
  ON public.finished_goods FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));
CREATE POLICY "admin/escritorio manage finished_goods"
  ON public.finished_goods FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));

-- semi_finished_stock
DROP POLICY IF EXISTS "authenticated read stock" ON public.semi_finished_stock;
CREATE POLICY "admin/escritorio read semi_finished_stock"
  ON public.semi_finished_stock FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio'));
