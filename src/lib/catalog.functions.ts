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
  /** Apenas para models: metros de tecido a consumir por unidade. */
  meters_per_unit?: number | null;
  /** Apenas para models de cama/sommier: estrutura fixa do modelo. */
  structure_code?: string | null;
  /** Apenas para models de sofá: família do sofá. */
  sofa_family_code?: string | null;
  /** Apenas para fabric_refs: código do tipo de tecido. */
  fabric_type_code?: string | null;

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
        ? "id, code, name, active, category_id, meters_per_unit, structure_code, sofa_family_code"
        : data.kind === "fabric_types"
          ? "id, code, name, active, directional"
          : data.kind === "fabric_refs"
            ? "id, code, name, active, fabric_type_id, fabric_type_code"
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
  meters_per_unit: z.number().min(0).nullable().optional(),
  structure_code: z.string().trim().max(8).nullable().optional(),
  sofa_family_code: z.string().trim().max(8).nullable().optional(),
  fabric_type_code: z.string().trim().max(8).nullable().optional(),
});

export const upsertRef = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => upsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const row: any = { code: data.code, name: data.name };
    if (data.active !== undefined) row.active = data.active;
    if (data.kind === "models") {
      row.category_id = data.category_id ?? null;
      if (data.meters_per_unit !== undefined) row.meters_per_unit = data.meters_per_unit;
      if (data.structure_code !== undefined) row.structure_code = data.structure_code;
      if (data.sofa_family_code !== undefined) row.sofa_family_code = data.sofa_family_code;
    }
    if (data.kind === "fabric_types" && data.directional !== undefined) {
      row.directional = data.directional;
    }
    if (data.kind === "fabric_refs") {
      if (data.fabric_type_id !== undefined) row.fabric_type_id = data.fabric_type_id;
      if (data.fabric_type_code !== undefined) row.fabric_type_code = data.fabric_type_code;
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
    let catCodeById = new Map<string, string>();
    let defaultStructure = "01";
    let defaultFamily = "01";
    // Modelos já existentes: a estrutura/família configurada nunca é substituída.
    const existingByKey = new Map<string, { structure_code: string | null; sofa_family_code: string | null }>();
    if (data.kind === "models") {
      const { data: cats } = await context.supabase
        .from("ref_categories")
        .select("id, code");
      catMap = new Map((cats ?? []).map((c: any) => [c.code, c.id]));
      catCodeById = new Map((cats ?? []).map((c: any) => [c.id, c.code]));
      const [{ data: sts }, { data: fams }] = await Promise.all([
        context.supabase.from("ref_structures").select("code").eq("active", true).order("code").limit(1),
        (context.supabase as any).from("ref_sofa_families").select("code").eq("active", true).order("code").limit(1),
      ]);
      defaultStructure = (sts as any)?.[0]?.code ?? "01";
      defaultFamily = (fams as any)?.[0]?.code ?? "01";
      const { data: existing } = await (context.supabase as any)
        .from("models")
        .select("code, category_id, structure_code, sofa_family_code");
      for (const m of (existing as any[]) ?? []) {
        existingByKey.set(`${m.category_id ?? ""}|${m.code}`, {
          structure_code: m.structure_code ?? null,
          sofa_family_code: m.sofa_family_code ?? null,
        });
      }
    }
    const payload = data.rows.map((r) => {
      const base: any = { code: r.code, name: r.name, active: true };
      if (data.kind === "models") {
        base.category_id = r.category_code ? catMap.get(r.category_code) ?? null : null;
        const catCode = base.category_id ? catCodeById.get(base.category_id) ?? r.category_code ?? "" : (r.category_code ?? "");
        // O modelo tem sempre estrutura fixa (ou família, nos sofás).
        // Modelos já existentes mantêm a que foi configurada.
        const prev = existingByKey.get(`${base.category_id ?? ""}|${r.code}`);
        if ((catCode ?? "").toUpperCase() === "SOF") {
          base.sofa_family_code = prev?.sofa_family_code ?? defaultFamily;
        } else {
          base.structure_code = prev?.structure_code ?? defaultStructure;
        }
      }
      return base;
    });
    const { error, count } = await context.supabase
      .from(table as any)
      .upsert(payload, {
        onConflict: data.kind === "models" ? "category_id,code" : "code",
        count: "exact",
      });
    if (error) throw new Error(error.message);
    return { inserted: count ?? payload.length };
  });

