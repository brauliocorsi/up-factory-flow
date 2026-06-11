import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Produção em massa de cascos (lotes).
 * Reutiliza identificação de operador e mecânica de tempo do prompt 7.
 * As funções SQL fazem o trabalho pesado (atribuição + stock + tempos).
 */

export type WaitingOrder = {
  order_id: string;
  order_number: string;
  product_description: string;
  exit_date: string | null;
};

export type ShellNeed = {
  shell_id: string;
  shell_code: string;
  shell_name: string;
  quantity: number;
  reserved: number;
  available: number;
  gross_need: number;
  net_need: number;
  waiting_orders: WaitingOrder[];
};

export const listShellNeeds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ShellNeed[]> => {
    const { data, error } = await (context.supabase as any).rpc("shell_needs_grouped");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      ...r,
      waiting_orders: Array.isArray(r.waiting_orders) ? r.waiting_orders : [],
    }));
  });

export type ActiveBatch = {
  id: string;
  shell_id: string | null;
  shell_code: string | null;
  shell_name: string | null;
  operator_code: string | null;
  quantity: number;
  is_paused: boolean;
  status: string;
  started_at: string | null;
  productive_seconds: number;
  paused_seconds: number;
};

export const listActiveBatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ActiveBatch[]> => {
    const { data, error } = await (context.supabase as any)
      .from("shell_batches")
      .select("id, shell_id, quantity, is_paused, status, started_at, productive_seconds, paused_seconds, shells(code, name), operators(code)")
      .eq("status", "em_curso")
      .order("started_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      shell_id: r.shell_id,
      shell_code: r.shells?.code ?? null,
      shell_name: r.shells?.name ?? null,
      operator_code: r.operators?.code ?? null,
      quantity: r.quantity,
      is_paused: Boolean(r.is_paused),
      status: r.status,
      started_at: r.started_at,
      productive_seconds: r.productive_seconds ?? 0,
      paused_seconds: r.paused_seconds ?? 0,
    }));
  });

export const startShellBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      shell_id: z.string().uuid(),
      operator_code: z.string().trim().min(1).max(32),
      quantity: z.number().int().min(1).max(500),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc("start_shell_batch", {
      _shell_id: data.shell_id,
      _operator_code: data.operator_code,
      _quantity: data.quantity,
    });
    if (error) throw new Error(error.message);
    return { batch_id: res as string };
  });

export const recordShellBatchEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      batch_id: z.string().uuid(),
      operator_code: z.string().trim().min(1).max(32),
      event: z.enum(["pausar","retomar"]),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc("record_shell_batch_event", {
      _batch_id: data.batch_id,
      _operator_code: data.operator_code,
      _event: data.event,
    });
    if (error) throw new Error(error.message);
    return res;
  });

export const finalizeShellBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      batch_id: z.string().uuid(),
      operator_code: z.string().trim().min(1).max(32),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc("finalize_shell_batch", {
      _batch_id: data.batch_id,
      _operator_code: data.operator_code,
    });
    if (error) throw new Error(error.message);
    return res;
  });
