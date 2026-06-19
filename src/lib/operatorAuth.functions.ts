import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Login de operador (Código + PIN).
 *
 * Cria/atualiza um utilizador no Auth com email sintético `op-{code}@upmoveis.local`
 * e password = PIN (6 dígitos). Liga o `user_id` à linha do operador e garante
 * a role 'operador' em user_roles. Admin only.
 */

function emailForCode(code: string) {
  return `op-${code.trim().toLowerCase()}@upmoveis.local`;
}

const setPinSchema = z.object({
  operator_id: z.string().uuid(),
  pin: z.string().regex(/^\d{6}$/, "PIN deve ter exatamente 6 dígitos"),
});

export const setOperatorPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => setPinSchema.parse(d))
  .handler(async ({ data, context }) => {
    // 1) Verificar caller é admin
    const { data: isAdmin, error: roleErr } = await (context.supabase as any)
      .rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Apenas admins podem definir PIN de operador");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 2) Buscar operador
    const { data: op, error: opErr } = await (supabaseAdmin as any)
      .from("operators")
      .select("id, code, name, user_id")
      .eq("id", data.operator_id)
      .maybeSingle();
    if (opErr) throw new Error(opErr.message);
    if (!op) throw new Error("Operador não encontrado");

    const email = emailForCode(op.code);
    let userId: string | null = op.user_id ?? null;

    // 3) Criar utilizador novo OU atualizar password
    if (userId) {
      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: data.pin,
        email,
        email_confirm: true,
      });
      if (updErr) throw new Error(`Falha a atualizar PIN: ${updErr.message}`);
    } else {
      // Pode já existir um utilizador com este email (operador foi removido e re-criado)
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: data.pin,
        email_confirm: true,
        user_metadata: { operator_code: op.code, operator_name: op.name },
      });
      if (createErr) {
        // Procurar por email existente
        const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
        const found = list?.users?.find((u: any) => (u.email ?? "").toLowerCase() === email);
        if (!found) throw new Error(`Falha a criar login: ${createErr.message}`);
        userId = found.id;
        const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userId!, {
          password: data.pin,
          email_confirm: true,
        });
        if (updErr) throw new Error(`Falha a repor PIN: ${updErr.message}`);
      } else {
        userId = created.user!.id;
      }
    }

    // 4) Gravar user_id no operador
    const { error: linkErr } = await (supabaseAdmin as any)
      .from("operators")
      .update({ user_id: userId })
      .eq("id", op.id);
    if (linkErr) throw new Error(linkErr.message);

    // 5) Upsert role 'operador'
    const { error: roleUpErr } = await (supabaseAdmin as any)
      .from("user_roles")
      .upsert({ user_id: userId, role: "operador" }, { onConflict: "user_id,role" });
    if (roleUpErr) throw new Error(roleUpErr.message);

    return { ok: true, user_id: userId };
  });

/**
 * Devolve a role do utilizador da sessão e o operador ligado (se existir).
 */
export const getMySession = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const { data: roles } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const roleList = (roles ?? []).map((r: any) => r.role as string);
    const role: "admin" | "operador" | "picador" | null =
      roleList.includes("admin") ? "admin"
      : roleList.includes("operador") ? "operador"
      : roleList.includes("picador") ? "picador"
      : null;

    const { data: op } = await sb
      .from("operators")
      .select("id, code, name, active")
      .eq("user_id", context.userId)
      .maybeSingle();

    return {
      user_id: context.userId,
      role,
      operator: op ? { id: op.id, code: op.code, name: op.name, active: op.active } : null,
    };
  });