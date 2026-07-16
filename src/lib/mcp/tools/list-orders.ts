import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_orders",
  title: "Listar encomendas de produção",
  description:
    "Lista as encomendas de produção visíveis ao utilizador autenticado, opcionalmente filtradas por estado.",
  inputSchema: {
    status: z
      .enum(["pendente", "em_producao", "concluida", "cancelada"])
      .optional()
      .describe("Filtro opcional por estado da encomenda."),
    limit: z.coerce.number().int().min(1).max(100).default(20)
      .describe("Nº máximo de encomendas a devolver (1-100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    let q = sb
      .from("production_orders")
      .select("id, order_number, customer_order, product_description, status, due_date, priority")
      .order("priority", { ascending: false })
      .order("entry_date", { ascending: true })
      .limit(limit);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { orders: data ?? [] },
    };
  },
});