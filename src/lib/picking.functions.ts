import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAnyRole, hasAnyRole } from "@/lib/roleGuards";
import { z } from "zod";

export type PickingColi = {
  package_number: number;
  package_total: number;
  package_name: string;
  expected_code: string;
};

export type PickingOrder = {
  id: string;
  order_number: string;
  product_description: string;
  structure_type: string | null;
  measure: string | null;
  fabric_type: string | null;
  fabric_ref: string | null;
  color: string | null;
  observation: string | null;
  stage_id: string;
  stage_status: string;
  package_total: number;
  packages: PickingColi[];
};

// List orders eligible for picking (embalagem concluida, picagem nao concluida)
export const listPickingQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: stages, error } = await supabase
      .from("order_stages")
      .select("id, order_id, stage, status, production_orders!inner(id, order_number, product_description, structure_type, measure, color, status)")
      .eq("stage", "picagem")
      .neq("status", "concluida");
    if (error) throw new Error(error.message);
    const rows = (stages ?? []) as any[];
    const orderIds = rows.map((s) => s.order_id);
    if (orderIds.length === 0) return [] as Array<{ order_id: string; order_number: string; product_description: string; structure_type: string|null; measure: string|null; color: string|null; coli_total: number; coli_picked: number; }>;
    const { data: emb } = await supabase
      .from("order_stages")
      .select("order_id, status")
      .eq("stage", "embalagem")
      .in("order_id", orderIds);
    const embMap = new Map((emb ?? []).map((e: any) => [e.order_id, e.status]));
    // colis totals
    const { data: colis } = await supabase
      .from("order_colis")
      .select("id, order_id")
      .in("order_id", orderIds);
    const totals = new Map<string, number>();

    for (const c of (colis ?? []) as any[]) {
      totals.set(c.order_id, (totals.get(c.order_id) ?? 0) + 1);

    }
    // picked = coli_stages picagem concluidas
    const picked = new Map<string, number>();
    const { data: cs } = await supabase
      .from("order_coli_stages")
      .select("order_id")
      .in("order_id", orderIds)
      .eq("stage", "picagem")
      .eq("status", "concluida");
    for (const r of (cs ?? []) as any[]) {
      picked.set(r.order_id, (picked.get(r.order_id) ?? 0) + 1);
    }
    return rows
      .filter((s) => embMap.get(s.order_id) === "concluida" && (totals.get(s.order_id) ?? 0) > 0 && s.production_orders.status !== "cancelada")
      .map((s) => ({
        order_id: s.order_id,
        order_number: s.production_orders.order_number,
        product_description: s.production_orders.product_description,
        structure_type: s.production_orders.structure_type,
        measure: s.production_orders.measure,
        color: s.production_orders.color,
        coli_total: totals.get(s.order_id) ?? 0,
        coli_picked: picked.get(s.order_id) ?? 0,
      }));
  });

// History of what I picked
export const listMyPickedOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ limit: z.number().int().min(1).max(500).optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await context.supabase.rpc("list_my_picked_orders", { _limit: data.limit ?? 100 });
    if (error) throw new Error(error.message);
    return (res ?? []) as Array<{
      order_id: string; order_number: string; product_description: string;
      structure_type: string|null; measure: string|null; color: string|null;
      finished_at: string|null; coli_count: number; operator_code: string|null; operator_name: string|null;
    }>;
  });

// Safe order progress (Camada C) — no recipe, stock, costs
export const getOrderProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ order_number: z.string().trim().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await context.supabase.rpc("get_order_progress", { _query: data.order_number });
    if (error) throw new Error(error.message);
    return res as {
      customer_order: string;
      order_number: string;
      product_description: string;
      structure_type: string|null;
      measure: string|null;
      color: string|null;
      status: string;
      current_stage: { stage: string; status: string } | null;
      stages: Array<{ stage: string; status: string; started_at: string|null; finished_at: string|null; order_idx: number }>;
      items: Array<{
        order_number: string;
        customer_order: string|null;
        product_description: string;
        structure_type: string|null;
        measure: string|null;
        color: string|null;
        status: string;
        current_stage: { stage: string; status: string } | null;
        stages: Array<{ stage: string; status: string; started_at: string|null; finished_at: string|null; order_idx: number }>;
      }>;
    };
  });

