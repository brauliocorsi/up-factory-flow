import { classifyDelivery } from "./erpIntegration.server";

export const LEASE_SECONDS = 60;
export const FETCH_TIMEOUT_MS = 15_000;
export const BATCH_LIMIT = 20;

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: { message: string } | null }>;
export type OutboxDb = { rpc: Rpc };
export type Fetcher = (url: string, init: RequestInit) => Promise<{ status: number; text: () => Promise<string> }>;

export type RunResult = { claimed: number; delivered: number; failed: number; lostLease: number };

/**
 * Processa um lote da outbox. Claim atómico (SKIP LOCKED + lease) e conclusão
 * condicionada ao owner: duas execuções simultâneas nunca enviam o mesmo evento
 * dentro do lease, e um resultado tardio de um lease expirado é rejeitado.
 * Erros da base são propagados (nunca ignorados).
 */
export async function runOutboxBatch(
  db: OutboxDb,
  opts: { url: string; token: string; owner: string; limit?: number; fetcher?: Fetcher },
): Promise<RunResult> {
  const fetcher: Fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  const { data: rows, error } = await db.rpc("erp_outbox_claim", {
    _owner: opts.owner,
    _limit: opts.limit ?? BATCH_LIMIT,
    _lease_seconds: LEASE_SECONDS,
  });
  if (error) throw new Error(`Falha ao reservar eventos: ${error.message}`);
  const endpoint = `${opts.url.replace(/\/+$/, "")}/api/integrations/factory/events`;
  const res: RunResult = { claimed: (rows ?? []).length, delivered: 0, failed: 0, lostLease: 0 };

  for (const ev of rows ?? []) {
    let outcome;
    try {
      const r = await fetcher(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-up-integration-token": opts.token },
        body: JSON.stringify(ev.payload),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      outcome = classifyDelivery(ev.event_id, { status: r.status, body: await r.text() });
    } catch (e: any) {
      outcome = classifyDelivery(ev.event_id, { networkError: e?.name === "TimeoutError" ? "timeout" : "falha de rede" });
    }
    const { data: ok, error: cErr } = await db.rpc("erp_outbox_complete", {
      _event_id: ev.event_id,
      _owner: opts.owner,
      _state: outcome.state,
      _code: outcome.code,
      _error: outcome.error,
    });
    if (cErr) throw new Error(`Falha ao registar resultado do evento: ${cErr.message}`);
    if (ok !== true) {
      res.lostLease++;
      continue;
    }
    if (outcome.state === "entregue") res.delivered++;
    else res.failed++;
  }
  return res;
}

export function summarize(r: RunResult): string {
  return `${r.claimed} reservado(s), ${r.delivered} entregue(s), ${r.failed} por resolver${r.lostLease ? `, ${r.lostLease} com lease perdido` : ""}.`;
}
