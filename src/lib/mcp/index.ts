import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listOrdersTool from "./tools/list-orders";

// Direct Supabase issuer — the .lovable.cloud proxy URL is rejected (RFC 8414
// issuer mismatch). VITE_SUPABASE_PROJECT_ID is inlined by Vite at build time.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "up-producao-mcp",
  title: "UP Produção",
  version: "0.1.0",
  instructions:
    "Ferramentas para consultar encomendas de produção da UP Móveis em nome do utilizador autenticado. Usa `whoami` para verificar sessão e `list_orders` para listar encomendas.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoamiTool, listOrdersTool],
});