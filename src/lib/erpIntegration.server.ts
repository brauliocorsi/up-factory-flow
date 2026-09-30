import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** Contrato v1 — ver docs/integrations/up-moveis-base-v1.md */
export const ERP_SOURCE = "up-moveis-base";
export const FACTORY_SOURCE = "up-fabrica";
export const MAX_QUANTITY = 50;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "data inválida");

export const erpOrderSchema = z
  .object({
    schema_version: z.literal(1),
    source_system: z.literal(ERP_SOURCE),
    event_id: z.string().uuid(),
    sale_id: z.string().uuid(),
    sale_number: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "caracteres inválidos"),
    line_id: z.string().uuid(),
    product_id: z.string().uuid(),
    product_code: z.string().trim().min(1).max(80).nullable(),
    description: z.string().min(1).max(2000),
    quantity: z.number().int().min(1).max(MAX_QUANTITY),
    due_date: isoDate.nullable(),
    customization: z
      .record(z.string(), z.unknown())
      .nullable()
      .refine((c) => c === null || JSON.stringify(c).length <= 8000, "personalização demasiado grande"),
    test_mode: z.boolean(),
  })
  .strict();

export type ErpOrderPayload = z.infer<typeof erpOrderSchema>;

/** JSON canónico (chaves ordenadas) para comparar reenvios. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

/** Hash do conteúdo de negócio (exclui event_id: reenvio com novo ID mas igual conteúdo = mesmo pedido). */
export function payloadHash(p: ErpOrderPayload): string {
  const { event_id: _e, test_mode: _t, ...rest } = p;
  return createHash("sha256").update(canonicalJson(rest)).digest("hex");
}

export function tokenMatches(provided: string | null | undefined, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b) && provided.length === expected.length;
}

export function testModeAllowed(): boolean {
  return process.env["UP_ERP_ALLOW_TEST_MODE"] === "true";
}

export type DeliveryOutcome = {
  state: "entregue" | "erro" | "incerto";
  code: number | null;
  error: string | null;
};

/** Só é entregue com 2xx E corpo {accepted:true, event_id igual}. */
export function classifyDelivery(
  eventId: string,
  res: { status: number; body: string } | { networkError: string },
): DeliveryOutcome {
  if ("networkError" in res) {
    return { state: "incerto", code: null, error: `Sem resposta: ${res.networkError}`.slice(0, 300) };
  }
  if (res.status >= 200 && res.status < 300) {
    try {
      const j = JSON.parse(res.body);
      if (j?.accepted === true && j?.event_id === eventId) return { state: "entregue", code: res.status, error: null };
    } catch {
      /* cai em incerto */
    }
    return { state: "incerto", code: res.status, error: "Resposta 2xx sem ACK válido (accepted/event_id)" };
  }
  return { state: "erro", code: res.status, error: `HTTP ${res.status}: ${res.body.slice(0, 300)}` };
}
