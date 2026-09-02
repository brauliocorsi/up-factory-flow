/**
 * Guardas de role reutilizáveis para server functions (Camada C de segurança).
 * Chamar sempre dentro do handler, com o `context` do requireSupabaseAuth.
 */
export type AppRole = "admin" | "escritorio" | "operador" | "picador";

export async function hasAnyRole(context: any, roles: AppRole[]): Promise<boolean> {
  const sb = context.supabase as any;
  const results = await Promise.all(
    roles.map((role) => sb.rpc("has_role", { _user_id: context.userId, _role: role }))
  );
  return results.some((r: any) => r?.data === true);
}

/** Lança erro claro quando o utilizador autenticado não tem nenhuma das roles. */
export async function assertAnyRole(context: any, roles: AppRole[], label: string) {
  const ok = await hasAnyRole(context, roles);
  if (!ok) throw new Error(`Sem permissão para ${label} (roles permitidas: ${roles.join(", ")})`);
}
