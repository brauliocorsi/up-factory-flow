import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { computeLines, type ConvergenceLines } from "@/lib/convergence";

async function assertAdminOrOffice(context: any) {
  const { data: isAdmin } = await (context.supabase as any).rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  const { data: isOffice } = await (context.supabase as any).rpc("has_role", {
    _user_id: context.userId,
    _role: "escritorio",
  });
  if (!isAdmin && !isOffice) throw new Error("Sem permissão (apenas admin ou escritório)");
}

async function assertAdmin(context: any) {
  const { data: isAdmin } = await (context.supabase as any).rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Sem permissão (apenas admin)");
}


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
  measure: string | null;
  fabric_type: string | null;
  fabric_ref: string | null;
  customer_order: string | null;
  model_id: string | null;
  structure_type: string | null;
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
      .select("id, order_number, product_description, priority, due_date, status, observation, is_stock_production, measure, fabric_type, fabric_ref, structure_type, customer_order, model_id, models(name), order_stages(stage, status, started_at, notes)")
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
        measure: ((o as any).measure as string | null) ?? null,
        fabric_type: ((o as any).fabric_type as string | null) ?? null,
        fabric_ref: ((o as any).fabric_ref as string | null) ?? null,
        customer_order: ((o as any).customer_order as string | null) ?? null,
        model_id: ((o as any).model_id as string | null) ?? null,
        structure_type: ((o as any).structure_type as string | null) ?? null,
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
  /** true = histórico (apenas concluídas). Por omissão as concluídas ficam fora da lista. */
  include_completed: z.boolean().optional(),
  only_completed: z.boolean().optional(),
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
  /** Data em que o embalamento foi concluído (encomenda concluída). */
  completed_at: string | null;
  /** Data em que a picagem/transferência foi registada, se já ocorreu. */
  picked_at: string | null;
};