// Resolve an order from scanner reading (order_number)
export const resolveOrderForPicking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ code: z.string().trim() }).parse(d))
  .handler(async ({ data, context }): Promise<PickingOrder> => {
    const { supabase } = context;
    // Strip a coli suffix (e.g. "16566-01-C2" -> "16566-01") if present.
    const cleanCode = data.code.trim().replace(/-C\d+$/i, "");
    const SELECT_COLS =
      "id, order_number, customer_order, barcode, product_description, structure_type, measure, fabric_type, fabric_ref, color, observation, model_id, status";

    // 1. Exact match by order_number, barcode or customer_order (nota do cliente).
    const { data: exact, error: orderErr } = await supabase
      .from("production_orders")
      .select(SELECT_COLS)
      .or(`order_number.eq.${cleanCode},barcode.eq.${cleanCode},customer_order.eq.${cleanCode}`);
    if (orderErr) throw new Error(orderErr.message);

    let matches = exact ?? [];

    // 1b. Fallback: partial reading (scanner cut the code). Only accept if unique.
    if (matches.length === 0 && cleanCode.length >= 3) {
      const { data: partial, error: partialErr } = await supabase
        .from("production_orders")
        .select(SELECT_COLS)
        .neq("status", "cancelada")
        .or(`order_number.ilike.%${cleanCode}%,barcode.ilike.%${cleanCode}%,customer_order.ilike.%${cleanCode}%`);
      if (partialErr) throw new Error(partialErr.message);
      matches = partial ?? [];
      if (matches.length > 1) {
        throw new Error(`Código "${cleanCode}" é incompleto (${matches.length} encomendas). Lê o código completo.`);
      }
    }

    if (matches.length === 0) {
      throw new Error(`Encomenda com código "${cleanCode}" não encontrada.`);
    }
    if (matches.length > 1) {
      throw new Error(`Nota "${cleanCode}" tem ${matches.length} artigos. Lê o código da coli ou o nº técnico do artigo.`);
    }

    const order = matches[0];
    if (order.status === "cancelada") {
      throw new Error(`A encomenda "${order.order_number}" está cancelada.`);
    }

    // 2. Load stages: embalagem must be concluded; picagem must NOT be concluded.
    const { data: stages, error: stagesErr } = await supabase
      .from("order_stages")
      .select("id, stage, status")
      .eq("order_id", order.id)
      .in("stage", ["embalagem", "picagem"]);
    if (stagesErr) throw new Error(stagesErr.message);

    const embalagem = (stages ?? []).find((s) => s.stage === "embalagem");
    const picagem = (stages ?? []).find((s) => s.stage === "picagem");
    if (!picagem) {
      throw new Error(`Encomenda "${order.order_number}" sem etapa de Picagem.`);
    }
    if (!embalagem || embalagem.status !== "concluida") {
      throw new Error(`Encomenda ainda não foi embalada na fábrica.`);
    }
    if (picagem.status === "concluida") {
      throw new Error(`A encomenda "${order.order_number}" já terminou a etapa de Picagem.`);
    }

    // 3. Real colis from order_colis
    const { data: colis, error: colisErr } = await supabase
      .from("order_colis")
      .select("coli_number, coli_name, coli_barcode")
      .eq("order_id", order.id)
      .order("coli_number", { ascending: true });
    if (colisErr) throw new Error(colisErr.message);
    if (!colis || colis.length === 0) {
      throw new Error(`Encomenda sem colis gerados. Conclua a etapa de Embalagem primeiro.`);
    }

    const package_total = colis.length;
    const packagesList: PickingColi[] = colis.map((c) => ({
      package_number: c.coli_number,
      package_total,
      package_name: c.coli_name ?? `Coli ${c.coli_number}`,
      expected_code: c.coli_barcode,
    }));

    return {
      id: order.id,
      order_number: order.order_number,
      product_description: order.product_description,
      structure_type: order.structure_type,
      measure: order.measure,
      fabric_type: order.fabric_type,
      fabric_ref: order.fabric_ref,
      color: order.color,
      observation: order.observation,
      stage_id: picagem.id,
      stage_status: picagem.status,
      package_total,
      packages: packagesList
    };
  });

