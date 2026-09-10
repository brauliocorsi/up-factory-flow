import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Gestão de acessos de escritório/admin (email + password).
 * Apenas admins podem listar, criar, alterar role, repor password ou remover.
 */

const staffRole = z.enum(["admin", "escritorio"]);

async function assertAdmin(context: any) {
  const { data: isAdmin, error } = await (context.supabase as any)
    .rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!isAdmin) throw new Error("Apenas admins podem gerir acessos de escritório");
}

export const listStaffUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roles, error: rolesErr } = await (supabaseAdmin as any)
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["admin", "escritorio"]);
    if (rolesErr) throw new Error(rolesErr.message);

    const byUser = new Map<string, string[]>();
    for (const r of roles ?? []) {
      const list = byUser.get(r.user_id) ?? [];
      list.push(r.role);
      byUser.set(r.user_id, list);
    }
    if (byUser.size === 0) return [];

    const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (listErr) throw new Error(listErr.message);

    return (list?.users ?? [])
      .filter((u: any) => byUser.has(u.id))
      .map((u: any) => {
        const rs = byUser.get(u.id) ?? [];
        return {
          id: u.id as string,
          email: (u.email ?? "") as string,
          name: (u.user_metadata?.full_name ?? "") as string,
          role: (rs.includes("admin") ? "admin" : "escritorio") as "admin" | "escritorio",
          created_at: u.created_at as string,
          last_sign_in_at: (u.last_sign_in_at ?? null) as string | null,
          is_self: u.id === context.userId,
        };
      })
      .sort((a, b) => a.email.localeCompare(b.email));
  });

const createSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(8, "A password deve ter pelo menos 8 caracteres"),
  name: z.string().trim().max(120).optional(),
  role: staffRole,
});

export const createStaffUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.trim().toLowerCase();

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.name ?? "" },
    });

    let userId = created?.user?.id ?? null;
    if (createErr) {
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const found = list?.users?.find((u: any) => (u.email ?? "").toLowerCase() === email);
      if (!found) return { ok: false as const, message: `Não foi possível criar o acesso: ${createErr.message}` };
      return { ok: false as const, message: "Já existe um acesso com este email." };
    }
    if (!userId) return { ok: false as const, message: "Não foi possível criar o acesso." };

    const { error: roleErr } = await (supabaseAdmin as any)
      .from("user_roles")
      .upsert({ user_id: userId, role: data.role }, { onConflict: "user_id,role" });
    if (roleErr) return { ok: false as const, message: roleErr.message };

    return { ok: true as const, user_id: userId };
  });

const roleSchema = z.object({ user_id: z.string().uuid(), role: staffRole });

export const setStaffRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => roleSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.user_id === context.userId && data.role !== "admin") {
      return { ok: false as const, message: "Não pode retirar o seu próprio acesso de admin." };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error: delErr } = await (supabaseAdmin as any)
      .from("user_roles")
      .delete()
      .eq("user_id", data.user_id)
      .in("role", ["admin", "escritorio"]);
    if (delErr) return { ok: false as const, message: delErr.message };

    const { error: insErr } = await (supabaseAdmin as any)
      .from("user_roles")
      .upsert({ user_id: data.user_id, role: data.role }, { onConflict: "user_id,role" });
    if (insErr) return { ok: false as const, message: insErr.message };

    return { ok: true as const };
  });

const passwordSchema = z.object({
  user_id: z.string().uuid(),
  password: z.string().min(8, "A password deve ter pelo menos 8 caracteres"),
});

export const resetStaffPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => passwordSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password: data.password,
    });
    if (error) return { ok: false as const, message: error.message };
    return { ok: true as const };
  });

export const deleteStaffUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.user_id === context.userId) {
      return { ok: false as const, message: "Não pode remover o seu próprio acesso." };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: op } = await (supabaseAdmin as any)
      .from("operators")
      .select("id")
      .eq("user_id", data.user_id)
      .maybeSingle();
    if (op) {
      return {
        ok: false as const,
        message: "Este acesso pertence a um operador. Gerir na lista de operadores.",
      };
    }

    await (supabaseAdmin as any).from("user_roles").delete().eq("user_id", data.user_id);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) return { ok: false as const, message: error.message };
    return { ok: true as const };
  });