export const listOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listOrdersSchema.parse(d))
  .handler(async ({ data, context }): Promise<OrderListItem[]> => {
    const { supabase } = context;
    let q = supabase
      .from("production_orders")
      .select("id, order_number, customer_order, product_description, measure, fabric_type, entry_date, due_date, status, models(name), order_stages(stage, status, finished_at)")
      .order("entry_date", { ascending: false, nullsFirst: false });
    if (data.search) {
      const s = data.search.replace(/[%,]/g, "");
      q = q.or(`order_number.ilike.%${s}%,customer_order.ilike.%${s}%`);
    }
    if (data.only_completed) {
      q = q.in("status", ["concluida", "em_armazem"] as any);
    } else if (data.status) {
      q = q.eq("status", data.status as any);
    } else if (!data.include_completed) {
      // Encomendas produzidas/picadas vivem só no histórico
      q = q.not("status", "in", "(concluida,em_armazem)");
    }

    if (data.modelId) q = q.eq("model_id", data.modelId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((o: any) => {
      const stages: any[] = o.order_stages ?? [];
      const current = STAGES.map((name) => stages.find((s) => s.stage === name && s.status !== "concluida")).find(Boolean) ?? { stage: "picagem" };
      const picking = stages.find((s) => s.stage === "picagem");
      const packing = stages.find((s) => s.stage === "embalagem");
      const packedAt = packing?.status === "concluida" ? (packing.finished_at ?? null) : null;
      const pickedAt = picking?.status === "concluida" ? (picking.finished_at ?? null) : null;
      return {
        id: o.id, order_number: o.order_number, customer_order: o.customer_order ?? null,
        product_description: o.product_description,
        model_name: o.models?.name ?? null, measure: o.measure, fabric_type: o.fabric_type,
        entry_date: o.entry_date, due_date: o.due_date, status: o.status,
        current_stage: current.stage,
        completed_at: packedAt ?? pickedAt,
        picked_at: pickedAt,
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
      customer_order: data.customer_order ?? null,
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
        customer_order: r.customer_order ?? null,
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

// ---------- Fase 1: Importação simples (Excel 4 colunas → backlog) ----------
// Recebe linhas já descodificadas no cliente (catálogo carregado lá).
// Para cada linha, expande "quantity" em N ordens individuais com order_number
// sequencial dentro do mesmo customer_order ({customer_order}-NN).
// Estado: 'pendente', is_stock_production=false, sem reservas nem etapas iniciadas.
// TODO Fase 2: o planeamento lê este backlog ('pendente'), agrupa por modelo/
// estrutura/tecido, planeia por dia e cria ordens is_stock_production. Operador
// pode puxar do backlog. Não implementado nesta fase.

const simpleRowSchema = z.object({
  customer_order: z.string().trim().min(1).max(64),
  quantity: z.number().int().min(1).max(500),
  due_date: z.string().nullable().optional(),
  product_description: z.string().trim().min(1).max(500),
  model_id: z.string().uuid().nullable().optional(),
  measure: z.string().trim().max(120).nullable().optional(),
  fabric_type: z.string().trim().max(120).nullable().optional(),
  fabric_ref: z.string().trim().max(120).nullable().optional(),
  color: z.string().trim().max(60).nullable().optional(),
  structure_type: z.string().trim().max(120).nullable().optional(),
  finishing: z.enum(["F","N"]).nullable().optional(),
  barcode_base: z.string().trim().min(1).max(64),
});

function pad2(n: number) { return n.toString().padStart(2, "0"); }

function todayPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export type BulkSimpleResult = {
  created: number;
  notes: number;
  per_customer: Array<{ customer_order: string; created: number; first_order_number: string }>;
  batch_hints: Array<{ kind: "corte" | "estrutura"; label: string; count: number }>;
};

export const bulkImportSimpleOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ rows: z.array(simpleRowSchema).min(1).max(2000) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<BulkSimpleResult> => {
    const { supabase, userId } = context;

    // Agrupa por customer_order (preserva ordem de chegada).
    const byCO = new Map<string, typeof data.rows>();
    for (const r of data.rows) {
      const arr = byCO.get(r.customer_order) ?? ([] as any);
      arr.push(r);
      byCO.set(r.customer_order, arr);
    }

    const customerOrders = Array.from(byCO.keys());
    const defaultDue = todayPlusDays(15);

    // Determina a maior sequência NN já existente por customer_order.
    const startSeq = new Map<string, number>();
    if (customerOrders.length) {
      const { data: existing, error: exErr } = await supabase
        .from("production_orders")
        .select("order_number, customer_order")
        .in("customer_order", customerOrders);
      if (exErr) throw new Error(exErr.message);
      for (const co of customerOrders) startSeq.set(co, 0);
      for (const e of (existing ?? []) as Array<{ order_number: string; customer_order: string }>) {
        const m = /-(\d+)$/.exec(e.order_number);
        const n = m ? parseInt(m[1], 10) : 0;
        if (Number.isFinite(n)) {
          const cur = startSeq.get(e.customer_order) ?? 0;
          if (n > cur) startSeq.set(e.customer_order, n);
        }
      }
    }

    // Calcula due_date por nota: mínimo entre os prazos das linhas; se nenhum, hoje+15.
    const dueByCO = new Map<string, string>();
    for (const [co, rows] of byCO.entries()) {
      const dates = rows
        .map((r) => r.due_date)
        .filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d));
      dueByCO.set(co, dates.length ? dates.sort()[0] : defaultDue);
    }

    // Constrói as ordens a inserir.
    const toInsert: any[] = [];
    const perCustomer: BulkSimpleResult["per_customer"] = [];
    for (const co of customerOrders) {
      const rows = byCO.get(co)!;
      let seq = startSeq.get(co) ?? 0;
      let firstOrder = "";
      for (const r of rows) {
        for (let i = 0; i < r.quantity; i++) {
          seq += 1;
          const orderNumber = `${co}-${pad2(seq)}`;
          if (!firstOrder) firstOrder = orderNumber;
          toInsert.push({
            order_number: orderNumber,
            customer_order: co,
            product_description: r.product_description,
            model_id: r.model_id ?? null,
            measure: r.measure ?? null,
            fabric_type: r.fabric_type ?? null,
            fabric_ref: r.fabric_ref ?? null,
            color: r.color ?? null,
            structure_type: r.structure_type ?? null,
            finishing: r.finishing ?? null,
            entry_date: null, // decidido no planeamento (Fase 2)
            due_date: dueByCO.get(co) ?? defaultDue,
            priority: 0,
            status: "pendente",
            is_stock_production: false,
            barcode: `${r.barcode_base}-${orderNumber}`,
            created_by: userId,
          });
        }
      }
      perCustomer.push({ customer_order: co, created: seq - (startSeq.get(co) ?? 0), first_order_number: firstOrder });
    }

    if (!toInsert.length) return { created: 0, notes: 0, per_customer: [], batch_hints: [] };

    const { error, count } = await supabase
      .from("production_orders")
      .insert(toInsert, { count: "exact" });
    if (error) throw new Error(error.message);

    // Fase C: deteção proativa de lotes (≥ 2 encomendas iguais no backlog)
    const batch_hints = await computeBatchHints(supabase, toInsert);

    return {
      created: count ?? toInsert.length,
      notes: customerOrders.length,
      per_customer: perCustomer,
      batch_hints,
    };
  });

async function computeBatchHints(
  supabase: any,
  inserted: Array<{
    model_id: string | null; measure: string | null; fabric_type: string | null;
    structure_type: string | null;
  }>,
): Promise<BulkSimpleResult["batch_hints"]> {
  // Recolhe chaves de afinidade dos recém-importados
  const corteKeys = new Set<string>();
  const estruKeys = new Set<string>();
  const modelIds = new Set<string>();
  const structures = new Set<string>();
  for (const r of inserted) {
    if (r.model_id) {
      corteKeys.add([r.model_id, r.measure ?? "", r.fabric_type ?? ""].join("|"));
      modelIds.add(r.model_id);
    }
    if (r.structure_type) {
      estruKeys.add([r.structure_type, r.measure ?? ""].join("|"));
      structures.add(r.structure_type);
    }
  }
  if (corteKeys.size === 0 && estruKeys.size === 0) return [];

  // Lê pendentes que envolvam alguma dessas chaves; bastante seletivo
  const filters: string[] = [];
  if (modelIds.size > 0) filters.push(`model_id.in.(${Array.from(modelIds).join(",")})`);
  if (structures.size > 0) {
    const esc = Array.from(structures).map((s) => `"${s.replace(/"/g, '""')}"`).join(",");
    filters.push(`structure_type.in.(${esc})`);
  }
  const { data: pend } = await supabase
    .from("production_orders")
    .select("model_id, measure, fabric_type, structure_type")
    .eq("status", "pendente")
    .or(filters.join(","));

  const counts = new Map<string, { kind: "corte" | "estrutura"; label: string; count: number }>();
  // Para lookup do nome do modelo
  let modelNames = new Map<string, string>();
  if (modelIds.size > 0) {
    const { data: ms } = await supabase
      .from("models").select("id, name").in("id", Array.from(modelIds));
    for (const m of (ms ?? []) as any[]) modelNames.set(m.id, m.name);
  }

  for (const p of (pend ?? []) as any[]) {
    if (p.model_id) {
      const k = `corte|${p.model_id}|${p.measure ?? ""}|${p.fabric_type ?? ""}`;
      if (corteKeys.has([p.model_id, p.measure ?? "", p.fabric_type ?? ""].join("|"))) {
        const label = [modelNames.get(p.model_id) ?? "Modelo", p.measure, p.fabric_type].filter(Boolean).join(" · ");
        const cur = counts.get(k);
        if (cur) cur.count++; else counts.set(k, { kind: "corte", label, count: 1 });
      }
    }
    if (p.structure_type) {
      const k = `estrutura|${p.structure_type}|${p.measure ?? ""}`;
      if (estruKeys.has([p.structure_type, p.measure ?? ""].join("|"))) {
        const label = [p.structure_type, p.measure].filter(Boolean).join(" · ");
        const cur = counts.get(k);
        if (cur) cur.count++; else counts.set(k, { kind: "estrutura", label, count: 1 });
      }
    }
  }

    return Array.from(counts.values())
    .filter((g) => g.count >= 2)
    .sort((a, b) => b.count - a.count);
}

// ============================================================
// PLANEAMENTO — Prioridade, ativação/desativação, urgentes
// ============================================================

export type PlanningOrder = {
  id: string;
  order_number: string;
  customer_order: string | null;
  product_description: string;
  model_name: string | null;
  measure: string | null;
  fabric_type: string | null;
  structure_type: string | null;
  entry_date: string | null;
  due_date: string | null;
  status: string;
  priority: number;
  has_started: boolean;        // alguma etapa já iniciou?
  is_planned: boolean;         // status !== 'pendente'
};

export const listPlanningOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlanningOrder[]> => {
    const { supabase } = context;
    const { data: orders, error } = await (supabase as any)
      .from("production_orders")
      .select("id, order_number, customer_order, product_description, measure, fabric_type, structure_type, entry_date, due_date, status, priority, models(name), order_stages(stage, started_at)")
      .not("status", "in", "(cancelada,concluida,em_armazem)")
      .order("priority", { ascending: false })
      .order("due_date", { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);
    return (orders ?? []).map((o: any) => {
      const stages: any[] = o.order_stages ?? [];
      const has_started = stages.some((s) => s.started_at != null);
      return {
        id: o.id,
        order_number: o.order_number,
        customer_order: o.customer_order ?? null,
        product_description: o.product_description,
        model_name: o.models?.name ?? null,
        measure: o.measure ?? null,
        fabric_type: o.fabric_type ?? null,
        structure_type: o.structure_type ?? null,
        entry_date: o.entry_date ?? null,
        due_date: o.due_date ?? null,
        status: o.status,
        priority: o.priority,
        has_started,
        is_planned: o.status !== "pendente",
      };
    });
  });

export const setOrdersPriority = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      order_ids: z.array(z.string().uuid()).min(1).max(500),
      priority: z.coerce.number().int().min(1).max(3),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdminOrOffice(context);
    const { error } = await (context.supabase as any)
      .from("production_orders")
      .update({ priority: data.priority })
      .in("id", data.order_ids);
    if (error) throw new Error(error.message);
    return { ok: true, updated: data.order_ids.length };
  });

export const deactivateOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ order_ids: z.array(z.string().uuid()).min(1).max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdminOrOffice(context);
    const { supabase } = context;
    // Validar: nenhuma encomenda pode ter etapas já iniciadas.
    const { data: stages, error: sErr } = await (supabase as any)
      .from("order_stages")
      .select("order_id")
      .in("order_id", data.order_ids)
      .not("started_at", "is", null);
    if (sErr) throw new Error(sErr.message);
    if ((stages ?? []).length > 0) {
      const blocked = Array.from(new Set((stages ?? []).map((s: any) => s.order_id)));
      const { data: names } = await (supabase as any)
        .from("production_orders")
        .select("order_number")
        .in("id", blocked);
      throw new Error(
        `Não é possível tirar do planeamento: ${((names ?? []).map((n: any) => n.order_number)).join(", ")} já tem produção iniciada`,
      );
    }
    const { error } = await (supabase as any)
      .from("production_orders")
      .update({ status: "pendente" })
      .in("id", data.order_ids)
      .eq("status", "em_producao");
    if (error) throw new Error(error.message);
    return { ok: true, deactivated: data.order_ids.length };
  });

