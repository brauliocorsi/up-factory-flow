import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app/AppShell";

// Rotas permitidas a operadores. Tudo o resto redireciona para /producao.
const OPERATOR_ALLOWED_PREFIXES = ["/producao", "/picagem", "/retrabalho"];
function isAllowedForOperator(pathname: string) {
  return OPERATOR_ALLOWED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });

    // Buscar role do utilizador
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id);
    const roleList = (roles ?? []).map((r: any) => r.role as string);
    const isAdmin = roleList.includes("admin");
    const isOperator = !isAdmin && roleList.includes("operador");

    if (isOperator && !isAllowedForOperator(location.pathname)) {
      throw redirect({ to: "/producao" });
    }

    return { user: data.user };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});