-- Etapa 02: autorização no ponto de escrita

CREATE OR REPLACE FUNCTION public.assert_picking_actor(_op public.operators)
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN; -- contexto de serviço
  END IF;
  IF NOT (
    public.has_role(auth.uid(), 'picador')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'escritorio')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para picar volumes';
  END IF;
  PERFORM public.assert_operator_is_session(_op);
END;
$$;

REVOKE ALL ON FUNCTION public.assert_picking_actor(public.operators) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_picking_actor(public.operators) TO service_role;

-- 1) Picagem: exigir perfil e identidade da sessão
DO $$
DECLARE v_src text; v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='scan_picking_coli';

  IF v_src IS NULL THEN RAISE EXCEPTION 'scan_picking_coli não encontrada'; END IF;

  IF position('assert_picking_actor' in v_src) = 0 THEN
    v_new := replace(
      v_src,
      'IF NOT v_linked THEN
    RAISE EXCEPTION ''O operador % não está atribuído à etapa de Picagem'', v_op.code;
  END IF;',
      'IF NOT v_linked THEN
    RAISE EXCEPTION ''O operador % não está atribuído à etapa de Picagem'', v_op.code;
  END IF;

  PERFORM public.assert_picking_actor(v_op);'
    );
    IF v_new = v_src THEN
      RAISE EXCEPTION 'Não foi possível inserir a validação em scan_picking_coli (texto não encontrado)';
    END IF;
    EXECUTE v_new;
  END IF;
END $$;

-- 2) Lotes de cascos: identidade da sessão
DO $$
DECLARE v_src text; v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='start_shell_batch';

  IF v_src IS NULL THEN RAISE EXCEPTION 'start_shell_batch não encontrada'; END IF;

  IF position('assert_operator_is_session' in v_src) = 0 THEN
    v_new := replace(
      v_src,
      'IF NOT v_linked THEN
    RAISE EXCEPTION ''O operador % não está atribuído às etapas de estrutura/branco'', v_op.code;
  END IF;',
      'IF NOT v_linked THEN
    RAISE EXCEPTION ''O operador % não está atribuído às etapas de estrutura/branco'', v_op.code;
  END IF;

  PERFORM public.assert_operator_is_session(v_op);'
    );
    IF v_new = v_src THEN
      RAISE EXCEPTION 'Não foi possível inserir a validação em start_shell_batch (texto não encontrado)';
    END IF;
    EXECUTE v_new;
  END IF;
END $$;

-- 3) Reparação de volumes: apenas administração/escritório
CREATE OR REPLACE FUNCTION public.repair_missing_coli_stages()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c RECORD;
  v_keys RECORD;
  v_route_id uuid;
  v_inserted int;
  v_fixed int := 0;
  v_stages public.production_stage[] := ARRAY[
    'estrutura','corte','costura','branco','estofagem','qualidade','embalagem','picagem'
  ]::public.production_stage[];
  st public.production_stage;
BEGIN
  PERFORM public.assert_office_or_admin('reparar volumes em falta');

  FOR c IN
    SELECT oc.id, oc.order_id, oc.coli_number
      FROM public.order_colis oc
     WHERE NOT EXISTS (
       SELECT 1 FROM public.order_coli_stages s WHERE s.order_coli_id = oc.id
     )
  LOOP
    SELECT category_code, structure_code INTO v_keys
      FROM public.get_order_route_keys(c.order_id);

    SELECT id INTO v_route_id
      FROM public.structure_coli_routes
     WHERE category_code = v_keys.category_code
       AND structure_code = v_keys.structure_code
       AND coli_number = c.coli_number
     LIMIT 1;

    v_inserted := 0;
    IF v_route_id IS NOT NULL THEN
      INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage)
      SELECT c.id, c.order_id, scs.stage
        FROM public.structure_coli_stages scs
       WHERE scs.route_id = v_route_id AND scs.included = true
      ON CONFLICT (order_coli_id, stage) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
    END IF;

    IF v_inserted = 0 THEN
      FOREACH st IN ARRAY v_stages LOOP
        INSERT INTO public.order_coli_stages(order_coli_id, order_id, stage)
        VALUES (c.id, c.order_id, st)
        ON CONFLICT (order_coli_id, stage) DO NOTHING;
      END LOOP;
    END IF;

    v_fixed := v_fixed + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'colis_reparados', v_fixed);
END;
$function$;

-- 4) Rotinas internas: retirar execução direta de utilizadores autenticados
REVOKE EXECUTE ON FUNCTION public.create_order_colis(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_order_stage_from_colis(uuid, public.production_stage) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.try_reserve_for_order(uuid) FROM authenticated;