export type UrgentOrder = {
  id: string;
  order_id: string;
  order_number: string;
  customer_order: string | null;
  product_description: string;
  stage: string;
  due_date: string | null;
};

export const listUrgentActive = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UrgentOrder[]> => {
    const { supabase } = context;
    // Urgentes (priority >= 3) ativas em produção.
    const { data, error } = await (supabase as any)
      .from("order_stages")
      .select("id, stage, production_orders!inner(id, order_number, customer_order, product_description, due_date, priority, status)")
      .eq("production_orders.priority", 3)
      .eq("production_orders.status", "em_producao")
      .neq("status", "concluida");
    if (error) throw new Error(error.message);
    const seen = new Set<string>();
    const out: UrgentOrder[] = [];
    for (const r of data ?? []) {
      const o = r.production_orders;
      if (!o || seen.has(o.id)) continue;
      seen.add(o.id);
      out.push({
        id: r.id,
        order_id: o.id,
        order_number: o.order_number,
        customer_order: o.customer_order ?? null,
        product_description: o.product_description,
        stage: r.stage,
        due_date: o.due_date ?? null,
      });
    }
    return out;
  });
// ============================================================
// EDIÇÃO DE ENCOMENDAS
// ============================================================

export type EditableOrder = {
  id: string;
  order_number: string;
  customer_order: string | null;
  product_description: string;
  model_id: string | null;
  measure: string | null;
  fabric_type: string | null;
  fabric_ref: string | null;
  color: string | null;
  structure_type: string | null;
  finishing: string | null;
  entry_date: string | null;
  due_date: string | null;
  priority: number;
  notes: string | null;
  observation: string | null;
  status: string;
};

