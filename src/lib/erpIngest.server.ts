const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Handler partilhado por /api/integrations/erp/orders e o alias /api/public/integrations/erp/orders. */
export async function handleErpOrderRequest(request: Request): Promise<Response> {
        const { erpOrderSchema, payloadHash, tokenMatches, testModeAllowed } = await import(
          "./erpIntegration.server"
        );
        const expected = process.env["UP_ERP_INTEGRATION_TOKEN"];
        if (!expected) return json(503, { accepted: false, error: "integration_disabled" });
        if (!tokenMatches(request.headers.get("x-up-integration-token"), expected)) {
          return json(401, { accepted: false, error: "unauthorized" });
        }
        const raw = await request.text();
        if (raw.length > 32_000) return json(413, { accepted: false, error: "payload_too_large" });
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          return json(400, { accepted: false, error: "invalid_json" });
        }
        const parsed = erpOrderSchema.safeParse(body);
        if (!parsed.success) {
          return json(422, {
            accepted: false,
            error: "validation_failed",
            issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          });
        }
        const p = parsed.data;
        if (p.test_mode) {
          if (!testModeAllowed()) return json(403, { accepted: false, error: "test_mode_not_allowed" });
          // Ambiente de teste: valida e responde sem criar OPs reais.
          return json(200, { accepted: true, event_id: p.event_id, test_mode: true, orders: [] });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await (supabaseAdmin as any).rpc("erp_ingest_order", {
          _p: p,
          _hash: payloadHash(p),
        });
        if (error) {
          console.error("[erp-ingest]", error.message);
          return json(500, { accepted: false, error: "ingest_failed" });
        }
        if (!data?.ok) return json(409, { accepted: false, error: data?.code ?? "conflict", message: data?.message });
        return json(data.replay ? 200 : 201, { accepted: true, event_id: p.event_id, orders: data.orders });
}