// Validate a scanned coli code against the real colis of an order, and mark it picked.
// When all colis are picked, the picagem stage closes. The order stays "concluida" (packing sets it); picking only records the transfer.
export const scanPickingColi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    order_id: z.string().uuid(),
    code: z.string().trim().min(1),
    operator_code: z.string().trim().min(1),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: res, error } = await supabase.rpc("scan_picking_coli", {
      _order_id: data.order_id,
      _scanned_code: data.code,
      _operator_code: data.operator_code,
    });
    // Erros esperados (coli já lido, código inválido, etc.) devolvem uma
    // resposta suave para a UI mostrar um toast em vez de ecrã branco.
    if (error) {
      return {
        ok: false as const,
        message: error.message,
        coli_number: 0,
        coli_name: "",
        done: 0,
        total: 0,
        completed: false,
      };
    }
    return { ok: true as const, message: null as string | null, ...(res as any) } as {
      ok: boolean;
      message: string | null;
      coli_number: number;
      coli_name: string;
      done: number;
      total: number;
      completed: boolean;
    };
  });

// Call record_stage_event RPC to conclude the "picagem" stage
export const finalizePickingStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    stage_id: z.string().uuid(),
    operator_code: z.string().trim()
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // Record 'iniciar' first if it hasn't been started to satisfy constraint
    // "Não se pode finalizar uma etapa que não foi iniciada"
    const { data: stage } = await supabase
      .from("order_stages")
      .select("started_at")
      .eq("id", data.stage_id)
      .single();

    if (stage && !stage.started_at) {
      try {
        await supabase.rpc("record_stage_event", {
          _order_stage_id: data.stage_id,
          _operator_code: data.operator_code,
          _event: "iniciar"
        });
      } catch (e) {
        // Ignore potential errors if already started in parallel
      }
    }

    // Call record_stage_event to finish
    const { data: res, error } = await supabase.rpc("record_stage_event", {
      _order_stage_id: data.stage_id,
      _operator_code: data.operator_code,
      _event: "finalizar"
    });

    if (error) throw new Error(error.message);
    return res;
  });