export const getOrderForEdit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<EditableOrder> => {
    const { data: o, error } = await (context.supabase as any)
      .from("production_orders")
      .select("id, order_number, customer_order, product_description, model_id, measure, fabric_type, fabric_ref, color, structure_type, finishing, entry_date, due_date, priority, notes, observation, status")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!o) throw new Error("Encomenda não encontrada");
    return o as EditableOrder;
  });

const dateOrNull = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(""), z.null()]).optional();
const textOrNull = z.union([z.string().max(400), z.null()]).optional();

const updateOrderSchema = z.object({
  id: z.string().uuid(),
  customer_order: textOrNull,
  product_description: z.string().min(1).max(400).optional(),
  model_id: z.union([z.string().uuid(), z.null()]).optional(),
  measure: textOrNull,
  fabric_type: textOrNull,
  fabric_ref: textOrNull,
  color: textOrNull,
  structure_type: textOrNull,
  finishing: textOrNull,
  entry_date: dateOrNull,
  due_date: dateOrNull,
  priority: z.coerce.number().int().min(1).max(3).optional(),
  notes: textOrNull,
  observation: textOrNull,
});

/** Atualiza campos de uma encomenda (admin/escritório). Só grava os campos enviados. */
export const updateOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateOrderSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminOrOffice(context);
    const { id, ...rest } = data;

    const { data: existing, error: exErr } = await (context.supabase as any)
      .from("production_orders")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();
    if (exErr) throw new Error(exErr.message);
    if (!existing) throw new Error("Encomenda não encontrada");
    if (existing.status === "cancelada") throw new Error("Encomenda cancelada — não é possível editar");

    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v === undefined) continue;
      patch[k] = v === "" ? null : v;
    }
    if (Object.keys(patch).length === 0) return { ok: true, updated: false };

    const { error } = await (context.supabase as any)
      .from("production_orders")
      .update(patch)
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true, updated: true };
  });

