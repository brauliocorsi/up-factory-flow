import { describe, expect, it } from "vitest";
import { runOutboxBatch, type OutboxDb } from "./erpOutbox.server";

const EV = "77777777-7777-4777-8777-777777777777";

function fakeDb(opts: { claimErr?: boolean; completeErr?: boolean; completeOk?: boolean } = {}) {
  const calls: Array<{ fn: string; args: any }> = [];
  const db: OutboxDb = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "erp_outbox_claim") {
        return opts.claimErr ? { data: null, error: { message: "db down" } } : { data: [{ event_id: EV, payload: { event_id: EV } }], error: null };
      }
      if (opts.completeErr) return { data: null, error: { message: "write failed" } };
      return { data: opts.completeOk ?? true, error: null };
    },
  };
  return { db, calls };
}
const base = { url: "https://erp.test/", token: "t", owner: "88888888-8888-4888-8888-888888888888" };

describe("worker da outbox", () => {
  it("entrega com ACK e conclui com o mesmo owner e event_id", async () => {
    const { db, calls } = fakeDb();
    let sentUrl = "";
    let sentHeaders: any;
    const r = await runOutboxBatch(db, {
      ...base,
      fetcher: async (u, i) => {
        sentUrl = u;
        sentHeaders = i.headers;
        return { status: 200, text: async () => JSON.stringify({ accepted: true, event_id: EV }) };
      },
    });
    expect(sentUrl).toBe("https://erp.test/api/integrations/factory/events");
    expect(sentHeaders["x-up-integration-token"]).toBe("t");
    expect(r.delivered).toBe(1);
    const c = calls.find((x) => x.fn === "erp_outbox_complete")!;
    expect(c.args).toMatchObject({ _event_id: EV, _owner: base.owner, _state: "entregue" });
  });
  it("falha de rede fica incerta (evento não perdido)", async () => {
    const { db, calls } = fakeDb();
    const r = await runOutboxBatch(db, { ...base, fetcher: async () => { throw new Error("ECONNRESET"); } });
    expect(r.failed).toBe(1);
    expect(calls.at(-1)!.args._state).toBe("incerto");
  });
  it("erro da base no claim ou na conclusão é propagado", async () => {
    await expect(runOutboxBatch(fakeDb({ claimErr: true }).db, { ...base, fetcher: async () => ({ status: 200, text: async () => "" }) })).rejects.toThrow(/reservar/);
    await expect(runOutboxBatch(fakeDb({ completeErr: true }).db, { ...base, fetcher: async () => ({ status: 500, text: async () => "" }) })).rejects.toThrow(/registar/);
  });
  it("lease perdido não conta como entregue", async () => {
    const { db } = fakeDb({ completeOk: false });
    const r = await runOutboxBatch(db, { ...base, fetcher: async () => ({ status: 200, text: async () => JSON.stringify({ accepted: true, event_id: EV }) }) });
    expect(r).toMatchObject({ delivered: 0, lostLease: 1 });
  });
});