// Used by the order form to fetch all catalogs in one shot.
export const getCatalogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const s = context.supabase as any;
    const [cats, models, structures, measures, fts, frs, colors, links, families, fabrics] =
      await Promise.all([
        s.from("ref_categories").select("id, code, name, active").eq("active", true).order("code"),
        s
          .from("models")
          .select("id, code, name, active, category_id, meters_per_unit, structure_code, sofa_family_code")
          .eq("active", true)
          .order("code"),
        s.from("ref_structures").select("id, code, name, active").eq("active", true).order("code"),
        s.from("ref_measures").select("id, code, name, active").eq("active", true).order("code"),
        s.from("ref_fabric_types").select("id, code, name, active").eq("active", true).order("code"),
        s
          .from("ref_fabric_refs")
          .select("id, code, name, active, fabric_type_id, fabric_type_code")
          .eq("active", true)
          .order("code"),
        s.from("ref_colors").select("id, code, name, active").eq("active", true).order("code"),
        s.from("model_structures").select("model_id, structure_id"),
        s.from("ref_sofa_families").select("id, code, name, active").eq("active", true).order("code"),
        s
          .from("fabrics")
          .select("ref_tec, fabric_type_code, fabric_ref_code, supplier_ref, color_code, active")
          .eq("active", true)
          .order("ref_tec"),
      ]);
    const byStructure = new Map<string, string[]>();
    for (const l of links.data ?? []) {
      const arr = byStructure.get(l.structure_id) ?? [];
      arr.push(l.model_id);
      byStructure.set(l.structure_id, arr);
    }
    const structuresList = (structures.data ?? []).map((r: any) => ({ ...r, model_ids: byStructure.get(r.id) ?? [] }));
    return {
      categories: cats.data ?? [],
      models: models.data ?? [],
      structures: structuresList,
      measures: measures.data ?? [],
      fabric_types: fts.data ?? [],
      fabric_refs: frs.data ?? [],
      colors: colors.data ?? [],
      sofa_families: families.data ?? [],
      fabrics: fabrics.data ?? [],
    };
  });

// ---------- Tecidos (fabrics: coleção + referência do fornecedor + cor) ----------

export type FabricRow = {
  ref_tec: string;
  fabric_type_code: string;
  fabric_ref_code: string;
  supplier_ref: string;
  color_code: string | null;
  active: boolean;
};

export const listFabrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FabricRow[]> => {
    const { data, error } = await (context.supabase as any)
      .from("fabrics")
      .select("ref_tec, fabric_type_code, fabric_ref_code, supplier_ref, color_code, active")
      .order("ref_tec");
    if (error) throw new Error(error.message);
    return (data ?? []) as FabricRow[];
  });

const fabricSchema = z.object({
  ref_tec: z.string().trim().max(12).optional().nullable(),
  fabric_ref_code: z.string().trim().min(1).max(8),
  supplier_ref: z.string().trim().min(1).max(120),
  color_code: z.string().trim().max(8).nullable().optional(),
  active: z.boolean().optional(),
});

export const upsertFabric = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => fabricSchema.parse(d))
  .handler(async ({ data, context }) => {
    const s = context.supabase as any;
    // O tipo de tecido vem sempre da coleção — nunca é escolhido à mão.
    const { data: coll, error: cErr } = await s
      .from("ref_fabric_refs")
      .select("code, fabric_type_code")
      .eq("code", data.fabric_ref_code)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!coll) throw new Error("Coleção de tecido não encontrada.");
    const row: any = {
      fabric_type_code: coll.fabric_type_code,
      fabric_ref_code: data.fabric_ref_code,
      supplier_ref: data.supplier_ref,
      color_code: data.color_code ?? null,
    };
    if (data.active !== undefined) row.active = data.active;
    if (data.ref_tec) {
      const { error } = await s.from("fabrics").update(row).eq("ref_tec", data.ref_tec);
      if (error) throw new Error(error.message);
      return { ref_tec: data.ref_tec };
    }
    const { data: ins, error } = await s.from("fabrics").insert(row).select("ref_tec").single();
    if (error) throw new Error(error.message);
    return { ref_tec: (ins as any).ref_tec as string };
  });

