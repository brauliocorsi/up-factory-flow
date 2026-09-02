import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Painel público da fábrica.
 * Endpoint público protegido por código de acesso (segredo do servidor).
 * Devolve apenas dados agregados + nome do operador e nº de encomenda.
 */

export type PanelOperator = {
  operator_name: string;
  order_number: string;
  stage: string;
  is_paused: boolean;
  started_at: string | null;
  last_resume_at: string | null;
  productive_seconds: number;
};

export type PanelData = {
  server_time: string;
  productive_minutes_today: number;
  stages_done_today: number;
  active_operators: number;
  orders_due_today: number;
  orders_due_done: number;
  sla_expected_minutes: number;
  sla_actual_minutes: number;
  blocks: Array<{ block: number; minutes: number }>;
  operators: PanelOperator[];
};

export type PanelResult =
  | { ok: true; data: PanelData }
  | { ok: false; reason: "codigo_invalido" | "nao_configurado" | "erro"; message: string };

const schema = z.object({ code: z.string().min(1).max(200) });

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const getPublicPanel = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => schema.parse(d))
  .handler(async ({ data }): Promise<PanelResult> => {
    const expected = process.env["FACTORY_PANEL_CODE"];
    if (!expected) {
      return { ok: false, reason: "nao_configurado", message: "Código do painel não está configurado." };
    }
    if (!safeEqual(data.code.trim(), expected.trim())) {
      return { ok: false, reason: "codigo_invalido", message: "Código de acesso inválido." };
    }

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: payload, error } = await supabaseAdmin.rpc("get_public_factory_panel" as never);
      if (error) return { ok: false, reason: "erro", message: error.message };
      return { ok: true, data: payload as unknown as PanelData };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erro inesperado";
      return { ok: false, reason: "erro", message };
    }
  });
