import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { ParseCatalog } from "./productParse";

/** Catálogo necessário para reconhecer produtos a partir de texto livre. */
export const getParseCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ParseCatalog> => {
    const s = context.supabase as any;
    const [cats, models, structures, families, measures, collections, fabrics, colors] = await Promise.all([
      s.from("ref_categories").select("id, code, name").eq("active", true),
      s
        .from("models")
        .select("id, code, name, active, category_id, structure_code, sofa_family_code")
        .eq("active", true),
      s.from("ref_structures").select("code, name").eq("active", true),
      s.from("ref_sofa_families").select("code, name").eq("active", true),
      s.from("ref_measures").select("code, name").eq("active", true),
      s.from("ref_fabric_refs").select("code, name, fabric_type_code").eq("active", true),
      s
        .from("fabrics")
        .select("ref_tec, fabric_ref_code, fabric_type_code, supplier_ref, color_code")
        .eq("active", true),
      s.from("ref_colors").select("code, name").eq("active", true),
    ]);
    const catById = new Map<string, string>((cats.data ?? []).map((c: any) => [c.id, c.code]));
    return {
      models: (models.data ?? []).map((m: any) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        category_code: catById.get(m.category_id) ?? "",
        structure_code: m.structure_code,
        sofa_family_code: m.sofa_family_code,
      })),
      structures: structures.data ?? [],
      sofa_families: families.data ?? [],
      measures: measures.data ?? [],
      collections: collections.data ?? [],
      fabrics: fabrics.data ?? [],
      colors: colors.data ?? [],
    };
  });

const importRowSchema = z.object({
  order_number: z.string().trim().max(64).nullable().optional(),
  product_description: z.string().trim().min(1).max(500),
  product_code: z.string().trim().max(64).nullable().optional(),
  model_id: z.string().uuid().nullable().optional(),
  measure_code: z.string().trim().max(8).nullable().optional(),
  /** Medida atípica (ex.: "210x170") a criar na gama 5xx. */
  measure_new: z.string().trim().max(32).nullable().optional(),
  width_cm: z.number().int().min(30).max(900).nullable().optional(),
  ref_tec: z.string().trim().max(12).nullable().optional(),
  structure_name: z.string().trim().max(120).nullable().optional(),
  fabric_type: z.string().trim().max(120).nullable().optional(),
  fabric_ref: z.string().trim().max(120).nullable().optional(),
  color: z.string().trim().max(60).nullable().optional(),
  finishing: z.enum(["F", "N"]).nullable().optional(),
  customization: z.string().trim().max(500).nullable().optional(),
  quantity: z.coerce.number().int().min(1).max(200).default(1),
  due_date: z.string().trim().max(20).nullable().optional(),
  observation: z.string().trim().max(500).nullable().optional(),
});

export type ProductImportRow = z.infer<typeof importRowSchema>;

const confirmSchema = z.object({
  intent_id: z.string().trim().min(6).max(120),
  rows: z.array(importRowSchema).min(1).max(2000),
});

