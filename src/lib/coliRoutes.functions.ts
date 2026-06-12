import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Rotas de Colis (Parte 1 — fundação).
 * Gere structure_coli_routes + structure_coli_stages.
 * Não toca em order_stages nem na produção visual.
 */

export const STAGES = [
  "estrutura","corte","costura","branco","estofagem","qualidade","embalagem","picagem",
] as const;
export type Stage = typeof STAGES[number];

export type ColiRoute = {
  id: string;
  category_code: string;
  structure_code: string;
  coli_number: number;
  coli_name: string;
  stages: { stage: Stage; included: boolean }[];
};

export const listColiRoutes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      category_code: z.string().min(1),
      structure_code: z.string().min(1),
    }).parse(d),
  )
  .handler(async ({ data, context }): Promise<ColiRoute[]> => {
    const sb = context.supabase as any;
    const { data: routes, error } = await sb
      .from("structure_coli_routes")
      .select("id, category_code, structure_code, coli_number, coli_name")
      .eq("category_code", data.category_code)
      .eq("structure_code", data.structure_code)
      .order("coli_number");
    if (error) throw new Error(error.message);
    const ids = (routes ?? []).map((r: any) => r.id);
    let stagesByRoute = new Map<string, { stage: Stage; included: boolean }[]>();
    if (ids.length > 0) {
      const { data: stages, error: e2 } = await sb
        .from("structure_coli_stages")
        .select("route_id, stage, included")
        .in("route_id", ids);
      if (e2) throw new Error(e2.message);
      for (const s of (stages ?? []) as any[]) {
        const arr = stagesByRoute.get(s.route_id) ?? [];
        arr.push({ stage: s.stage as Stage, included: s.included });
        stagesByRoute.set(s.route_id, arr);
      }
    }
    return (routes ?? []).map((r: any) => ({
      ...r,
      stages: stagesByRoute.get(r.id) ?? [],
    }));
  });

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  category_code: z.string().min(1).max(16),
  structure_code: z.string().min(1).max(16),
  coli_number: z.number().int().min(1).max(20),
  coli_name: z.string().min(1).max(120),
  stages: z.array(z.object({ stage: z.enum(STAGES), included: z.boolean() })),
});

export const upsertColiRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => upsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    let routeId = data.id;
    if (routeId) {
      const { error } = await sb
        .from("structure_coli_routes")
        .update({
          category_code: data.category_code,
          structure_code: data.structure_code,
          coli_number: data.coli_number,
          coli_name: data.coli_name,
        })
        .eq("id", routeId);
      if (error) throw new Error(error.message);
    } else {
      const { data: ins, error } = await sb
        .from("structure_coli_routes")
        .insert({
          category_code: data.category_code,
          structure_code: data.structure_code,
          coli_number: data.coli_number,
          coli_name: data.coli_name,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      routeId = ins.id;
    }

    // Substituir etapas
    await sb.from("structure_coli_stages").delete().eq("route_id", routeId);
    if (data.stages.length > 0) {
      const rows = data.stages.map((s, i) => ({
        route_id: routeId,
        stage: s.stage,
        included: s.included,
        sort_order: i,
      }));
      const { error: e2 } = await sb.from("structure_coli_stages").insert(rows);
      if (e2) throw new Error(e2.message);
    }
    return { id: routeId };
  });

export const deleteColiRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("structure_coli_routes")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listCategoriesAndStructures = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const [cats, structs] = await Promise.all([
      sb.from("ref_categories").select("code, name").order("code"),
      sb.from("ref_structures").select("code, name").order("code"),
    ]);
    if (cats.error) throw new Error(cats.error.message);
    if (structs.error) throw new Error(structs.error.message);
    return {
      categories: (cats.data ?? []) as { code: string; name: string }[],
      structures: (structs.data ?? []) as { code: string; name: string }[],
    };
  });