// Send picking batch to Contagem Stock UP (if settings are configured)
export const sendPickingBatchToStock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    operator_code: z.string().trim(),
    order_ids: z.array(z.string().uuid())
  }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await hasAnyRole(context, ["admin", "escritorio", "picador"]))) {
      return {
        success: false,
        message: "Sem permissão para enviar lotes de picagem. Pede a um admin para te atribuir a função de picador.",
      };
    }
    const { supabase } = context;
    const url = process.env.STOCK_INTAKE_URL;
    const token = process.env.STOCK_INTAKE_TOKEN;

    if (!url || !token) {
      return { 
        success: false, 
        message: "Configuração ausente. Introduza o STOCK_INTAKE_URL e STOCK_INTAKE_TOKEN nas definições do Lovable para enviar stock." 
      };
    }

    // Fetch orders details
    const { data: orders, error } = await supabase
      .from("production_orders")
      .select("id, order_number, barcode, product_description, measure, fabric_type, fabric_ref, color, models(code)")
      .in("id", data.order_ids);

    if (error) throw new Error(error.message);

    // Build batch payload
    const batchId = crypto.randomUUID();
    const items = (orders ?? []).map(o => ({
      order_number: o.order_number,
      product_code: (o as any).models?.code ?? o.product_description,
      barcode: o.barcode || o.order_number || "", // Ensures it's a string, not null
      product_description: o.product_description,
      measure: o.measure,
      fabric_type: o.fabric_type,
      fabric_ref: o.fabric_ref,
      color: o.color,
      quantity: 1,
      dispatched_at: new Date().toISOString()
    }));

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-up-token": token
        },
        body: JSON.stringify({
          batch_id: batchId,
          items
        })
      });

      const responseBody = await response.text();
      const status = response.ok ? "enviado" : "erro";

      // Registo do envio + conclusão das encomendas via RPC seguro
      // (permite que o picador feche o lote sem alargar as políticas de acesso).
      const { data: res, error: rpcErr } = await (supabase as any).rpc("record_picking_dispatch", {
        _batch_id: batchId,
        _order_ids: data.order_ids,
        _operator_code: data.operator_code,
        _status: status,
        _response_code: response.status,
        _response_body: responseBody,
      });

      if (rpcErr) {
        return {
          success: false,
          message: response.ok
            ? `Lote enviado, mas não foi possível registar a conclusão: ${rpcErr.message}`
            : `Erro do servidor externo (${response.status}) e falha ao registar: ${rpcErr.message}`,
        };
      }

      const concluded = (res as any)?.concluded ?? 0;

      return {
        success: response.ok,
        status: response.status,
        message: response.ok
          ? `Lote enviado com sucesso! ${concluded} encomenda(s) marcada(s) como concluída(s).`
          : `Erro do servidor externo (${response.status}): ${responseBody}`
      };

    } catch (e: any) {
      // Registar a falha (best effort)
      await (supabase as any).rpc("record_picking_dispatch", {
        _batch_id: batchId,
        _order_ids: data.order_ids,
        _operator_code: data.operator_code,
        _status: "erro",
        _response_code: null,
        _response_body: e?.message || "Network error",
      });

      return {
        success: false,
        message: `Falha na ligação de rede com o stock: ${e.message}`
      };
    }
  });
// Orders already fully picked (picagem concluída) but not yet dispatched to stock.
// Prevents "lost" orders when the picker refreshes before pressing "Enviar lote".
export type PendingDispatchOrder = {
  order_id: string;
  order_number: string;
  product_description: string;
  structure_type: string | null;
  measure: string | null;
  color: string | null;
  coli_total: number;
  picked_at: string | null;
};

export const listPendingDispatch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PendingDispatchOrder[]> => {
    const { supabase } = context;
    const { data: stages, error } = await supabase
      .from("order_stages")
      .select("order_id, finished_at, production_orders!inner(id, order_number, product_description, structure_type, measure, color, status)")
      .eq("stage", "picagem")
      .eq("status", "concluida")
      .order("finished_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const rows = ((stages ?? []) as any[]).filter((s) => s.production_orders?.status !== "cancelada");
    const orderIds = rows.map((s) => s.order_id);
    if (orderIds.length === 0) return [];

    // Exclude anything already dispatched successfully
    const { data: sent } = await supabase
      .from("picking_dispatches")
      .select("order_id, status")
      .in("order_id", orderIds)
      .eq("status", "enviado");
    const sentSet = new Set(((sent ?? []) as any[]).map((d) => d.order_id));

    const { data: colis } = await supabase
      .from("order_colis")
      .select("id, order_id")
      .in("order_id", orderIds);
    const totals = new Map<string, number>();
    for (const c of (colis ?? []) as any[]) totals.set(c.order_id, (totals.get(c.order_id) ?? 0) + 1);

    return rows
      .filter((s) => !sentSet.has(s.order_id))
      .map((s) => ({
        order_id: s.order_id,
        order_number: s.production_orders.order_number,
        product_description: s.production_orders.product_description,
        structure_type: s.production_orders.structure_type,
        measure: s.production_orders.measure,
        color: s.production_orders.color,
        coli_total: totals.get(s.order_id) ?? 0,
        picked_at: s.finished_at ?? null,
      }));
  });
