import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAnyRole } from "./roleGuards";

export const getErpIntegrationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAnyRole(context, ["admin", "escritorio"], "ver a integração ERP");
    const sb = context.supabase as any;
    const [{ data: outbox }, { data: links }] = await Promise.all([
      sb
        .from("erp_outbox")
        .select("event_id, order_id, event_status, state, attempts, last_response_code, last_error, last_attempt_at, acked_at, created_at, production_orders(order_number)")
        .order("created_at", { ascending: false })
        .limit(200),
      sb
        .from("erp_order_links")
        .select("id, sale_number, unit_index, line_quantity, mapping_status, product_code, created_at, production_orders(order_number, status)")
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    return {
      inboundConfigured: !!process.env["UP_ERP_INTEGRATION_TOKEN"],
      outboundConfigured: !!process.env["UP_ERP_INTEGRATION_TOKEN"] && !!process.env["UP_ERP_URL"],
      outbox: outbox ?? [],
      links: links ?? [],
    };
  });

/** Envia eventos pendentes/erro/incerto (mesmo event_id). Só admin/escritório. */
export const processErpOutbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ event_id: z.string().uuid().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await assertAnyRole(context, ["admin", "escritorio"], "enviar eventos ao ERP");
    const url = process.env["UP_ERP_URL"];
    const token = process.env["UP_ERP_INTEGRATION_TOKEN"];
    if (!url || !token) return { ok: false, message: "Integração desligada: falta configurar UP_ERP_URL / UP_ERP_INTEGRATION_TOKEN.", sent: 0 };
    const { classifyDelivery } = await import("./erpIntegration.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    let q = sb.from("erp_outbox").select("*").neq("state", "entregue").order("created_at").limit(50);
    if (data.event_id) q = q.eq("event_id", data.event_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const endpoint = `${url.replace(/\/+$/, "")}/api/integrations/factory/events`;
    let sent = 0;
    let failed = 0;
    for (const ev of rows ?? []) {
      // warehouse_received só depois de produced confirmado pelo ERP.
      if (ev.event_status === "warehouse_received") {
        const { data: prod } = await sb.from("erp_outbox").select("state").eq("order_id", ev.order_id).eq("event_status", "produced").maybeSingle();
        if (prod && prod.state !== "entregue") continue;
      }
      await sb.from("erp_outbox").update({ state: "a_enviar", attempts: ev.attempts + 1, last_attempt_at: new Date().toISOString() }).eq("event_id", ev.event_id);
      let outcome;
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", "x-up-integration-token": token },
          body: JSON.stringify(ev.payload),
          signal: AbortSignal.timeout(15_000),
        });
        outcome = classifyDelivery(ev.event_id, { status: res.status, body: await res.text() });
      } catch (e: any) {
        outcome = classifyDelivery(ev.event_id, { networkError: e?.message ?? "erro" });
      }
      await sb
        .from("erp_outbox")
        .update({
          state: outcome.state,
          last_response_code: outcome.code,
          last_error: outcome.error,
          acked_at: outcome.state === "entregue" ? new Date().toISOString() : null,
        })
        .eq("event_id", ev.event_id);
      if (outcome.state === "entregue") sent++;
      else failed++;
    }
    return { ok: true, sent, failed, message: `${sent} entregue(s), ${failed} por resolver.` };
  });
