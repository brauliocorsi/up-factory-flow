import { describe, expect, it } from "vitest";
import { classifyDelivery, erpOrderSchema, payloadHash, tokenMatches } from "./erpIntegration.server";

const base = {
  schema_version: 1,
  source_system: "up-moveis-base",
  event_id: "11111111-1111-4111-8111-111111111111",
  sale_id: "22222222-2222-4222-8222-222222222222",
  sale_number: "V2026-001",
  line_id: "33333333-3333-4333-8333-333333333333",
  product_id: "44444444-4444-4444-8444-444444444444",
  product_code: null,
  description: "Cama Atena 160 — tecido cliente, cabeceira 300 cm, sem pés",
  quantity: 2,
  due_date: "2026-10-15",
  customization: { cabeceira: 300 },
  test_mode: false,
};

describe("contrato v1 — validação", () => {
  it("aceita payload válido e conserva descrição integral", () => {
    const p = erpOrderSchema.parse(base);
    expect(p.description).toBe(base.description);
  });
  it.each([0, -1, 1.5, 51])("rejeita quantidade %s", (q) => {
    expect(erpOrderSchema.safeParse({ ...base, quantity: q }).success).toBe(false);
  });
  it("rejeita campos extra, UUID inválido e data inexistente", () => {
    expect(erpOrderSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(erpOrderSchema.safeParse({ ...base, sale_id: "x" }).success).toBe(false);
    expect(erpOrderSchema.safeParse({ ...base, due_date: "2026-02-30" }).success).toBe(false);
    expect(erpOrderSchema.safeParse({ ...base, source_system: "outro" }).success).toBe(false);
  });
});

describe("idempotência", () => {
  it("hash igual para reenvio (mesmo conteúdo, chaves noutra ordem, outro event_id)", () => {
    const a = erpOrderSchema.parse(base);
    const b = erpOrderSchema.parse({ ...base, event_id: "55555555-5555-4555-8555-555555555555", customization: { cabeceira: 300 } });
    expect(payloadHash(a)).toBe(payloadHash(b));
  });
  it("hash diferente para conteúdo conflitante", () => {
    const a = erpOrderSchema.parse(base);
    const b = erpOrderSchema.parse({ ...base, quantity: 3 });
    expect(payloadHash(a)).not.toBe(payloadHash(b));
  });
});

describe("autenticação", () => {
  it("sem segredo configurado nunca autoriza", () => {
    expect(tokenMatches("abc", undefined)).toBe(false);
    expect(tokenMatches("", "")).toBe(false);
  });
  it("compara tokens", () => {
    expect(tokenMatches("segredo-teste", "segredo-teste")).toBe(true);
    expect(tokenMatches("segredo-test", "segredo-teste")).toBe(false);
  });
});

describe("outbox — classificação de entrega", () => {
  const id = "66666666-6666-4666-8666-666666666666";
  it("entregue só com ACK válido", () => {
    expect(classifyDelivery(id, { status: 200, body: JSON.stringify({ accepted: true, event_id: id }) }).state).toBe("entregue");
    expect(classifyDelivery(id, { status: 200, body: "ok" }).state).toBe("incerto");
    expect(classifyDelivery(id, { status: 200, body: JSON.stringify({ accepted: true, event_id: "outro" }) }).state).toBe("incerto");
  });
  it("erro HTTP e falha de rede não perdem o evento", () => {
    expect(classifyDelivery(id, { status: 500, body: "x" }).state).toBe("erro");
    expect(classifyDelivery(id, { networkError: "timeout" }).state).toBe("incerto");
  });
});
