import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type RefKind =
  | "categories"
  | "models"
  | "structures"
  | "measures"
  | "fabric_types"
  | "fabric_refs"
  | "colors";

export const REF_TABLE: Record<RefKind, string> = {
  categories: "ref_categories",
  models: "models",
  structures: "ref_structures",
  measures: "ref_measures",
  fabric_types: "ref_fabric_types",
  fabric_refs: "ref_fabric_refs",
  colors: "ref_colors",
};

export type RefRow = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  category_id?: string | null;
  /** Apenas para fabric_types: corte no sentido do veio. */
  directional?: boolean;
  /** Apenas para fabric_refs: tipo de tecido vinculado. */
  fabric_type_id?: string | null;
  /** Apenas para structures: modelos vinculados. */
  model_ids?: string[];
};

const kindSchema = z.enum([
  "categories",
  "models",
  "structures",
  "measures",
  "fabric_types",
  "fabric_refs",
  "colors",
]);

export const listRef = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ kind: kindSchema }).parse(d))
  .handler(async ({ data, context }): Promise<RefRow[]> => {
    const cols =
      data.kind === "models"
        ? "id, code, name, active, category_id"
        : data.kind === "fabric_types"
          ? "id, code, name, active, directional"
          : data.kind === "fabric_refs"
            ? "id, code, name, active, fabric_type_id"
            : "id, code, name, active";
    const { data: rows, error } = await (context.supabase as any)
      .from(REF_TABLE[data.kind])
      .select(cols)
      .order("code");
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as RefRow[];
    if (data.kind === "structures" && list.length > 0) {
      const ids = list.map((r) => r.id);
      const { data: links } = await (context.supabase as any)
        .from("model_structures")
        .select("structure_id, model_id")
        .in("structure_id", ids);
      const byStructure = new Map<string, string[]>();
      for (const l of (links as any[]) ?? []) {
        const arr = byStructure.get(l.structure_id) ?? [];
        arr.push(l.model_id);
        byStructure.set(l.structure_id, arr);
      }
      for (const r of list) r.model_ids = byStructure.get(r.id) ?? [];
    }
    return list;
  });

const upsertSchema = z.object({
  kind: kindSchema,
  id: z.string().uuid().optional(),
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(120),
  active: z.boolean().optional(),
  category_id: z.string().uuid().nullable().optional(),
  directional: z.boolean().optional(),
  fabric_type_id: z.string().uuid().nullable().optional(),
  model_ids: z.array(z.string().uuid()).optional(),
});

export const upsertRef = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => upsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const row: any = { code: data.code, name: data.name };
    if (data.active !== undefined) row.active = data.active;
    if (data.kind === "models") row.category_id = data.category_id ?? null;
    if (data.kind === "fabric_types" && data.directional !== undefined) {
      row.directional = data.directional;
    }
    if (data.kind === "fabric_refs" && data.fabric_type_id !== undefined) {
      row.fabric_type_id = data.fabric_type_id;
    }
    const table = REF_TABLE[data.kind];
    let structureId: string | undefined = data.id;
    if (data.id) {
      const { error } = await context.supabase.from(table as any).update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { data: ins, error } = await context.supabase
        .from(table as any)
        .insert(row)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      structureId = (ins as any).id as string;
    }
    if (data.kind === "structures" && data.model_ids && structureId) {
      const sid = structureId;
      const { error: delErr } = await (context.supabase as any)
        .from("model_structures")
        .delete()
        .eq("structure_id", sid);
      if (delErr) throw new Error(delErr.message);
      if (data.model_ids.length) {
        const payload = data.model_ids.map((mid) => ({ structure_id: sid, model_id: mid }));
        const { error: insErr } = await (context.supabase as any)
          .from("model_structures")
          .insert(payload);
        if (insErr) throw new Error(insErr.message);
      }
    }
    return { id: structureId };
  });

export const deleteRef = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ kind: kindSchema, id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from(REF_TABLE[data.kind] as any)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const bulkSchema = z.object({
  kind: kindSchema,
  rows: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(32),
        name: z.string().trim().min(1).max(120),
        category_code: z.string().trim().max(32).optional().nullable(),
      }),
    )
    .min(1)
    .max(2000),
});

export const bulkImportRef = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => bulkSchema.parse(d))
  .handler(async ({ data, context }) => {
    const table = REF_TABLE[data.kind];
    let catMap = new Map<string, string>();
    if (data.kind === "models") {
      const { data: cats } = await context.supabase
        .from("ref_categories")
        .select("id, code");
      catMap = new Map((cats ?? []).map((c: any) => [c.code, c.id]));
    }
    const payload = data.rows.map((r) => {
      const base: any = { code: r.code, name: r.name, active: true };
      if (data.kind === "models") {
        base.category_id = r.category_code ? catMap.get(r.category_code) ?? null : null;
      }
      return base;
    });
    const { error, count } = await context.supabase
      .from(table as any)
      .upsert(payload, { onConflict: "code", count: "exact" });
    if (error) throw new Error(error.message);
    return { inserted: count ?? payload.length };
  });

// Used by the order form to fetch all catalogs in one shot.
export const getCatalogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const s = context.supabase as any;
    const [cats, models, structures, measures, fts, frs, colors] = await Promise.all([
      s.from("ref_categories").select("id, code, name, active").eq("active", true).order("code"),
      s.from("models").select("id, code, name, active, category_id").eq("active", true).order("code"),
      s.from("ref_structures").select("id, code, name, active").eq("active", true).order("code"),
      s.from("ref_measures").select("id, code, name, active").eq("active", true).order("code"),
      s.from("ref_fabric_types").select("id, code, name, active").eq("active", true).order("code"),
      s.from("ref_fabric_refs").select("id, code, name, active, fabric_type_id").eq("active", true).order("code"),
      s.from("ref_colors").select("id, code, name, active").eq("active", true).order("code"),
    ]);
    return {
      categories: cats.data ?? [],
      models: models.data ?? [],
      structures: structures.data ?? [],
      measures: measures.data ?? [],
      fabric_types: fts.data ?? [],
      fabric_refs: frs.data ?? [],
      colors: colors.data ?? [],
    };
  });