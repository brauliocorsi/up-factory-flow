-- 1. Flag de veio no tipo de tecido
ALTER TABLE public.ref_fabric_types
  ADD COLUMN IF NOT EXISTS directional boolean NOT NULL DEFAULT false;

-- 2. Função de agrupamento para Corte e Estrutura.
--    Agrupamento APENAS visual (Opção A) — não persiste entidade de lote.
--    TODO: se no futuro se quiser rastreabilidade de lote, adicionar batch_ref em order_stages.
CREATE OR REPLACE FUNCTION public.get_stage_groups(_stage public.production_stage)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF _stage NOT IN ('corte','estrutura') THEN
    RAISE EXCEPTION 'Agrupamento só suportado para corte e estrutura';
  END IF;

  IF _stage = 'corte' THEN
    SELECT COALESCE(jsonb_agg(g ORDER BY (g->>'total_pieces')::int DESC), '[]'::jsonb)
      INTO v_result
    FROM (
      SELECT jsonb_build_object(
        'key', concat_ws('|',
                 COALESCE(m.code,''),
                 COALESCE(po.measure,''),
                 COALESCE(po.fabric_type,'')),
        'stage', 'corte',
        'model_code', m.code,
        'model_name', m.name,
        'measure', po.measure,
        'fabric_type', po.fabric_type,
        'directional', COALESCE(ft.directional, false),
        'total_pieces', COUNT(*)::int,
        'client_count', COUNT(*) FILTER (WHERE NOT COALESCE(po.is_stock_production,false))::int,
        'stock_count',  COUNT(*) FILTER (WHERE COALESCE(po.is_stock_production,false))::int,
        'items', jsonb_agg(jsonb_build_object(
                   'order_stage_id', os.id,
                   'order_id', po.id,
                   'order_number', po.order_number,
                   'product_description', po.product_description,
                   'color', po.color,
                   'fabric_ref', po.fabric_ref,
                   'is_stock_production', COALESCE(po.is_stock_production, false),
                   'status', os.status
                 ) ORDER BY po.due_date NULLS LAST, po.order_number)
      ) AS g
      FROM public.order_stages os
      JOIN public.production_orders po ON po.id = os.order_id
      LEFT JOIN public.models m ON m.id = po.model_id
      LEFT JOIN public.ref_fabric_types ft
        ON ft.code = po.fabric_type OR ft.name = po.fabric_type
      WHERE os.stage = 'corte'
        AND os.status <> 'concluida'
        AND po.status NOT IN ('cancelada','concluida','em_armazem')
      GROUP BY m.code, m.name, po.measure, po.fabric_type, ft.directional
    ) sub;
  ELSE
    SELECT COALESCE(jsonb_agg(g ORDER BY (g->>'total_pieces')::int DESC), '[]'::jsonb)
      INTO v_result
    FROM (
      SELECT jsonb_build_object(
        'key', concat_ws('|',
                 COALESCE(po.structure_type,''),
                 COALESCE(po.measure,'')),
        'stage', 'estrutura',
        'structure_type', po.structure_type,
        'measure', po.measure,
        'total_pieces', COUNT(*)::int,
        'client_count', COUNT(*) FILTER (WHERE NOT COALESCE(po.is_stock_production,false))::int,
        'stock_count',  COUNT(*) FILTER (WHERE COALESCE(po.is_stock_production,false))::int,
        'items', jsonb_agg(jsonb_build_object(
                   'order_stage_id', os.id,
                   'order_id', po.id,
                   'order_number', po.order_number,
                   'product_description', po.product_description,
                   'model_name', (SELECT name FROM public.models WHERE id = po.model_id),
                   'is_stock_production', COALESCE(po.is_stock_production, false),
                   'status', os.status
                 ) ORDER BY po.due_date NULLS LAST, po.order_number)
      ) AS g
      FROM public.order_stages os
      JOIN public.production_orders po ON po.id = os.order_id
      WHERE os.stage = 'estrutura'
        AND os.status <> 'concluida'
        AND po.status NOT IN ('cancelada','concluida','em_armazem')
      GROUP BY po.structure_type, po.measure
    ) sub;
  END IF;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_stage_groups(public.production_stage) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_stage_groups(public.production_stage) TO authenticated, service_role;

-- 3. Conclusão em grupo. Recebe array de order_stage_ids, valida operador,
--    e para cada etapa: se já concluída → ignora; se pendente → iniciar+finalizar;
--    se em_curso → finalizar. Idempotente.
CREATE OR REPLACE FUNCTION public.finalize_stage_group(
  _order_stage_ids uuid[],
  _operator_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op public.operators;
  v_stage_id uuid;
  v_stage public.order_stages;
  v_processed int := 0;
  v_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  IF _order_stage_ids IS NULL OR array_length(_order_stage_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Lista vazia';
  END IF;

  SELECT * INTO v_op FROM public.operators WHERE code = _operator_code AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operador "%" não encontrado ou inativo', _operator_code;
  END IF;

  FOREACH v_stage_id IN ARRAY _order_stage_ids LOOP
    BEGIN
      SELECT * INTO v_stage FROM public.order_stages WHERE id = v_stage_id;
      IF NOT FOUND THEN
        v_errors := v_errors || jsonb_build_object('id', v_stage_id, 'error', 'Etapa não encontrada');
        CONTINUE;
      END IF;

      IF v_stage.status = 'concluida' THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      IF v_stage.status = 'bloqueada' THEN
        v_errors := v_errors || jsonb_build_object('id', v_stage_id, 'error', 'Etapa bloqueada');
        CONTINUE;
      END IF;

      -- Iniciar se ainda não iniciada
      IF v_stage.started_at IS NULL THEN
        PERFORM public.record_stage_event(v_stage_id, _operator_code, 'iniciar');
      ELSIF v_stage.is_paused THEN
        PERFORM public.record_stage_event(v_stage_id, _operator_code, 'retomar');
      END IF;

      -- Finalizar
      PERFORM public.record_stage_event(v_stage_id, _operator_code, 'finalizar');
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('id', v_stage_id, 'error', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'processed', v_processed,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finalize_stage_group(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_stage_group(uuid[], text) TO authenticated, service_role;
