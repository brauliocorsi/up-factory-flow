import { defineTool } from "@lovable.dev/mcp-js";

export default defineTool({
  name: "whoami",
  title: "Quem sou eu",
  description: "Devolve o id e email do utilizador autenticado.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    }
    const userId = ctx.getUserId();
    const email = ctx.getUserEmail() ?? null;
    return {
      content: [{ type: "text", text: JSON.stringify({ user_id: userId, email }) }],
      structuredContent: { user_id: userId, email },
    };
  },
});