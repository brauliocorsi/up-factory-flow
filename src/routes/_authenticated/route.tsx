import { createFileRoute, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app/AppShell";

/**
 * Boundary do layout autenticado. Evita ecrã branco quando algo lança um valor
 * não-Error (ex.: `undefined` ou uma Response) dentro da árvore autenticada.
 */
function AuthedErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  const router = useRouter();
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Erro inesperado. Tenta novamente.";
  return (
    <div className="mx-auto max-w-lg p-6 text-center space-y-3">
      <h2 className="text-lg font-semibold">Algo correu mal</h2>
      <p className="text-sm text-muted-foreground break-words">{message}</p>
      <div className="flex justify-center gap-2 pt-2">
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Tentar novamente
        </button>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Recarregar
        </button>
      </div>
    </div>
  );
}

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