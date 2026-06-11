import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type PickingColi = {
  package_number: number;
  package_total: number;
  package_name: string;
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

// Resolve an order from scanner reading (order_number)
export const resolveOrderForPicking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ code: z.string().trim() }).parse(d))
  .handler(async ({ data, context }): Promise<PickingOrder> => {
    const { supabase } = context;
    const cleanCode = data.code;

    // 1. Find the production order
    const { data: order, error: orderErr } = await supabase
      .from("production_orders")
      .select("id, order_number, product_description, structure_type, measure, fabric_type, fabric_ref, color, observation, model_id")
      .or(`order_number.eq.${cleanCode},barcode.eq.${cleanCode}`)
      .eq("status", "em_producao")
      .maybeSingle();

    if (orderErr) throw new Error(orderErr.message);
    if (!order) {
      throw new Error(`Encomenda com código "${cleanCode}" não encontrada ou não está em produção.`);
    }

    // 2. Check if the order is in the "picagem" stage
    const { data: stage, error: stageErr } = await supabase
      .from("order_stages")
      .select("id, status")
      .eq("order_id", order.id)
      .eq("stage", "picagem")
      .single();

    if (stageErr) throw new Error(stageErr.message);
    if (stage.status === "concluida") {
      throw new Error(`A encomenda "${order.order_number}" já terminou a etapa de Picagem.`);
    }

    // 3. Resolve the expected packages (colis) from model_packages
    if (!order.model_id) {
      throw new Error(`Encomenda sem modelo atribuído.`);
    }

    const { data: pkgs, error: pkgsErr } = await supabase
      .from("model_packages")
      .select("package_number, package_total, package_name, structure_type")
      .eq("model_id", order.model_id);

    if (pkgsErr) throw new Error(pkgsErr.message);

    // Filter packages matching the structure_type, or generic ones
    const candidates = pkgs ?? [];
    const matched = candidates.filter(
      (p) => p.structure_type && order.structure_type && p.structure_type === order.structure_type
    );
    const generic = candidates.filter((p) => !p.structure_type);
    const chosen = matched.length ? matched : generic.length ? generic : candidates;

    // Sort by package number
    const sortedPackages = chosen.sort((a, b) => a.package_number - b.package_number);

    // Fallback: If no packages are registered for this model/structure, assume 1 generic coli
    const packagesList: PickingColi[] = sortedPackages.length > 0 
      ? sortedPackages.map(p => ({
          package_number: p.package_number,
          package_total: p.package_total,
          package_name: p.package_name
        }))
      : [{ package_number: 1, package_total: 1, package_name: "Volume Único" }];

    const package_total = packagesList[0]?.package_total ?? 1;

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
      stage_id: stage.id,
      stage_status: stage.status,
      package_total,
      packages: packagesList
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

    // Find operator id
    const { data: op } = await supabase
      .from("operators")
      .select("id")
      .eq("code", data.operator_code)
      .single();

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
      const status = response.ok ? 'enviado' : 'erro';

      // Record dispatch history
      const inserts = data.order_ids.map(oid => ({
        order_id: oid,
        batch_id: batchId,
        status: status as any,
        response_code: response.status,
        response_body: responseBody.slice(0, 1000), // safe truncation
        operator_id: op?.id || null,
        dispatched_at: new Date().toISOString()
      }));

      await supabase.from("picking_dispatches").insert(inserts);

      return {
        success: response.ok,
        status: response.status,
        message: response.ok ? "Lote enviado com sucesso!" : `Erro do servidor externo (${response.status}): ${responseBody}`
      };
    } catch (e: any) {
      // Log failure in our DB too
      const inserts = data.order_ids.map(oid => ({
        order_id: oid,
        batch_id: batchId,
        status: 'erro' as any,
        response_body: e.message || "Network error",
        operator_id: op?.id || null,
        dispatched_at: new Date().toISOString()
      }));
      await supabase.from("picking_dispatches").insert(inserts);

      return {
        success: false,
        message: `Falha na ligação de rede com o stock: ${e.message}`
      };
    }
  });