// ============================================================
// AÇÕES EM MASSA (seleção na lista de encomendas)
// ============================================================

export type BulkResult = { ok: boolean; affected: number; skipped: string[]; message?: string };

const idsSchema = z.object({ order_ids: z.array(z.string().uuid()).min(1).max(500) });

/** Cancela várias encomendas (com recuperação de stock, uma a uma). */
export const bulkCancelOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idsSchema.parse(d))
  .handler(async ({ data, context }): Promise<BulkResult> => {
    await assertAdminOrOffice(context);
    let affected = 0;
    const skipped: string[] = [];
    for (const id of data.order_ids) {
      const { error } = await (context.supabase as any).rpc("cancel_order_with_recovery", { _order_id: id });
      if (error) skipped.push(id);
      else affected++;
    }
    return { ok: true, affected, skipped };
  });

/** Apaga definitivamente encomendas (apenas admin, sem produção iniciada). */
export const bulkDeleteOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idsSchema.parse(d))
  .handler(async ({ data, context }): Promise<BulkResult> => {
    await assertAdmin(context);
    const { supabase } = context;

    const { data: started, error: sErr } = await (supabase as any)
      .from("order_stages")
      .select("order_id")
      .in("order_id", data.order_ids)
      .not("started_at", "is", null);
    if (sErr) throw new Error(sErr.message);
    const blocked = new Set<string>((started ?? []).map((s: any) => s.order_id));

    const { data: fg } = await (supabase as any)
      .from("finished_goods")
      .select("order_id")
      .in("order_id", data.order_ids);
    for (const r of fg ?? []) if (r.order_id) blocked.add(r.order_id);

    const deletable = data.order_ids.filter((id) => !blocked.has(id));
    let affected = 0;
    if (deletable.length > 0) {
      const { error } = await (supabase as any)
        .from("production_orders")
        .delete()
        .in("id", deletable);
      if (error) throw new Error(error.message);
      affected = deletable.length;
    }

    let message: string | undefined;
    if (blocked.size > 0) {
      const { data: names } = await (supabase as any)
        .from("production_orders")
        .select("order_number")
        .in("id", Array.from(blocked));
      message = `Não apagadas (já com produção/stock): ${(names ?? []).map((n: any) => n.order_number).join(", ")}. Usa cancelar.`;
    }
    return { ok: true, affected, skipped: Array.from(blocked), message };
  });

/** Altera datas (entrada e/ou saída) de várias encomendas. */
export const setOrdersDates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      order_ids: z.array(z.string().uuid()).min(1).max(500),
      entry_date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]).optional(),
      due_date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }): Promise<BulkResult> => {
    await assertAdminOrOffice(context);
    const patch: Record<string, unknown> = {};
    if (data.entry_date !== undefined) patch["entry_date"] = data.entry_date;
    if (data.due_date !== undefined) patch["due_date"] = data.due_date;
    if (Object.keys(patch).length === 0) return { ok: true, affected: 0, skipped: [], message: "Nada a alterar" };

    const { error } = await (context.supabase as any)
      .from("production_orders")
      .update(patch)
      .in("id", data.order_ids)
      .neq("status", "cancelada");
    if (error) throw new Error(error.message);
    return { ok: true, affected: data.order_ids.length, skipped: [] };
  });
