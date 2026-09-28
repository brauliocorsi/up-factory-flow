import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { buildBedCode, buildSofaCode, buildSommierCode, type SofaVariant } from "@/lib/productCodes";

export type ModelPackage = {
  id: string;
  model_id: string;
  structure_type: string | null;
  package_number: number;
  package_total: number;
  package_name: string;
};

export const listPackagesByModel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ model_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<ModelPackage[]> => {
    const { data: rows, error } = await context.supabase
      .from("model_packages")
      .select("id, model_id, structure_type, package_number, package_total, package_name")
      .eq("model_id", data.model_id)
      .order("structure_type", { ascending: true, nullsFirst: true })
      .order("package_number");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listAllPackages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ModelPackage[]> => {
    const { data, error } = await context.supabase
      .from("model_packages")
      .select("id, model_id, structure_type, package_number, package_total, package_name")
      .order("model_id")
      .order("package_number");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  model_id: z.string().uuid(),
  structure_type: z.string().trim().max(120).nullable().optional(),
  package_number: z.coerce.number().int().min(1).max(20),
  package_total: z.coerce.number().int().min(1).max(20),
  package_name: z.string().trim().min(1).max(120),
});

export const upsertPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => upsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const row = {
      model_id: data.model_id,
      structure_type: data.structure_type || null,
      package_number: data.package_number,
      package_total: data.package_total,
      package_name: data.package_name,
    };
    if (data.id) {
      const { error } = await context.supabase.from("model_packages").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: inserted, error } = await context.supabase
      .from("model_packages").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    return inserted;
  });

export const deletePackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("model_packages").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Label data: orders + their colis ----------

export type LabelRow = {
  order: {
    id: string;
    order_number: string;
    barcode: string | null;
    /** Código comercial completo, sem o sufixo do número da encomenda. */
    product_code: string | null;
    product_description: string;
    measure: string | null;
    fabric_type: string | null;
    fabric_ref: string | null;
    color: string | null;
    structure_type: string | null;
    model_name: string | null;
    observation: string | null;
  };
  packages: ModelPackage[]; // [] when none defined for the model
  /** Volumes reais desta encomenda (order_colis). Preferidos na etiqueta. */
  colis: { id: string; coli_number: number; coli_name: string; coli_barcode: string }[];
  /** Total real de volumes da encomenda (mesmo quando só se imprime um). */
  coli_total: number;
};

