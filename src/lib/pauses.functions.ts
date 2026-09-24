import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type PauseReason = { id: string; label: string; sort_order: number; requires_note: boolean; active: boolean };

export const listPauseReasons = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("pause_reasons")
      .select("id,label,sort_order,requires_note,active")
      .order("sort_order")
      .order("label");
    if (error) throw new Error(error.message);
    return (data ?? []) as PauseReason[];
  });

export const upsertPauseReason = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      label: z.string().trim().min(1).max(80),
      sort_order: z.number().int().min(0).max(999),
      requires_note: z.boolean(),
      active: z.boolean(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const row = { label: data.label, sort_order: data.sort_order, requires_note: data.requires_note, active: data.active };
    const { error } = data.id
      ? await sb.from("pause_reasons").update(row).eq("id", data.id)
      : await sb.from("pause_reasons").insert(row);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type IdleSegment = { kind: "prod" | "pausa" | "ocioso"; reason: string | null; from: number; to: number };
export type IdleRow = {
  operator_id: string;
  operator_code: string;
  operator_name: string;
  day: string;
  productive_min: number;
  pause_min: number;
  idle_min: number;
  shift_min: number;
  pause_by_reason: Record<string, number>;
  segments: IdleSegment[];
  current_pause_reason: string | null;
};

export const getIdleReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc("get_idle_report", { _from: data.from, _to: data.to });
    if (error) throw new Error(error.message);
    return (res ?? []) as IdleRow[];
  });