export const setFabricActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ ref_tec: z.string().trim().min(1).max(12), active: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("fabrics")
      .update({ active: data.active })
      .eq("ref_tec", data.ref_tec);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Famílias de sofá (01 Simples, 02 Deslizante, 03 Sofá-Cama). */
export const listSofaFamilies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("ref_sofa_families")
      .select("code, name, active")
      .order("code");
    if (error) throw new Error(error.message);
    return (data ?? []) as { code: string; name: string; active: boolean }[];
  });

// ---------- Catálogo de tecidos (fabric_catalog) — MESMA lista do Stock ----------

export type FabricCatalogRow = {
  ref_tec: string;
  name: string;
  supplier_ref: string | null;
  supplier_number: string | null;
  fabric_type: string;
  collection: string;
  color: string | null;
  color_code: string | null;
  price_class: string | null;
  meters: number;
  min_meters: number;
  location: string | null;
  needs_review: string | null;
  active: boolean;
};

/** Lista completa (ativos e inativos) do catálogo de tecidos. */
export const listFabricCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FabricCatalogRow[]> => {
    const { data, error } = await (context.supabase as any)
      .from("fabric_catalog")
      .select(
        "ref_tec, name, supplier_ref, supplier_number, fabric_type, collection, color, color_code, price_class, meters, min_meters, location, needs_review, active",
      )
      .order("name")
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      ...r,
      meters: Number(r.meters ?? 0),
      min_meters: Number(r.min_meters ?? 0),
    })) as FabricCatalogRow[];
  });

const fabricCatalogSchema = z.object({
  ref_tec: z.string().trim().max(32).optional().nullable(),
  name: z.string().trim().min(1).max(160),
  fabric_type: z.string().trim().min(1).max(60),
  collection: z.string().trim().min(1).max(60),
  supplier_ref: z.string().trim().max(160).optional().nullable(),
  supplier_number: z.string().trim().max(20).optional().nullable(),
  color: z.string().trim().max(60).optional().nullable(),
  price_class: z.string().trim().max(4).optional().nullable(),
  min_meters: z.number().min(0).max(100000).optional(),
  location: z.string().trim().max(60).optional().nullable(),
});

/** Cria ou edita a ficha de um tecido. Os metros nunca são alterados aqui (só no Stock). */
export const upsertFabricCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => fabricCatalogSchema.parse(d))
  .handler(async ({ data, context }) => {
    const s = context.supabase as any;
    const row: any = {
      name: data.name,
      fabric_type: data.fabric_type,
      collection: data.collection,
      supplier_ref: data.supplier_ref?.trim() || null,
      supplier_number: data.supplier_number?.trim() || null,
      color: data.color?.trim() || null,
      price_class: data.price_class?.trim() || null,
      location: data.location?.trim() || null,
    };
    if (data.min_meters !== undefined) row.min_meters = data.min_meters;

    if (data.ref_tec) {
      const { error } = await s.from("fabric_catalog").update(row).eq("ref_tec", data.ref_tec);
      if (error) throw new Error(error.message);
      return { ref_tec: data.ref_tec };
    }
    // Código novo: TEC + sequência de 6 dígitos a seguir ao maior existente.
    const { data: last, error: lErr } = await s
      .from("fabric_catalog")
      .select("ref_tec")
      .order("ref_tec", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lErr) throw new Error(lErr.message);
    const n = Number(String(last?.ref_tec ?? "TEC000000").replace(/\D/g, "")) + 1;
    const ref_tec = `TEC${String(n).padStart(6, "0")}`;
    const { error } = await s
      .from("fabric_catalog")
      .insert({ ...row, ref_tec, meters: 0, min_meters: row.min_meters ?? 0, active: true });
    if (error) throw new Error(error.message);
    return { ref_tec };
  });

export const setFabricCatalogActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ ref_tec: z.string().trim().min(1).max(32), active: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("fabric_catalog")
      .update({ active: data.active })
      .eq("ref_tec", data.ref_tec);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
