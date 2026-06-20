import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Planeamento Fase A — backward scheduling.
 * Datas-alvo CALCULADAS AO VIVO (nunca persistidas).
 *
 * TODO Fase B: planner drag-and-drop.
 * TODO Fase C: encaixe automático de lotes.
 * TODO: eficiência por operador via stage_time_logs × SLA teórico.
 * TODO: tabela de feriados para add_business_days.
 */

export const STAGES = [
  "estrutura","corte","costura","branco","estofagem","qualidade","embalagem","picagem",
] as const;
export type Stage = (typeof STAGES)[number];

export type LeadOffset = { stage: Stage; days_before_estofo: number };

export type StageTarget = {
  stage: Stage;
  target_date: string | null;
  status: "ok" | "atrasada_folga" | "risco_saida";
};

export type StageQueueItem = {
  order_id: string;
  order_stage_id: string;
  order_number: string;
  customer_order: string | null;
  product_description: string | null;
  structure_type: string | null;
  measure: string | null;
  color: string | null;
  due_date: string | null;
  target_date: string | null;
  target_estof: string | null;
  expected_minutes: number | null;
  stage_status: string;
  status: "ok" | "atrasada_folga" | "risco_saida";
};

export type CapacityLoadDay = {
  date: string;
  capacity_minutes: number;
  load_minutes: number;
  items_count: number;
  has_unknown: boolean;
  includes_overdue: boolean;
};

// ---------- Fase B types ----------

export type BacklogItem = {
  order_id: string;
  order_number: string;
  customer_order: string | null;
  product_description: string | null;
  model_name: string | null;
  measure: string | null;
  structure_type: string | null;
  color: string | null;
  fabric_type: string | null;
  fabric_ref: string | null;
  due_date: string | null;
  target_estrutura: string | null;
  target_estof: string | null;
  status: "ok" | "atrasada_folga" | "risco_saida";
};

export type ActivationGroup = {
  kind: "corte" | "estrutura";
  key: Record<string, unknown>;
  order_ids: string[];
  count: number;
  earliest_target: string | null;
  earliest_due_date: string | null;
};

export type GlobalLoadCell = {
  stage: Stage;
  date: string;
  capacity_minutes: number;
  load_firm_minutes: number;
  load_shadow_minutes: number;
  items_firm: number;
  items_shadow: number;
  has_unknown: boolean;
  includes_overdue: boolean;
};

export type ActivateResult = {
  activated: string[];
  skipped: string[];
  failed: { order_id: string; reason: string }[];
};

async function assertAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Acesso restrito a administradores");
}

async function assertAdminOrOffice(context: any) {
  const sb = context.supabase;
  const [{ data: a, error: e1 }, { data: o, error: e2 }] = await Promise.all([
    sb.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
    sb.rpc("has_role", { _user_id: context.userId, _role: "escritorio" }),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
  if (!a && !o) throw new Error("Acesso restrito a admin/escritório");
}

// ---------- Lead offsets ----------

export const listLeadOffsets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LeadOffset[]> => {
    const { data, error } = await (context.supabase as any)
      .from("stage_lead_offsets")
      .select("stage, days_before_estofo");
    if (error) throw new Error(error.message);
    return (data ?? []) as LeadOffset[];
  });

export const upsertLeadOffset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      stage: z.enum(STAGES),
      days_before_estofo: z.coerce.number().int().min(0).max(60),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await (context.supabase as any)
      .from("stage_lead_offsets")
      .upsert(
        { stage: data.stage, days_before_estofo: data.days_before_estofo, updated_at: new Date().toISOString() },
        { onConflict: "stage" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Jornada (daily_minutes) ----------

export const getDailyMinutes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<number> => {
    const { data, error } = await (context.supabase as any)
      .from("app_settings")
      .select("daily_minutes")
      .order("id")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return Number(data?.daily_minutes ?? 450);
  });

export const setDailyMinutes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ daily_minutes: z.coerce.number().int().min(60).max(1440) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = context.supabase as any;
    const { data: row } = await sb.from("app_settings").select("id").order("id").limit(1).maybeSingle();
    if (row?.id) {
      const { error } = await sb.from("app_settings").update({ daily_minutes: data.daily_minutes }).eq("id", row.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await sb.from("app_settings").insert({ daily_minutes: data.daily_minutes });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// ---------- Datas-alvo por encomenda ----------

export const getStageTargetDates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ order_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<StageTarget[]> => {
    const { data: rows, error } = await (context.supabase as any).rpc("get_stage_target_dates", {
      _order_id: data.order_id,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []) as StageTarget[];
  });

// ---------- Fila por etapa ----------

export const getStageQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      stage: z.enum(STAGES),
      limit: z.coerce.number().int().min(1).max(500).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ items: StageQueueItem[]; total: number }> => {
    const { data: res, error } = await (context.supabase as any).rpc("get_stage_queue", { _stage: data.stage });
    if (error) throw new Error(error.message);
    const all = (res ?? []) as StageQueueItem[];
    const offset = data.offset ?? 0;
    const limit = data.limit ?? all.length;
    return { items: all.slice(offset, offset + limit), total: all.length };
  });

// ---------- Carga vs capacidade ----------

export const getStageCapacityLoad = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      stage: z.enum(STAGES),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(d),
  )
  .handler(async ({ data, context }): Promise<CapacityLoadDay[]> => {
    const { data: res, error } = await (context.supabase as any).rpc("get_stage_capacity_load", {
      _stage: data.stage, _from: data.from, _to: data.to,
    });
    if (error) throw new Error(error.message);
    return (res ?? []) as CapacityLoadDay[];
  });

// ---------- Presenças do dia ----------

export type DayAssignment = {
  operator_id: string;
  operator_code: string;
  operator_name: string;
  stage: Stage;
  present: boolean;
};

export const listOperatorsByStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<DayAssignment[]> => {
    const sb = context.supabase as any;
    const { data: ops, error: e1 } = await sb
      .from("operator_stages")
      .select("stage, operator_id, operators!inner(id, code, name, active)");
    if (e1) throw new Error(e1.message);
    const { data: marks, error: e2 } = await sb
      .from("stage_day_assignment")
      .select("operator_id, stage, present")
      .eq("work_date", data.work_date);
    if (e2) throw new Error(e2.message);
    const key = (oid: string, st: string) => `${oid}|${st}`;
    const map = new Map<string, boolean>();
    for (const m of marks ?? []) map.set(key(m.operator_id, m.stage), m.present);
    return (ops ?? [])
      .filter((r: any) => r.operators?.active !== false)
      .map((r: any) => ({
        operator_id: r.operator_id,
        operator_code: r.operators.code,
        operator_name: r.operators.name,
        stage: r.stage,
        present: map.get(key(r.operator_id, r.stage)) ?? true,
      }));
  });

export const setDayPresence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      operator_id: z.string().uuid(),
      stage: z.enum(STAGES),
      work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      present: z.boolean(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await (context.supabase as any)
      .from("stage_day_assignment")
      .upsert(
        { ...data, updated_at: new Date().toISOString() },
        { onConflict: "operator_id,stage,work_date" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });