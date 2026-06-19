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

// Rotas permitidas ao picador (só as 3 telas de picagem).
const PICKER_ALLOWED_PREFIXES = ["/picagem"];
function isAllowedForPicker(pathname: string) {
  return PICKER_ALLOWED_PREFIXES.some(
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
    const isPicker = !isAdmin && !isOperator && roleList.includes("picador");

    if (isOperator && !isAllowedForOperator(location.pathname)) {
      throw redirect({ to: "/producao" });
    }
    if (isPicker && !isAllowedForPicker(location.pathname)) {
      throw redirect({ to: "/picagem" });
    }

    return { user: data.user };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});