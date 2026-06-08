import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

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
};

export type DashboardData = {
  stats: { pendentes: number; em_producao: number; concluidas_hoje: number; bloqueadas: number };
  byStage: Record<string, DashboardOrder[]>;
};

const STAGES = ["estrutura","corte","costura","branco","estofagem","qualidade","embalagem","picagem"] as const;

export const getDashboardData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardData> => {
    const { supabase } = context;
    const { data: orders, error } = await supabase
      .from("production_orders")
      .select("id, order_number, product_description, priority, due_date, status, models(name), order_stages(stage, status, started_at)")
      .neq("status", "cancelada")
      .order("priority", { ascending: false })
      .order("entry_date", { ascending: true });
    if (error) throw new Error(error.message);

    const byStage: Record<string, DashboardOrder[]> = {};
    STAGES.forEach((s) => (byStage[s] = []));

    let pendentes = 0, em_producao = 0, bloqueadas = 0;
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
      stats: { pendentes, em_producao, concluidas_hoje: count ?? 0, bloqueadas },
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
  product_description: string;
  model_name: string | null;
  measure: string | null;
  fabric_type: string | null;
  entry_date: string;
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
      .select("id, order_number, product_description, measure, fabric_type, entry_date, due_date, status, models(name), order_stages(stage, status)")
      .order("entry_date", { ascending: false });
    if (data.search) q = q.ilike("order_number", `%${data.search}%`);
    if (data.status) q = q.eq("status", data.status as any);
    if (data.modelId) q = q.eq("model_id", data.modelId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((o: any) => {
      const stages: any[] = o.order_stages ?? [];
      const current = STAGES.map((name) => stages.find((s) => s.stage === name && s.status !== "concluida")).find(Boolean) ?? { stage: "picagem" };
      return {
        id: o.id, order_number: o.order_number, product_description: o.product_description,
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