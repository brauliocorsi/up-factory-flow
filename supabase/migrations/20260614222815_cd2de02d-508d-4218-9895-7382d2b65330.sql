
-- 1) Coluna user_id na operators
ALTER TABLE public.operators
  ADD COLUMN IF NOT EXISTS user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS operators_user_id_idx ON public.operators(user_id);

-- 2) Helper: utilizador é APENAS operador (não admin)
CREATE OR REPLACE FUNCTION public.is_operator_only(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'operador')
     AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin');
$$;

-- 3) Policies RESTRITIVAS que bloqueiam operadores em tabelas vedadas.
-- Combinam-se com AND com as policies existentes, por isso não afetam admins
-- nem utilizadores sem o papel "operador".
DO $$
DECLARE
  t text;
  blocked text[] := ARRAY[
    'app_settings',
    'covers','shells','fabric_rolls','finished_goods','semi_finished_stock','stock_movements',
    'shell_batch_logs','shell_batches',
    'models','model_packages','product_recipe',
    'ref_categories','ref_colors','ref_fabric_refs','ref_fabric_types','ref_measures','ref_structures',
    'structure_coli_routes','structure_coli_stages',
    'quality_templates','quality_template_items',
    'stage_sla_category','stage_sla_product',
    'import_mappings'
  ];
BEGIN
  FOREACH t IN ARRAY blocked LOOP
    EXECUTE format('DROP POLICY IF EXISTS "block_operators" ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY "block_operators" ON public.%I
        AS RESTRICTIVE
        FOR ALL
        TO authenticated
        USING (NOT public.is_operator_only(auth.uid()))
        WITH CHECK (NOT public.is_operator_only(auth.uid()))
    $f$, t);
  END LOOP;
END $$;
