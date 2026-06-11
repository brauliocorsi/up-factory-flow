import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * SLA — tempos previstos por etapa.
 * - Padrão por categoria (CAM/SOF) em `stage_sla_category`.
 * - Override por produto (modelo+estrutura+medida) em `stage_sla_product`.
 * - Resolução: produto > categoria > NULL.
 * - Reutiliza productive_seconds já medido.
 */

export const STAGES = [
  "estrutura","corte","costura","branco","estofagem","qualidade","embalagem","picagem"
] as const;
export type Stage = typeof STAGES[number];

export type CategorySla = { category_code: string; stage: Stage; expected_minutes: number };
export type ProductSla = {
  id?: string;
  category_code: string;
  model_code: string;
  structure_code: string;
  measure_code: string;
  stage: Stage;
  expected_minutes: number;
};

// ---------- Padrão por categoria ----------

export const listCategorySla = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CategorySla[]> => {
    const { data, error } = await (context.supabase as any)
      .from("stage_sla_category")
      .select("category_code, stage, expected_minutes");
    if (error) throw new Error(error.message);
    return (data ?? []) as CategorySla[];
  });

export const upsertCategorySla = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      category_code: z.string().trim().min(1).max(16),
      stage: z.enum(STAGES),
      expected_minutes: z.coerce.number().int().positive().max(100000).nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    if (data.expected_minutes == null) {
      const { error } = await sb.from("stage_sla_category")
        .delete().eq("category_code", data.category_code).eq("stage", data.stage);
      if (error) throw new Error(error.message);
      return { ok: true, deleted: true };
    }
    const { error } = await sb.from("stage_sla_category")
      .upsert(
        { category_code: data.category_code, stage: data.stage, expected_minutes: data.expected_minutes },
        { onConflict: "category_code,stage" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Override por produto ----------

export const listProductSla = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProductSla[]> => {
    const { data, error } = await (context.supabase as any)
      .from("stage_sla_product")
      .select("id, category_code, model_code, structure_code, measure_code, stage, expected_minutes")
      .order("model_code");
    if (error) throw new Error(error.message);
    return (data ?? []) as ProductSla[];
  });

export const upsertProductSla = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      category_code: z.string().trim().min(1),
      model_code: z.string().trim().min(1),
      structure_code: z.string().trim().min(1),
      measure_code: z.string().trim().min(1),
      stage: z.enum(STAGES),
      expected_minutes: z.coerce.number().int().positive().max(100000).nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const key = {
      category_code: data.category_code, model_code: data.model_code,
      structure_code: data.structure_code, measure_code: data.measure_code,
      stage: data.stage,
    };
    if (data.expected_minutes == null) {
      const { error } = await sb.from("stage_sla_product").delete().match(key);
      if (error) throw new Error(error.message);
      return { ok: true, deleted: true };
    }
    const { error } = await sb.from("stage_sla_product")
      .upsert({ ...key, expected_minutes: data.expected_minutes },
        { onConflict: "category_code,model_code,structure_code,measure_code,stage" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Resolução em lote para os cards ----------

/**
 * Devolve um mapa { order_id: { stage: expected_minutes | null } } para uma lista
 * de encomendas/etapas visíveis. Defensivo: silencia erros, devolvendo NULL.
 */
export const getExpectedForOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      orders: z.array(z.object({
        order_id: z.string().uuid(),
        stage: z.enum(STAGES),
      })).max(500),
    }).parse(d),
  )
  .handler(async ({ data, context }): Promise<Record<string, Partial<Record<Stage, number | null>>>> => {
    const sb = context.supabase as any;
    const out: Record<string, Partial<Record<Stage, number | null>>> = {};
    if (data.orders.length === 0) return out;
    // Chamadas em paralelo via RPC — barata para listas de etapas em curso.
    await Promise.all(data.orders.map(async ({ order_id, stage }) => {
      try {
        const { data: res } = await sb.rpc("get_expected_minutes", { _order_id: order_id, _stage: stage });
        const v = typeof res === "number" ? res : null;
        out[order_id] = { ...(out[order_id] ?? {}), [stage]: v };
      } catch {
        out[order_id] = { ...(out[order_id] ?? {}), [stage]: null };
      }
    }));
    return out;
  });

// ---------- Breaches (relatórios) ----------

export type SlaBreach = {
  id: string;
  order_id: string;
  stage: Stage;
  expected_minutes: number;
  actual_productive_minutes: number;
  over_minutes: number;
  created_at: string;
};

export const listSlaBreaches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SlaBreach[]> => {
    const { data, error } = await (context.supabase as any)
      .from("sla_breaches")
      .select("id, order_id, stage, expected_minutes, actual_productive_minutes, over_minutes, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as SlaBreach[];
  });

// ---------- Import de overrides em lote ----------

export const bulkUpsertProductSla = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      rows: z.array(z.object({
        category_code: z.string().trim().min(1),
        model_code: z.string().trim().min(1),
        structure_code: z.string().trim().min(1),
        measure_code: z.string().trim().min(1),
        stage: z.enum(STAGES),
        expected_minutes: z.coerce.number().int().positive().max(100000),
      })).max(5000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.rows.length === 0) return { ok: true, count: 0 };
    const { error } = await (context.supabase as any)
      .from("stage_sla_product")
      .upsert(data.rows, { onConflict: "category_code,model_code,structure_code,measure_code,stage" });
    if (error) throw new Error(error.message);
    return { ok: true, count: data.rows.length };
  });