import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { computeLines, type ConvergenceLines } from "@/lib/convergence";

/**
 * PRODUÇÃO — Operadores
 * - Vínculo operador↔etapa
 * - Eventos de tempo (iniciar/pausar/retomar/finalizar)
 * - Configuração global do modo de identificação
 */

export const STAGES = [
  "estrutura","corte","costura","branco","estofagem","qualidade","embalagem","picagem"
] as const;
export type Stage = typeof STAGES[number];

export type ProductionStageOrder = {
  id: string;                    // order_stages.id
  order_id: string;
  order_number: string;
  product_description: string;
  observation: string | null;
  stage: Stage;
  status: string;
  is_paused: boolean;
  started_at: string | null;
  productive_seconds: number;
  paused_seconds: number;
  operator_code: string | null;
  lines?: ConvergenceLines;
};

export type ProductionData = {
  byStage: Record<Stage, ProductionStageOrder[]>;
};

export const getProductionData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProductionData> => {
    const { supabase } = context;
    const { data, error } = await (supabase as any)
      .from("order_stages")
      .select("id, stage, status, started_at, productive_seconds, paused_seconds, is_paused, production_orders!inner(id, order_number, product_description, observation, status), operators(code)")
      .neq("production_orders.status", "cancelada")
      .neq("status", "concluida")
      .order("started_at", { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);

    // Buscar TODAS as etapas das encomendas envolvidas, para calcular o
    // estado das duas linhas paralelas (Tecido + Estrutura).
    const orderIds = Array.from(new Set(((data ?? []) as any[]).map((r) => r.production_orders.id)));
    const linesByOrder = new Map<string, ConvergenceLines>();
    if (orderIds.length > 0) {
      const { data: allStages } = await (supabase as any)
        .from("order_stages")
        .select("order_id, stage, status, notes")
        .in("order_id", orderIds);
      const stagesByOrder = new Map<string, any[]>();
      for (const s of (allStages ?? []) as any[]) {
        const arr = stagesByOrder.get(s.order_id) ?? [];
        arr.push(s);
        stagesByOrder.set(s.order_id, arr);
      }
      for (const [oid, st] of stagesByOrder) {
        linesByOrder.set(oid, computeLines(st));
      }
    }

    const byStage = Object.fromEntries(STAGES.map((s) => [s, []])) as unknown as Record<Stage, ProductionStageOrder[]>;
    for (const row of (data ?? []) as any[]) {
      const o = row.production_orders;
      byStage[row.stage as Stage].push({
        id: row.id,
        order_id: o.id,
        order_number: o.order_number,
        product_description: o.product_description,
        observation: o.observation,
        stage: row.stage,
        status: row.status,
        is_paused: Boolean(row.is_paused),
        started_at: row.started_at,
        productive_seconds: row.productive_seconds ?? 0,
        paused_seconds: row.paused_seconds ?? 0,
        operator_code: row.operators?.code ?? null,
        lines: linesByOrder.get(o.id),
      });
    }
    return { byStage };
  });

const eventSchema = z.object({
  order_stage_id: z.string().uuid(),
  operator_code: z.string().trim().min(1).max(32),
  event: z.enum(["iniciar","pausar","retomar","finalizar"]),
});

export const recordStageEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => eventSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc("record_stage_event", {
      _order_stage_id: data.order_stage_id,
      _operator_code: data.operator_code,
      _event: data.event,
    });
    if (error) throw new Error(error.message);
    return res;
  });

// -------- App settings --------

export const getAppSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("app_settings")
      .select("identification_mode")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { identification_mode: (data?.identification_mode ?? "codigo") as "codigo" | "sessao" };
  });

export const updateAppSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ identification_mode: z.enum(["codigo","sessao"]) }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("app_settings")
      .update({ identification_mode: data.identification_mode, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- Operators + stage links --------

export type OperatorWithStages = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  stages: Stage[];
};

export const listOperatorsWithStages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OperatorWithStages[]> => {
    const { data: ops, error } = await context.supabase
      .from("operators")
      .select("id, code, name, active")
      .order("code");
    if (error) throw new Error(error.message);
    const { data: links, error: e2 } = await (context.supabase as any)
      .from("operator_stages")
      .select("operator_id, stage");
    if (e2) throw new Error(e2.message);
    const map = new Map<string, Stage[]>();
    for (const l of (links ?? []) as any[]) {
      const arr = map.get(l.operator_id) ?? [];
      arr.push(l.stage as Stage);
      map.set(l.operator_id, arr);
    }
    return (ops ?? []).map((o: any) => ({ ...o, stages: map.get(o.id) ?? [] }));
  });

export const setOperatorStages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      operator_id: z.string().uuid(),
      stages: z.array(z.enum(STAGES)),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { error: delErr } = await sb.from("operator_stages").delete().eq("operator_id", data.operator_id);
    if (delErr) throw new Error(delErr.message);
    if (data.stages.length > 0) {
      const rows = data.stages.map((s) => ({ operator_id: data.operator_id, stage: s }));
      const { error: insErr } = await sb.from("operator_stages").insert(rows);
      if (insErr) throw new Error(insErr.message);
    }
    return { ok: true };
  });

const opSchema = z.object({
  code: z.string().trim().min(1).max(16),
  name: z.string().trim().min(1).max(120),
  active: z.boolean().optional(),
});

export const upsertOperator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid().optional() }).merge(opSchema).parse(d)
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    if (data.id) {
      const { error } = await sb.from("operators").update({
        code: data.code, name: data.name, active: data.active ?? true,
      }).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: inserted, error } = await sb.from("operators").insert({
      code: data.code, name: data.name, active: data.active ?? true,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: inserted.id };
  });

export const getStageDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ order_stage_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: stage } = await sb.from("order_stages")
      .select("id, stage, status, started_at, finished_at, productive_seconds, paused_seconds, is_paused, production_orders(order_number, product_description)")
      .eq("id", data.order_stage_id).maybeSingle();
    const { data: logs } = await sb.from("stage_time_logs")
      .select("event, event_at, operators(code, name)")
      .eq("order_stage_id", data.order_stage_id)
      .order("event_at", { ascending: true });
    return { stage, logs: logs ?? [] };
  });