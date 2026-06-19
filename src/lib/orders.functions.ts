import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { computeLines, type ConvergenceLines } from "@/lib/convergence";

export type DashboardOrder = {
  id: string;
  order_number: string;
  product_description: string;
  model_name: string | null;
  current_stage: string;
  current_stage_status: string;
  stage_started_at: string | null;
  due_date: string | null;
  priority: number;
  status: string;
  observation: string | null;
  is_stock_production?: boolean;
  has_stock_completed?: boolean;
  lines?: ConvergenceLines;
};

export type DashboardData = {
  stats: { pendentes: number; em_producao: number; concluidas_hoje: number; bloqueadas: number; prontas_estofar: number };
  byStage: Record<string, DashboardOrder[]>;
};

const STAGES = ["estrutura","corte","costura","branco","estofagem","qualidade","embalagem","picagem"] as const;

export const getDashboardData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardData> => {
    const { supabase } = context;
    const { data: orders, error } = await (supabase as any)
      .from("production_orders")
      .select("id, order_number, product_description, priority, due_date, status, observation, is_stock_production, models(name), order_stages(stage, status, started_at, notes)")
      .neq("status", "cancelada")
      .order("priority", { ascending: false })
      .order("entry_date", { ascending: true });
    if (error) throw new Error(error.message);

    const byStage: Record<string, DashboardOrder[]> = {};
    STAGES.forEach((s) => (byStage[s] = []));

    let pendentes = 0, em_producao = 0, bloqueadas = 0, prontas_estofar = 0;
    const today = new Date(); today.setHours(0,0,0,0);

    for (const o of orders ?? []) {
      if (o.status === "pendente") pendentes++;
      if (o.status === "em_producao") em_producao++;
      const stages = (o.order_stages as any[]) ?? [];
      // current stage = first stage in order that is not concluida; if all concluida -> picagem
      let current = stages.find((s) => s.status === "em_curso") ||
                    stages.find((s) => s.status === "bloqueada") ||
                    STAGES.map((name) => stages.find((s) => s.stage === name && s.status !== "concluida")).find(Boolean);
      if (!current) continue; // concluida toda
      if (current.status === "bloqueada") bloqueadas++;
      const lines = computeLines(stages as any);
      if (current.stage === "estofagem" && lines.tecido.ready && lines.estrutura.ready) {
        prontas_estofar++;
      }
      const card: DashboardOrder = {
        id: o.id as string,
        order_number: o.order_number as string,
        product_description: o.product_description as string,
        model_name: (o.models as any)?.name ?? null,
        current_stage: current.stage,
        current_stage_status: current.status,
        stage_started_at: current.started_at ?? null,
        due_date: o.due_date as string | null,
        priority: o.priority as number,
        status: o.status as string,
        observation: ((o as any).observation as string | null) ?? null,
        is_stock_production: Boolean((o as any).is_stock_production),
        has_stock_completed: stages.some((s: any) => typeof s.notes === "string" && s.notes.startsWith("Concluída de stock")),
        lines,
      };
      byStage[current.stage].push(card);
    }

    // concluidas hoje: orders with picagem concluida today
    const { count } = await supabase
      .from("order_stages")
      .select("id", { count: "exact", head: true })
      .eq("stage", "picagem")
      .eq("status", "concluida")
      .gte("finished_at", today.toISOString());

    return {
      stats: { pendentes, em_producao, concluidas_hoje: count ?? 0, bloqueadas, prontas_estofar },
      byStage,
    };
  });

const listOrdersSchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  modelId: z.string().optional(),
});

export type OrderListItem = {
  id: string;
  order_number: string;
  customer_order: string | null;
  product_description: string;
  model_name: string | null;
  measure: string | null;
  fabric_type: string | null;
  entry_date: string | null;
  due_date: string | null;
  status: string;
  current_stage: string;
};

