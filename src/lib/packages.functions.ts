import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

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
    product_description: string;
    measure: string | null;
    fabric_type: string | null;
    fabric_ref: string | null;
    color: string | null;
    structure_type: string | null;
    model_name: string | null;
  };
  packages: ModelPackage[]; // [] when none defined for the model
};

export const getLabelsForOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<LabelRow[]> => {
    const { supabase } = context;
    const { data: orders, error } = await supabase
      .from("production_orders")
      .select(
        "id, order_number, barcode, product_description, measure, fabric_type, fabric_ref, color, structure_type, model_id, models(name)",
      )
      .in("id", data.ids);
    if (error) throw new Error(error.message);

    const modelIds = Array.from(
      new Set((orders ?? []).map((o: any) => o.model_id).filter(Boolean)),
    );

    let pkgs: any[] = [];
    if (modelIds.length) {
      const { data: p, error: pe } = await supabase
        .from("model_packages")
        .select("id, model_id, structure_type, package_number, package_total, package_name")
        .in("model_id", modelIds);
      if (pe) throw new Error(pe.message);
      pkgs = p ?? [];
    }

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
        return {
          order: {
            id: o.id,
            order_number: o.order_number,
            barcode: o.barcode,
            product_description: o.product_description,
            measure: o.measure,
            fabric_type: o.fabric_type,
            fabric_ref: o.fabric_ref,
            color: o.color,
            structure_type: o.structure_type,
            model_name: o.models?.name ?? null,
          },
          packages: chosen.sort((a, b) => a.package_number - b.package_number),
        };
      });
  });