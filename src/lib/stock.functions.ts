import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ============ SHELLS ============
const shellSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(120),
  structure_code: z.string().trim().max(32).nullable().optional(),
  category_code: z.string().trim().max(32).nullable().optional(),
  quantity: z.number().int().min(0).optional(),
  min_quantity: z.number().int().min(0).optional(),
  location: z.string().trim().max(120).nullable().optional(),
  active: z.boolean().optional(),
  state: z.enum(["casco", "branco"]).optional(),
});

export const listShells = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("shells" as any)
      .select("*")
      .order("code");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertShell = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => shellSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...row } = data;
    if (id) {
      const { error } = await context.supabase.from("shells" as any).update(row).eq("id", id);
      if (error) throw new Error(error.message);
      return { id };
    }
    const { data: ins, error } = await context.supabase
      .from("shells" as any).insert(row).select("id").single();
    if (error) throw new Error(error.message);
    return ins;
  });

export const deleteShell = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("shells" as any).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ COVERS ============
const coverSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(160),
  model_code: z.string().trim().max(32).nullable().optional(),
  structure_code: z.string().trim().max(32).nullable().optional(),
  measure_code: z.string().trim().max(32).nullable().optional(),
  fabric_type_code: z.string().trim().max(32).nullable().optional(),
  fabric_ref_code: z.string().trim().max(32).nullable().optional(),
  color_code: z.string().trim().max(32).nullable().optional(),
  quantity: z.number().int().min(0).optional(),
  min_quantity: z.number().int().min(0).optional(),
  location: z.string().trim().max(120).nullable().optional(),
  active: z.boolean().optional(),
  state: z.enum(["cortada", "pronta"]).optional(),
});

export const listCovers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("covers" as any).select("*").order("code");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertCover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => coverSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...row } = data;
    if (id) {
      const { error } = await context.supabase.from("covers" as any).update(row).eq("id", id);
      if (error) throw new Error(error.message);
      return { id };
    }
    const { data: ins, error } = await context.supabase
      .from("covers" as any).insert(row).select("id").single();
    if (error) throw new Error(error.message);
    return ins;
  });

export const deleteCover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("covers" as any).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ FABRIC ROLLS ============
const rollSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(160),
  fabric_ref_code: z.string().trim().max(32).nullable().optional(),
  color_code: z.string().trim().max(32).nullable().optional(),
  meters: z.number().min(0).optional(),
  min_meters: z.number().min(0).optional(),
  location: z.string().trim().max(120).nullable().optional(),
  active: z.boolean().optional(),
});

export const listRolls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("fabric_rolls" as any).select("*").order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertRoll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => rollSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...row } = data;
    if (id) {
      const { error } = await context.supabase.from("fabric_rolls" as any).update(row).eq("id", id);
      if (error) throw new Error(error.message);
      return { id };
    }
    const { data: ins, error } = await context.supabase
      .from("fabric_rolls" as any).insert(row).select("id").single();
    if (error) throw new Error(error.message);
    return ins;
  });

export const deleteRoll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("fabric_rolls" as any).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ STOCK ADJUST ============
const adjustSchema = z.object({
  item_type: z.enum(["shell", "cover", "fabric"]),
  item_id: z.string().uuid(),
  delta: z.number(),
  reason: z.string().trim().max(240).optional(),
});

export const adjustStock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => adjustSchema.parse(d))
  .handler(async ({ data, context }) => {
    // Atomic: single UPDATE + movement inside one DB function (no read-modify-write)
    const { error } = await (context.supabase as any).rpc("adjust_stock_atomic", {
      _item_type: data.item_type,
      _item_id: data.item_id,
      _delta: data.delta,
      _reason: data.reason ?? null,
    });
    if (error) return { ok: false as const, message: error.message };
    return { ok: true as const };
  });

// ============ RECIPES ============
const recipeSchema = z.object({
  id: z.string().uuid().optional(),
  category_code: z.string().trim().min(1).max(32),
  model_code: z.string().trim().min(1).max(32),
  structure_code: z.string().trim().min(1).max(32),
  measure_code: z.string().trim().min(1).max(32),
  shell_id: z.string().uuid().nullable().optional(),
  cover_required: z.boolean().optional(),
  meters_per_unit: z.number().min(0).nullable().optional(),
  foam_description: z.string().trim().max(240).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const listRecipes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("product_recipe" as any)
      .select("*").order("category_code").order("model_code");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertRecipe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => recipeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...row } = data;
    if (id) {
      const { error } = await context.supabase.from("product_recipe" as any).update(row).eq("id", id);
      if (error) throw new Error(error.message);
      return { id };
    }
    const { data: ins, error } = await context.supabase
      .from("product_recipe" as any).upsert(row, { onConflict: "category_code,model_code,structure_code,measure_code" })
      .select("id").single();
    if (error) throw new Error(error.message);
    return ins;
  });