export type ProductImportResult = {
  ok: boolean;
  created: number;
  skipped: Array<{ order_number: string; reason: string }>;
  created_measures: Array<{ code: string; name: string }>;
  order_numbers: string[];
  reused: boolean;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export const confirmProductImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => confirmSchema.parse(d))
  .handler(async ({ data, context }): Promise<ProductImportResult> => {
    const s = context.supabase as any;
    const { userId } = context;

    // Idempotência: o mesmo intent_id nunca importa duas vezes.
    const { data: prev } = await s
      .from("import_batches")
      .select("id, status, created_count, result")
      .eq("intent_id", data.intent_id)
      .maybeSingle();
    if (prev && prev.status === "concluido") {
      return {
        ok: true,
        created: prev.created_count ?? 0,
        skipped: (prev.result?.skipped ?? []) as any[],
        created_measures: (prev.result?.created_measures ?? []) as any[],
        order_numbers: (prev.result?.order_numbers ?? []) as string[],
        reused: true,
      };
    }
    if (!prev) {
      const { error: bErr } = await s.from("import_batches").insert({
        intent_id: data.intent_id,
        user_id: userId,
        rows_count: data.rows.length,
        created_count: 0,
        status: "em_curso",
      });
      if (bErr) throw new Error(bErr.message);
    }

    // Medidas atípicas: criadas na gama 5xx (sob-medida).
    const createdMeasures: Array<{ code: string; name: string }> = [];
    const newMeasures = Array.from(
      new Set(data.rows.map((r) => (r.measure_new ?? "").trim()).filter(Boolean)),
    );
    const measureByName = new Map<string, string>();
    if (newMeasures.length > 0) {
      const { data: existing } = await s.from("ref_measures").select("code, name");
      const rows = (existing ?? []) as Array<{ code: string; name: string }>;
      for (const r of rows) measureByName.set(r.name.replace(/\s|cm/gi, ""), r.code);
      let next = 500;
      for (const r of rows) {
        const m = /^5(\d{2})$/.exec(r.code);
        if (m) next = Math.max(next, 500 + Number(m[1]));
      }
      for (const name of newMeasures) {
        if (measureByName.has(name)) continue;
        next += 1;
        const code = String(next);
        const { error } = await s.from("ref_measures").insert({ code, name, active: true });
        if (error) throw new Error(error.message);
        measureByName.set(name, code);
        createdMeasures.push({ code, name });
      }
    }

    // Números de encomenda já existentes: usados para numerar sufixos.
    const bases = Array.from(
      new Set(data.rows.map((r) => (r.order_number ?? "").trim()).filter(Boolean)),
    );
    const taken = new Set<string>();
    if (bases.length > 0) {
      const { data: existing } = await s
        .from("production_orders")
        .select("order_number")
        .or(bases.map((b) => `order_number.like.${b}%`).join(","));
      for (const r of (existing ?? []) as Array<{ order_number: string }>) taken.add(r.order_number);
    }

    const { data: allMeasures } = await s.from("ref_measures").select("code, name");
    const measureNameByCode = new Map<string, string>(
      ((allMeasures ?? []) as Array<{ code: string; name: string }>).map((m) => [m.code, m.name]),
    );

    const today = new Date().toISOString().slice(0, 10);
    const skipped: Array<{ order_number: string; reason: string }> = [];
    const payload: any[] = [];

    for (const r of data.rows) {
      const base = (r.order_number ?? "").trim() || `IMP-${Date.now().toString(36).toUpperCase()}`;
      const measureCode = r.measure_code ?? (r.measure_new ? measureByName.get(r.measure_new) ?? null : null);
      const productCode = (r.product_code ?? "").trim();
      const finalCode =
        productCode && measureCode && r.measure_new
          ? productCode // o código foi gerado no ecrã com a medida escolhida
          : productCode;
      for (let i = 0; i < (r.quantity ?? 1); i++) {
        let num = base;
        if (taken.has(num) || (r.quantity ?? 1) > 1) {
          let seq = 1;
          while (taken.has(`${base}-${pad2(seq)}`)) seq += 1;
          num = `${base}-${pad2(seq)}`;
        }
        if (taken.has(num)) {
          skipped.push({ order_number: num, reason: "Número já existente" });
          continue;
        }
        taken.add(num);
        payload.push({
          order_number: num,
          customer_order: base,
          product_description: r.product_description,
          model_id: r.model_id ?? null,
          measure: r.width_cm
            ? `${r.width_cm}cm`
            : measureCode
              ? measureNameByCode.get(measureCode) ?? r.measure_new ?? null
              : r.measure_new ?? null,
          structure_type: r.structure_name ?? null,
          fabric_type: r.fabric_type ?? null,
          fabric_ref: r.fabric_ref ?? null,
          color: r.color ?? null,
          finishing: r.finishing ?? null,
          ref_tec: r.ref_tec ?? null,
          customization: r.customization ?? null,
          observation: r.observation ?? null,
          barcode: finalCode ? `${finalCode}-${num}` : null,
          entry_date: today,
          due_date: r.due_date || null,
          priority: 0,
          line_kind: "catalogo",
          created_by: userId,
        });
      }
    }

    const inserted: string[] = [];
    for (let i = 0; i < payload.length; i += 200) {
      const chunk = payload.slice(i, i + 200);
      const { data: ins, error } = await s.from("production_orders").insert(chunk).select("order_number");
      if (error) throw new Error(error.message);
      for (const row of (ins ?? []) as Array<{ order_number: string }>) inserted.push(row.order_number);
    }

    const result = { skipped, created_measures: createdMeasures, order_numbers: inserted };
    await s
      .from("import_batches")
      .update({ status: "concluido", created_count: inserted.length, result })
      .eq("intent_id", data.intent_id);

    return { ok: true, created: inserted.length, skipped, created_measures: createdMeasures, order_numbers: inserted, reused: false };
  });
