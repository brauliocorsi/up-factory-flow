import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Stock de produto final (pós-embalagem) + base para futura
 * transferência a outro software (stub documentado).
 */

export type FinishedGoodRow = {
  id: string;
  order_id: string | null;
  order_number: string | null;
  product_code: string | null;
  product_description: string | null;
  barcode: string | null;
  quantity: number;
  status: "em_stock" | "transferido";
  ready_for_transfer: boolean;
  transferred_at: string | null;
  created_at: string;
};

export const listFinishedGoods = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    status: z.enum(["em_stock", "transferido", "todos"]).optional(),
  }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<FinishedGoodRow[]> => {
    const sb = context.supabase as any;
    let q = sb.from("finished_goods")
      .select("id, order_id, product_code, barcode, quantity, status, ready_for_transfer, transferred_at, created_at, production_orders(order_number, product_description)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.status && data.status !== "todos") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      id: r.id, order_id: r.order_id,
      order_number: r.production_orders?.order_number ?? null,
      product_code: r.product_code,
      product_description: r.production_orders?.product_description ?? null,
      barcode: r.barcode, quantity: r.quantity,
      status: r.status, ready_for_transfer: r.ready_for_transfer,
      transferred_at: r.transferred_at, created_at: r.created_at,
    }));
  });

/**
 * STUB: futura integração com o outro software (picagem final).
 * Por enquanto marca como 'transferido' manualmente e regista um movimento.
 * Quando a integração real for definida, substituir o corpo desta função
 * pelo envio efetivo ao sistema externo antes de marcar como transferido.
 */
export const transferToExternalSystem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: fg, error: gErr } = await sb.from("finished_goods")
      .select("id, order_id, status").eq("id", data.id).maybeSingle();
    if (gErr) throw new Error(gErr.message);
    if (!fg) throw new Error("Produto não encontrado");
    if (fg.status === "transferido") throw new Error("Já transferido");

    // TODO: substituir por chamada real ao outro software quando definido.
    // await externalSystemClient.send({ ... });

    const { error } = await sb.from("finished_goods").update({
      status: "transferido", transferred_at: new Date().toISOString(),
    }).eq("id", data.id);
    if (error) throw new Error(error.message);

    await sb.from("stock_movements").insert({
      item_type: "finished_good", item_id: fg.order_id ?? data.id,
      delta: -1, reason: "Transferido para sistema externo",
    });
    return { ok: true };
  });
