import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAnyRole } from "./roleGuards";

export const getErpIntegrationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAnyRole(context, ["admin", "escritorio"], "ver a integração ERP");
    const sb = context.supabase as any;
    const [o, l, s] = await Promise.all([
      sb
        .from("erp_outbox")
        .select("event_id, order_id, event_status, state, attempts, last_response_code, last_error, last_attempt_at, next_attempt_at, lease_expires_at, acked_at, created_at, production_orders(order_number)")
        .order("created_at", { ascending: false })
        .limit(200),
      sb
        .from("erp_order_links")
        .select("id, sale_number, product_id, unit_index, line_quantity, mapping_status, product_code, description, customization, validated_at, created_at, production_orders(order_number, status)")
        .order("created_at", { ascending: false })
        .limit(200),
      sb.from("erp_integration_settings").select("*").eq("id", 1).maybeSingle(),
    ]);
    for (const r of [o, l, s]) if (r.error) throw new Error(r.error.message);
    return {
      inboundConfigured: !!process.env["UP_ERP_INTEGRATION_TOKEN"],
      outboundConfigured: !!process.env["UP_ERP_INTEGRATION_TOKEN"] && !!process.env["UP_ERP_URL"],
      settings: s.data,
      outbox: o.data ?? [],
      links: l.data ?? [],
    };
  });

/** Envio manual (ensaio/reenvio). Usa o mesmo claim/lease do worker. */
export const processErpOutbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ event_id: z.string().uuid().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await assertAnyRole(context, ["admin", "escritorio"], "enviar eventos ao ERP");
    const url = process.env["UP_ERP_URL"];
    const token = process.env["UP_ERP_INTEGRATION_TOKEN"];
    if (!url || !token) return { ok: false, message: "Integração desligada: falta configurar UP_ERP_URL / UP_ERP_INTEGRATION_TOKEN." };
    if (data.event_id) {
      const { error } = await (context.supabase as any).rpc("erp_outbox_retry_now", { _event_id: data.event_id });
      if (error) throw new Error(error.message);
    }
    const { runOutboxBatch, summarize } = await import("./erpOutbox.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const r = await runOutboxBatch(supabaseAdmin as any, { url, token, owner: crypto.randomUUID() });
    const msg = summarize(r);
    await (supabaseAdmin as any).rpc("erp_record_run", { _summary: `manual: ${msg}` });
    return { ok: true, message: msg };
  });

export const setErpWorkerEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.enabled && (!process.env["UP_ERP_URL"] || !process.env["UP_ERP_INTEGRATION_TOKEN"])) {
      throw new Error("Configuração em falta: não é possível ligar o envio automático.");
    }
    const { data: res, error } = await (context.supabase as any).rpc("erp_set_worker_enabled", { _enabled: data.enabled });
    if (error) throw new Error(error.message);
    return res;
  });

export const validateErpMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        product_id: z.string().uuid(),
        model_id: z.string().uuid(),
        structure_type: z.string().max(40).nullable(),
        measure: z.string().max(40).nullable(),
        fabric_ref_tec: z.string().max(20).nullable(),
        notes: z.string().max(500).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAnyRole(context, ["admin", "escritorio"], "validar correspondência ERP");
    const { data: res, error } = await (context.supabase as any).rpc("erp_validate_mapping", {
      _product_id: data.product_id,
      _model_id: data.model_id,
      _structure_type: data.structure_type,
      _measure: data.measure,
      _fabric_ref_tec: data.fabric_ref_tec,
      _notes: data.notes,
    });
    if (error) throw new Error(error.message);
    return res as { ok: boolean; orders_updated: number };
  });