export const listOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listOrdersSchema.parse(d))
  .handler(async ({ data, context }): Promise<OrderListItem[]> => {
    const { supabase } = context;
    let q = supabase
      .from("production_orders")
      .select("id, order_number, customer_order, product_description, measure, fabric_type, entry_date, due_date, status, models(name), order_stages(stage, status)")
      .order("entry_date", { ascending: false, nullsFirst: false });
    if (data.search) {
      const s = data.search.replace(/[%,]/g, "");
      q = q.or(`order_number.ilike.%${s}%,customer_order.ilike.%${s}%`);
    }
    if (data.status) q = q.eq("status", data.status as any);
    if (data.modelId) q = q.eq("model_id", data.modelId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((o: any) => {
      const stages: any[] = o.order_stages ?? [];
      const current = STAGES.map((name) => stages.find((s) => s.stage === name && s.status !== "concluida")).find(Boolean) ?? { stage: "picagem" };
      return {
        id: o.id, order_number: o.order_number, customer_order: o.customer_order ?? null,
        product_description: o.product_description,
        model_name: o.models?.name ?? null, measure: o.measure, fabric_type: o.fabric_type,
        entry_date: o.entry_date, due_date: o.due_date, status: o.status,
        current_stage: current.stage,
      };
    });
  });

export const listModels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("models").select("id, name, code").eq("active", true).order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ---------- Create / Import ----------

const orderInputSchema = z.object({
  order_number: z.string().trim().min(1).max(64),
  customer_order: z.string().trim().max(64).nullable().optional(),
  product_description: z.string().trim().min(1).max(500),
  model_id: z.string().uuid().nullable().optional(),
  measure: z.string().trim().max(120).nullable().optional(),
  fabric_type: z.string().trim().max(120).nullable().optional(),
  fabric_ref: z.string().trim().max(120).nullable().optional(),
  color: z.string().trim().max(60).nullable().optional(),
  structure_type: z.string().trim().max(120).nullable().optional(),
  entry_date: z.string().optional(),
  due_date: z.string().nullable().optional(),
  priority: z.coerce.number().int().min(0).max(10).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  observation: z.string().trim().max(500).nullable().optional(),
  finishing: z.enum(["F", "N"]).nullable().optional(),
  barcode: z.string().trim().max(64).nullable().optional(),
});

export type OrderInput = z.infer<typeof orderInputSchema>;

function genBarcode(orderNumber: string) {
  const clean = orderNumber.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const stamp = Date.now().toString(36).toUpperCase().slice(-4);
  return `UP-${clean}-${stamp}`;
}

export const createOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => orderInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: exists } = await supabase
      .from("production_orders")
      .select("id")
      .eq("order_number", data.order_number)
      .maybeSingle();
    if (exists) throw new Error(`Encomenda ${data.order_number} já existe`);

    const row = {
      order_number: data.order_number,
      product_description: data.product_description,
      model_id: data.model_id ?? null,
      measure: data.measure ?? null,
      fabric_type: data.fabric_type ?? null,
      fabric_ref: data.fabric_ref ?? null,
      color: data.color ?? null,
      structure_type: data.structure_type ?? null,
      entry_date: data.entry_date || new Date().toISOString().slice(0, 10),
      due_date: data.due_date || null,
      priority: data.priority ?? 0,
      notes: data.notes ?? null,
      observation: data.observation ?? null,
      finishing: data.finishing ?? null,
      barcode: (data.barcode && data.barcode.trim()) || genBarcode(data.order_number),
      created_by: userId,
    } as any;
    const { data: inserted, error } = await supabase
      .from("production_orders")
      .insert(row)
      .select("id, order_number, barcode")
      .single();
    if (error) throw new Error(error.message);
    return inserted;
  });

const bulkSchema = z.object({ rows: z.array(orderInputSchema).min(1).max(1000) });

export const bulkCreateOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => bulkSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Mesmo nº pode ter várias camas (linhas). A validação de duplicados é
    // feita no UI (informativa) — aqui inserimos tudo o que o utilizador escolheu.
    const ok: any[] = [];
    const skipped: { order_number: string; reason: string }[] = [];
    for (const r of data.rows) {
      ok.push({
        order_number: r.order_number,
        product_description: r.product_description,
        model_id: r.model_id ?? null,
        measure: r.measure ?? null,
        fabric_type: r.fabric_type ?? null,
        fabric_ref: r.fabric_ref ?? null,
        color: r.color ?? null,
        structure_type: r.structure_type ?? null,
        entry_date: r.entry_date || new Date().toISOString().slice(0, 10),
        due_date: r.due_date || null,
        priority: r.priority ?? 0,
        notes: r.notes ?? null,
        observation: r.observation ?? null,
        finishing: r.finishing ?? null,
        barcode: (r.barcode && r.barcode.trim()) || genBarcode(r.order_number),
        created_by: userId,
      } as any);
    }
    let inserted = 0;
    if (ok.length) {
      const { error, count } = await supabase
        .from("production_orders")
        .insert(ok, { count: "exact" });
      if (error) throw new Error(error.message);
      inserted = count ?? ok.length;
    }
    return { inserted, skipped };
  });

// ---------- Import mapping persistence ----------

export const getImportMapping = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("import_mappings")
      .select("mapping")
      .eq("user_id", context.userId)
      .maybeSingle();
    return (data?.mapping as Record<string, string> | null) ?? null;
  });

// ---------- Check existing order numbers (for import validation) ----------

export type ExistingOrderInfo = {
  order_number: string;
  count: number;
  products: string[];
};

export const checkExistingOrderNumbers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ numbers: z.array(z.string().trim().min(1)).min(1).max(2000) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<ExistingOrderInfo[]> => {
    const unique = Array.from(new Set(data.numbers));
    const { data: rows, error } = await context.supabase
      .from("production_orders")
      .select("order_number, product_description")
      .in("order_number", unique);
    if (error) throw new Error(error.message);
    const map = new Map<string, ExistingOrderInfo>();
    for (const r of rows ?? []) {
      const num = (r as any).order_number as string;
      const prod = ((r as any).product_description as string) ?? "";
      const cur = map.get(num) ?? { order_number: num, count: 0, products: [] };
      cur.count += 1;
      if (prod) cur.products.push(prod);
      map.set(num, cur);
    }
    return Array.from(map.values());
  });

export const saveImportMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ mapping: z.record(z.string(), z.string()) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("import_mappings")
      .upsert({ user_id: context.userId, mapping: data.mapping }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Single-order fetch (for label) ----------

export const getOrderForLabel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("production_orders")
      .select("id, order_number, barcode, product_description, measure, fabric_type, fabric_ref, color, models(name)")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// ---------- Cancel with stock recovery ----------

export type CancelPreview = {
  order_number: string;
  shell_code: string | null;
  cover_code: string | null;
  shell_reserved_to_release: boolean;
  cover_reserved_to_release: boolean;
  shell_to_return_to_stock: boolean;
  cover_to_return_to_stock: boolean;
};

export const previewCancelOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<CancelPreview> => {
    const { data: res, error } = await (context.supabase as any)
      .rpc("preview_cancel_order", { _order_id: data.id });
    if (error) throw new Error(error.message);
    return res as CancelPreview;
  });

export const cancelOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any)
      .rpc("cancel_order_with_recovery", { _order_id: data.id });
    if (error) throw new Error(error.message);
    return res;
  });