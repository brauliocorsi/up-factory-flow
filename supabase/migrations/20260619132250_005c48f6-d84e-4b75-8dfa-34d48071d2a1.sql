
-- 1) Bloqueio "picador" em tabelas sensíveis (mesma lógica do is_operator_only)
CREATE OR REPLACE FUNCTION public.is_picker_only(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'picador')
     AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin');
$$;

REVOKE EXECUTE ON FUNCTION public.is_picker_only(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_picker_only(uuid) TO authenticated;

-- Bloquear leitura/escrita de tabelas sensíveis ao picador.
-- O picador só precisa ler production_orders, order_stages, order_colis,
-- order_coli_stages, operators, models, refs — por isso "models" e "refs"
-- NÃO entram aqui (diferente do operador de fábrica).
DO $$
DECLARE
  t text;
  blocked text[] := ARRAY[
    'app_settings',
    'covers','shells','fabric_rolls','finished_goods','semi_finished_stock','stock_movements',
    'shell_batch_logs','shell_batches',
    'product_recipe',
    'structure_coli_routes','structure_coli_stages',
    'quality_templates','quality_template_items',
    'stage_sla_category','stage_sla_product','stage_sla_model',
    'import_mappings'
  ];
BEGIN
  FOREACH t IN ARRAY blocked LOOP
    EXECUTE format('DROP POLICY IF EXISTS "block_pickers" ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY "block_pickers" ON public.%I
        AS RESTRICTIVE
        FOR ALL
        TO authenticated
        USING (NOT public.is_picker_only(auth.uid()))
        WITH CHECK (NOT public.is_picker_only(auth.uid()))
    $f$, t);
  END LOOP;
END $$;

-- 2) Consulta segura de estado/etapas de qualquer encomenda (Camada C)
-- Devolve apenas dados técnicos: número, descrição, status, lista de etapas.
-- Nunca expõe receita, stock, custos.
CREATE OR REPLACE FUNCTION public.get_order_progress(_order_number text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_stages jsonb;
  v_current jsonb;
BEGIN
  SELECT id, order_number, product_description, status, structure_type, measure, color
    INTO v_order
  FROM public.production_orders
  WHERE order_number = _order_number
  LIMIT 1;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Encomenda % não encontrada', _order_number USING ERRCODE = 'P0002';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'stage', s.stage,
    'status', s.status,
    'started_at', s.started_at,
    'finished_at', s.finished_at,
    'order_idx', public.stage_order_index(s.stage)
  ) ORDER BY public.stage_order_index(s.stage))
  INTO v_stages
  FROM public.order_stages s
  WHERE s.order_id = v_order.id;

  SELECT jsonb_build_object('stage', s.stage, 'status', s.status)
  INTO v_current
  FROM public.order_stages s
  WHERE s.order_id = v_order.id
    AND s.status IN ('em_curso','pausada')
  ORDER BY public.stage_order_index(s.stage)
  LIMIT 1;

  IF v_current IS NULL THEN
    SELECT jsonb_build_object('stage', s.stage, 'status', s.status)
    INTO v_current
    FROM public.order_stages s
    WHERE s.order_id = v_order.id
      AND s.status = 'pendente'
    ORDER BY public.stage_order_index(s.stage)
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'order_number', v_order.order_number,
    'product_description', v_order.product_description,
    'structure_type', v_order.structure_type,
    'measure', v_order.measure,
    'color', v_order.color,
    'status', v_order.status,
    'current_stage', v_current,
    'stages', COALESCE(v_stages, '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_order_progress(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_progress(text) TO authenticated;

-- 3) Histórico do picador: encomendas que ESTE picador pôs em armazém.
-- Junta-se via stage_time_logs (event='finalizar' na etapa 'picagem') ao operador.
CREATE OR REPLACE FUNCTION public.list_my_picked_orders(_limit int DEFAULT 100)
RETURNS TABLE (
  order_id uuid,
  order_number text,
  product_description text,
  structure_type text,
  measure text,
  color text,
  finished_at timestamptz,
  coli_count int,
  operator_code text,
  operator_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_op_id uuid;
BEGIN
  v_is_admin := public.has_role(auth.uid(), 'admin');

  IF NOT v_is_admin THEN
    SELECT id INTO v_op_id FROM public.operators WHERE user_id = auth.uid() LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT
    po.id AS order_id,
    po.order_number,
    po.product_description,
    po.structure_type,
    po.measure,
    po.color,
    os.finished_at,
    (SELECT count(*)::int FROM public.order_colis oc WHERE oc.order_id = po.id),
    op.code,
    op.name
  FROM public.order_stages os
  JOIN public.production_orders po ON po.id = os.order_id
  LEFT JOIN public.operators op ON op.id = os.operator_id
  WHERE os.stage = 'picagem'
    AND os.status = 'concluida'
    AND (v_is_admin OR os.operator_id = v_op_id)
  ORDER BY os.finished_at DESC NULLS LAST
  LIMIT _limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_my_picked_orders(int) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_picked_orders(int) TO authenticated;