export const getLabelsForOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(200),
        coli_ids: z.array(z.string().uuid()).max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<LabelRow[]> => {
    const { supabase } = context;
    const { data: orders, error } = await (supabase as any)
      .from("production_orders")
      .select(
        "id, order_number, barcode, product_description, measure, fabric_type, fabric_ref, fabric_ref_tec, color, structure_type, model_id, observation, finishing, models(name, code, structure_code, sofa_family_code, ref_categories(code))",
      )
      .in("id", data.ids);
    if (error) throw new Error(error.message);

    const modelIds: string[] = Array.from(
      new Set((orders ?? []).map((o: any) => o.model_id).filter(Boolean)),
    );

    const { data: measures, error: measuresError } = await supabase
      .from("ref_measures")
      .select("code, name")
      .eq("active", true);
    if (measuresError) throw new Error(measuresError.message);

    let pkgs: any[] = [];
    if (modelIds.length) {
      const { data: p, error: pe } = await supabase
        .from("model_packages")
        .select("id, model_id, structure_type, package_number, package_total, package_name")
        .in("model_id", modelIds);
      if (pe) throw new Error(pe.message);
      pkgs = p ?? [];
    }

    // Volumes reais (order_colis) — a etiqueta do posto de embalagem tem de
    // identificar o volume verdadeiro, com o código lido na picagem.
    // Lê sempre TODOS os volumes da encomenda: o total "N de M" tem de ser o
    // real, mesmo quando só se imprime a etiqueta de um volume.
    let allColis: any[] = [];
    {
      const { data: c, error: ce } = await (supabase as any)
        .from("order_colis")
        .select("id, order_id, coli_number, coli_name, coli_barcode")
        .in("order_id", data.ids);
      if (ce) throw new Error(ce.message);
      allColis = c ?? [];
    }
    const selectedIds = data.coli_ids?.length ? new Set(data.coli_ids) : null;
    const colis = selectedIds ? allColis.filter((c) => selectedIds.has(c.id)) : allColis;

    // Preserve requested order
    const byId = new Map<string, any>((orders ?? []).map((o: any) => [o.id, o]));
    return data.ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((o: any) => {
        const candidates = pkgs.filter((p) => p.model_id === o.model_id);
        // If structure_type matches, prefer those; else fall back to null structure_type
        const matched = candidates.filter(
          (p) => p.structure_type && o.structure_type && p.structure_type === o.structure_type,
        );
        const generic = candidates.filter((p) => !p.structure_type);
        const chosen = matched.length ? matched : generic.length ? generic : candidates;
        const rawBarcode = String(o.barcode ?? "").trim();
        const orderSuffix = `-${o.order_number}`;
        const productCode = rawBarcode.endsWith(orderSuffix)
          ? rawBarcode.slice(0, -orderSuffix.length)
          : /^(CAM|SOF|SOM)[A-Z0-9]+$/i.test(rawBarcode)
            ? rawBarcode
            : buildProductCode(o, measures ?? []);
        return {
          order: {
            id: o.id,
            order_number: o.order_number,
            barcode: o.barcode,
            product_code: productCode,
            product_description: o.product_description,
            measure: o.measure,
            fabric_type: o.fabric_type,
            fabric_ref: o.fabric_ref,
            color: o.color,
            structure_type: o.structure_type,
            model_name: o.models?.name ?? null,
            observation: o.observation ?? null,
          },
          packages: chosen.sort((a, b) => a.package_number - b.package_number),
          colis: colis
            .filter((c) => c.order_id === o.id)
            .sort((a, b) => a.coli_number - b.coli_number)
            .map((c) => ({
              id: c.id,
              coli_number: c.coli_number,
              coli_name: c.coli_name,
              coli_barcode: c.coli_barcode,
            })),
          coli_total: allColis.filter((c) => c.order_id === o.id).length,
        };
      });
  });

function buildProductCode(order: any, measures: Array<{ code: string; name: string }>): string | null {
  const model = order.models;
  const category = String(model?.ref_categories?.code ?? "").toUpperCase();
  const refTec = order.fabric_ref_tec ?? null;
  if (!model?.code || !refTec) return null;

  if (category === "SOF") {
    const width = Number(String(order.measure ?? "").match(/\d{2,3}/)?.[0]);
    const text = String(order.product_description ?? "");
    const variant: SofaVariant = /revers/i.test(text)
      ? "R"
      : /(odf|vdf).*(esq|esquer)/i.test(text) || /(esq|esquer).*(odf|vdf)/i.test(text)
        ? "E"
        : /(odf|vdf).*(drt|dir|direit)/i.test(text) || /(drt|dir|direit).*(odf|vdf)/i.test(text)
          ? "D"
          : /chaise/i.test(text)
            ? "R"
            : "N";
    return buildSofaCode({
      modelCode: model.code,
      familyCode: model.sofa_family_code,
      widthCm: width,
      refTec,
      variant,
    }) || null;
  }

  const normalizedMeasure = String(order.measure ?? "").toLowerCase().replace(/[^0-9x]/g, "");
  const measure = measures.find((m) => m.name.toLowerCase().replace(/[^0-9x]/g, "") === normalizedMeasure);
  if (category === "SOM") {
    const text = String(order.product_description ?? "");
    return buildSommierCode({
      modelCode: model.code,
      elevatorio: /elevat/i.test(text),
      fundos: /fundo/i.test(text),
      measureCode: measure?.code,
      refTec,
    }) || null;
  }
  if (category === "CAM") {
    return buildBedCode({
      modelCode: model.code,
      structureCode: model.structure_code,
      measureCode: measure?.code,
      refTec,
      variant: order.finishing === "F" || /flutuante|mural/i.test(String(order.product_description ?? "")) ? "F" : "N",
    }) || null;
  }
  return null;
}