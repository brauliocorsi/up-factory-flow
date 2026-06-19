import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMySession } from "@/lib/operatorAuth.functions";
import { useAuth } from "@/hooks/useAuth";

export type MySession = {
  user_id: string;
  role: "admin" | "operador" | "picador" | null;
  operator: { id: string; code: string; name: string; active: boolean } | null;
};

/**
 * Devolve a role e o operador ligado ao utilizador autenticado.
 * Devolve `null` enquanto carrega ou sem sessão.
 */
export function useMySession() {
  const { session, loading } = useAuth();
  const fetchFn = useServerFn(getMySession);
  const enabled = !!session?.user?.id;
  const q = useQuery({
    queryKey: ["my-session", session?.user?.id],
    queryFn: () => fetchFn() as Promise<MySession>,
    enabled,
    staleTime: 60_000,
  });
  return {
    loading: loading || (enabled && q.isLoading),
    session: q.data ?? null,
    role: q.data?.role ?? null,
    operator: q.data?.operator ?? null,
  };
}