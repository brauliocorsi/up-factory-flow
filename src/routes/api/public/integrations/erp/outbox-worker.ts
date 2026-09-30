import { createFileRoute } from "@tanstack/react-router";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * Worker agendável da outbox ERP. Autenticação própria (x-up-integration-token).
 * Desligado por omissão: só processa com erp_integration_settings.worker_enabled = true
 * (ligado por admin após envio manual confirmado). Não há agendamento ativo.
 */
export const Route = createFileRoute("/api/public/integrations/erp/outbox-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { tokenMatches } = await import("@/lib/erpIntegration.server");
        const token = process.env["UP_ERP_INTEGRATION_TOKEN"];
        const url = process.env["UP_ERP_URL"];
        if (!token || !url) return json(503, { ok: false, error: "integration_disabled" });
        if (!tokenMatches(request.headers.get("x-up-integration-token"), token)) {
          return json(401, { ok: false, error: "unauthorized" });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const sb = supabaseAdmin as any;
        const { data: s, error } = await sb.from("erp_integration_settings").select("worker_enabled").eq("id", 1).maybeSingle();
        if (error) return json(500, { ok: false, error: "settings_unavailable" });
        if (!s?.worker_enabled) return json(200, { ok: true, skipped: "worker_disabled" });
        const { runOutboxBatch, summarize } = await import("@/lib/erpOutbox.server");
        try {
          const r = await runOutboxBatch(sb, { url, token, owner: crypto.randomUUID() });
          await sb.rpc("erp_record_run", { _summary: `worker: ${summarize(r)}` });
          return json(200, { ok: true, ...r });
        } catch (e: any) {
          console.error("[erp-worker]", e?.message);
          await sb.rpc("erp_record_run", { _summary: "worker: erro interno (ver registos)" });
          return json(500, { ok: false, error: "worker_failed" });
        }
      },
    },
  },
});
