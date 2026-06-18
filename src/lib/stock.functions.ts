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
    const s = context.supabase as any;
    if (data.item_type === "fabric") {
      const { data: row, error } = await s.from("fabric_rolls").select("meters").eq("id", data.item_id).single();
      if (error) throw new Error(error.message);
      const next = Math.max(0, Number(row.meters) + data.delta);
      const { error: upErr } = await s.from("fabric_rolls").update({ meters: next }).eq("id", data.item_id);
      if (upErr) throw new Error(upErr.message);
    } else {
      const table = data.item_type === "shell" ? "shells" : "covers";
      const { data: row, error } = await s.from(table).select("quantity").eq("id", data.item_id).single();
      if (error) throw new Error(error.message);
      const next = Math.max(0, Number(row.quantity) + data.delta);
      const { error: upErr } = await s.from(table).update({ quantity: next }).eq("id", data.item_id);
      if (upErr) throw new Error(upErr.message);
    }
    await s.from("stock_movements").insert({
      item_type: data.item_type, item_id: data.item_id,
      delta: data.delta, reason: data.reason ?? null, user_id: context.userId,
    });
    return { ok: true };
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
    const s = context.supabase as any;
    const { data: ord, error } = await s.from("production_orders")
      .select("id, status, is_stock_production, stock_item_type, stock_item_id, stock_quantity")
      .eq("id", data.order_id).single();
    if (error) throw new Error(error.message);
    if (!ord.is_stock_production) throw new Error("Não é ordem de stock");
    if (ord.status === "concluida") throw new Error("Já concluída");
    const table = ord.stock_item_type === "shell" ? "shells" : "covers";
    const { data: cur, error: e2 } = await s.from(table).select("quantity").eq("id", ord.stock_item_id).single();
    if (e2) throw new Error(e2.message);
    const next = Number(cur.quantity) + Number(ord.stock_quantity ?? 0);
    const { error: e3 } = await s.from(table).update({ quantity: next }).eq("id", ord.stock_item_id);
    if (e3) throw new Error(e3.message);
    await s.from("production_orders").update({ status: "concluida" }).eq("id", ord.id);
    await s.from("stock_movements").insert({
      item_type: ord.stock_item_type, item_id: ord.stock_item_id,
      delta: ord.stock_quantity, reason: `Produção para stock ${ord.id}`, user_id: context.userId,
    });
    return { ok: true };
  });