export const deleteRecipe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("product_recipe" as any).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ DASHBOARD ============
export const getStockOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const s = context.supabase as any;
    const [shells, covers, rolls] = await Promise.all([
      s.from("shells").select("*").eq("active", true),
      s.from("covers").select("*").eq("active", true),
      s.from("fabric_rolls").select("*").eq("active", true),
    ]);
    const sh = (shells.data ?? []) as any[];
    const cv = (covers.data ?? []) as any[];
    const rl = (rolls.data ?? []) as any[];
    return {
      totals: {
        shells: sh.reduce((a, r) => a + Number(r.quantity ?? 0), 0),
        covers: cv.reduce((a, r) => a + Number(r.quantity ?? 0), 0),
        fabric_meters: rl.reduce((a, r) => a + Number(r.meters ?? 0), 0),
      },
      alerts: {
        shells: sh.filter((r) => Number(r.quantity) - Number(r.reserved ?? 0) <= Number(r.min_quantity ?? 0)),
        covers: cv.filter((r) => Number(r.quantity) - Number(r.reserved ?? 0) <= Number(r.min_quantity ?? 0)),
        rolls: rl.filter((r) => Number(r.meters) <= Number(r.min_meters ?? 0)),
      },
    };
  });

// ============ PRODUCTION FOR STOCK ============
const stockProdSchema = z.object({
  item_type: z.enum(["shell", "cover"]),
  item_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(9999),
});

export const createStockProduction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => stockProdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const s = context.supabase as any;
    const table = data.item_type === "shell" ? "shells" : "covers";
    const { data: item, error: e1 } = await s.from(table).select("code, name").eq("id", data.item_id).single();
    if (e1) throw new Error(e1.message);
    const orderNumber = `STK-${data.item_type === "shell" ? "C" : "K"}-${Date.now().toString().slice(-8)}`;
    const desc = `[STOCK] ${item.code} · ${item.name} ×${data.quantity}`;
    const { data: ord, error } = await s.from("production_orders").insert({
      order_number: orderNumber,
      product_description: desc,
      is_stock_production: true,
      stock_item_type: data.item_type,
      stock_item_id: data.item_id,
      stock_quantity: data.quantity,
      created_by: context.userId,
    }).select("id, order_number").single();
    if (error) throw new Error(error.message);
    return ord;
  });

// Manually complete a stock-production order: add quantity to stock.
export const completeStockProduction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ order_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Atomic + idempotent: row is locked and the status guard blocks double clicks
    const { error } = await (context.supabase as any).rpc("complete_stock_production", {
      _order_id: data.order_id,
    });
    if (error) return { ok: false as const, message: error.message };
    return { ok: true as const };
  });
// ============ CONSUMO MANUAL DE TECIDO (etapa de Corte) ============

/** Contexto para o diálogo "Consumir tecido": metros do modelo + rolos disponíveis. */
export const getFabricConsumeContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ order_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const s = context.supabase as any;
    const { data: order, error: oErr } = await s
      .from("production_orders")
      .select("id, order_number, model_id, fabric_ref, color, fabric_type")
      .eq("id", data.order_id)
      .maybeSingle();
    if (oErr) throw new Error(oErr.message);
    if (!order) return { ok: false as const, message: "Encomenda não encontrada." };

    const [modelRes, rollsRes, typesRes, refsRes, colorsRes, consRes] = await Promise.all([
      order.model_id
        ? s.from("models").select("id, code, name, meters_per_unit").eq("id", order.model_id).maybeSingle()
        : Promise.resolve({ data: null }),
      s.from("fabric_rolls").select("id, name, fabric_ref_code, color_code, meters").eq("active", true).order("name"),
      s.from("ref_fabric_types").select("id, code, name").eq("active", true).order("code"),
      s.from("ref_fabric_refs").select("id, code, name, fabric_type_id").eq("active", true).order("code"),
      s.from("ref_colors").select("id, code, name").eq("active", true).order("code"),
      s.from("fabric_consumptions").select("*").eq("order_id", data.order_id).maybeSingle(),
    ]);

    return {
      ok: true as const,
      order,
      model: modelRes?.data ?? null,
      meters_per_unit: modelRes?.data?.meters_per_unit ?? null,
      rolls: rollsRes.data ?? [],
      fabric_types: typesRes.data ?? [],
      fabric_refs: refsRes.data ?? [],
      colors: colorsRes.data ?? [],
      consumption: consRes?.data ?? null,
    };
  });

/** Consumos já registados para um conjunto de encomendas (badge no card). */
export const listFabricConsumptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ order_ids: z.array(z.string().uuid()).max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.order_ids.length === 0) return [];
    const { data: rows, error } = await (context.supabase as any)
      .from("fabric_consumptions")
      .select("order_id, roll_id, fabric_ref_code, color_code, meters, created_at")
      .in("order_id", data.order_ids.slice(0, 500));
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const consumeFabric = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        order_id: z.string().uuid(),
        roll_id: z.string().uuid(),
        meters: z.number().positive().max(10000),
        operator_code: z.string().trim().max(32).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc("consume_fabric_for_order", {
      _order_id: data.order_id,
      _roll_id: data.roll_id,
      _meters: data.meters,
      _operator_code: data.operator_code ?? null,
    });
    if (error) return { ok: false as const, message: error.message };
    const r = (res ?? {}) as { ok?: boolean; message?: string };
    if (!r.ok) return { ok: false as const, message: r.message ?? "Não foi possível consumir o tecido." };
    return { ok: true as const, result: res };
  });

export const undoFabricConsumption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ order_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc("undo_fabric_consumption", {
      _order_id: data.order_id,
    });
    if (error) return { ok: false as const, message: error.message };
    const r = (res ?? {}) as { ok?: boolean; message?: string };
    if (!r.ok) return { ok: false as const, message: r.message ?? "Não foi possível anular o consumo." };
    return { ok: true as const };
  });
