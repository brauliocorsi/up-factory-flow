import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Agrupamento visual (Opção A) para as etapas Corte e Estrutura.
 * NÃO persiste entidade de "lote" — as encomendas continuam independentes,
 * apenas são apresentadas/concluídas em conjunto quando partilham a chave.
 *
 * TODO: se no futuro for necessária rastreabilidade real de lote,
 * adicionar uma coluna `batch_ref` em order_stages e gravar aqui um uuid
 * partilhado quando o operador conclui um grupo.
 */

export type StageGroupItem = {
  order_stage_id: string;
  order_id: string;
  order_number: string;
  product_description: string;
  color?: string | null;
  fabric_ref?: string | null;
  model_name?: string | null;
  is_stock_production: boolean;
  status: string;
};

export type StageGroup = {
  key: string;
  stage: "corte" | "estrutura";
  model_code?: string | null;
  model_name?: string | null;
  measure?: string | null;
  fabric_type?: string | null;
  structure_type?: string | null;
  directional?: boolean;
  total_pieces: number;
  client_count: number;
  stock_count: number;
  items: StageGroupItem[];
};

export const getStageGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ stage: z.enum(["corte", "estrutura"]) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<StageGroup[]> => {
    const { data: res, error } = await (context.supabase as any).rpc(
      "get_stage_groups",
      { _stage: data.stage },
    );
    if (error) throw new Error(error.message);
    return (res ?? []) as StageGroup[];
  });

export const finalizeStageGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        order_stage_ids: z.array(z.string().uuid()).min(1),
        operator_code: z.string().trim().min(1).max(32),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc(
      "finalize_stage_group",
      {
        _order_stage_ids: data.order_stage_ids,
        _operator_code: data.operator_code,
      },
    );
    if (error) throw new Error(error.message);
    return res as {
      ok: boolean;
      processed: number;
      skipped: number;
      errors: Array<{ id: string; error: string }>;
    };
  });