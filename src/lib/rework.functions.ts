import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { STAGES, type Stage } from "@/lib/production.functions";

/**
 * RETRABALHO — server functions
 * Reutiliza a identificação do operador e mecânica de tempo.
 */

export type ReworkReason = { id: string; label: string; active: boolean };

export const listReworkReasons = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReworkReason[]> => {
    const { data, error } = await (context.supabase as any)
      .from("rework_reasons")
      .select("id, label, active")
      .eq("active", true)
      .order("label");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const sendSchema = z.object({
  order_id: z.string().uuid(),
  detected_stage: z.enum(STAGES),
  target_stage: z.enum(STAGES),
  operator_code: z.string().trim().min(1).max(32),
  reason_id: z.string().uuid().nullable().optional(),
  reason_notes: z.string().trim().max(2000).nullable().optional(),
});

export const sendToRework = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => sendSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc("send_to_rework", {
      _order_id: data.order_id,
      _detected_stage: data.detected_stage,
      _target_stage: data.target_stage,
      _operator_code: data.operator_code,
      _reason_id: data.reason_id ?? null,
      _reason_notes: data.reason_notes ?? null,
    });
    if (error) throw new Error(error.message);
    return res;
  });

export type ReworkEventRow = {
  id: string;
  order_id: string;
  order_number: string;
  product_description: string;
  detected_at_stage: Stage;
  sent_to_stage: Stage;
  reason_label: string | null;
  reason_notes: string | null;
  operator_code: string | null;
  operator_name: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
};

const listSchema = z.object({
  status: z.enum(["aberto", "resolvido", "todos"]).optional(),
  detected_stage: z.enum(STAGES).optional(),
  target_stage: z.enum(STAGES).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
}).partial();

export const listReworkEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<ReworkEventRow[]> => {
    let q = (context.supabase as any)
      .from("rework_events")
      .select("id, order_id, detected_at_stage, sent_to_stage, reason_notes, status, created_at, resolved_at, production_orders(order_number, product_description), rework_reasons(label), operators(code, name)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.status && data.status !== "todos") q = q.eq("status", data.status);
    if (data.detected_stage) q = q.eq("detected_at_stage", data.detected_stage);
    if (data.target_stage) q = q.eq("sent_to_stage", data.target_stage);
    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      order_id: r.order_id,
      order_number: r.production_orders?.order_number ?? "",
      product_description: r.production_orders?.product_description ?? "",
      detected_at_stage: r.detected_at_stage,
      sent_to_stage: r.sent_to_stage,
      reason_label: r.rework_reasons?.label ?? null,
      reason_notes: r.reason_notes,
      operator_code: r.operators?.code ?? null,
      operator_name: r.operators?.name ?? null,
      status: r.status,
      created_at: r.created_at,
      resolved_at: r.resolved_at,
    }));
  });

export type ReworkMetrics = {
  total: number;
  open: number;
  resolved: number;
  by_detected: { stage: Stage; count: number }[];
  by_target: { stage: Stage; count: number }[];
  by_reason: { reason: string; count: number }[];
};

export const getReworkMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReworkMetrics> => {
    const { data, error } = await (context.supabase as any)
      .from("rework_events")
      .select("detected_at_stage, sent_to_stage, status, rework_reasons(label)")
      .limit(5000);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    const byD = new Map<Stage, number>();
    const byT = new Map<Stage, number>();
    const byR = new Map<string, number>();
    let open = 0, resolved = 0;
    for (const r of rows) {
      if (r.status === "aberto") open++; else resolved++;
      byD.set(r.detected_at_stage, (byD.get(r.detected_at_stage) ?? 0) + 1);
      byT.set(r.sent_to_stage, (byT.get(r.sent_to_stage) ?? 0) + 1);
      const lbl = r.rework_reasons?.label ?? "Sem motivo";
      byR.set(lbl, (byR.get(lbl) ?? 0) + 1);
    }
    return {
      total: rows.length,
      open,
      resolved,
      by_detected: Array.from(byD, ([stage, count]) => ({ stage, count })).sort((a,b)=>b.count-a.count),
      by_target: Array.from(byT, ([stage, count]) => ({ stage, count })).sort((a,b)=>b.count-a.count),
      by_reason: Array.from(byR, ([reason, count]) => ({ reason, count })).sort((a,b)=>b.count-a.count),
    };
  });