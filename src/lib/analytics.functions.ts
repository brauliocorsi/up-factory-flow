import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Analítica de produção e operadores.
 * - KPIs gerais
 * - Trabalho activo por operador
 * - Eficiência (melhores e piores) com filtros por data
 */

export type ProductionKpis = {
  em_producao: number;
  pausadas: number;
  bloqueadas: number;
  concluidas_hoje: number;
  retrabalhos_abertos: number;
  operadores_ativos: number;
  tempo_produtivo_hoje_min: number;
};

export const getProductionKpis = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProductionKpis> => {
    const sb = context.supabase as any;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const isoToday = today.toISOString();

    const [stagesAtivas, concluidasHoje, retrabalhos] = await Promise.all([
      sb.from("order_stages").select("id, status, is_paused, operator_id").in("status", ["em_curso", "bloqueada"]),
      sb.from("order_stages").select("id, productive_seconds").eq("status", "concluida").gte("finished_at", isoToday),
      sb.from("rework_events").select("id", { count: "exact", head: true }).eq("status", "aberto"),
    ]);

    const rows = (stagesAtivas.data ?? []) as any[];
    const ativos = new Set<string>();
    let em_producao = 0, pausadas = 0, bloqueadas = 0;
    for (const r of rows) {
      if (r.status === "bloqueada") bloqueadas++;
      else if (r.is_paused) pausadas++;
      else { em_producao++; if (r.operator_id) ativos.add(r.operator_id); }
    }

    const concluidas = (concluidasHoje.data ?? []) as any[];
    const tempoProdSec = concluidas.reduce((acc, r) => acc + (r.productive_seconds ?? 0), 0);

    return {
      em_producao,
      pausadas,
      bloqueadas,
      concluidas_hoje: concluidas.length,
      retrabalhos_abertos: retrabalhos.count ?? 0,
      operadores_ativos: ativos.size,
      tempo_produtivo_hoje_min: Math.round(tempoProdSec / 60),
    };
  });

export type OperatorActiveWork = {
  operator_id: string;
  operator_code: string;
  operator_name: string;
  items: Array<{
    order_stage_id: string;
    order_number: string;
    product_description: string;
    stage: string;
    is_paused: boolean;
    started_at: string | null;
    productive_seconds: number;
  }>;
};

export const getActiveByOperator = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OperatorActiveWork[]> => {
    const sb = context.supabase as any;
    const { data, error } = await sb
      .from("order_stages")
      .select("id, stage, is_paused, started_at, productive_seconds, operator_id, operators(code, name), production_orders!inner(order_number, product_description, status)")
      .eq("status", "em_curso")
      .neq("production_orders.status", "cancelada")
      .not("operator_id", "is", null);
    if (error) throw new Error(error.message);

    const map = new Map<string, OperatorActiveWork>();
    for (const r of (data ?? []) as any[]) {
      const op = r.operators;
      if (!op) continue;
      const cur: OperatorActiveWork = map.get(r.operator_id) ?? {
        operator_id: r.operator_id,
        operator_code: op.code,
        operator_name: op.name,
        items: [],
      };
      cur.items.push({
        order_stage_id: r.id,
        order_number: r.production_orders.order_number,
        product_description: r.production_orders.product_description,
        stage: r.stage,
        is_paused: Boolean(r.is_paused),
        started_at: r.started_at,
        productive_seconds: r.productive_seconds ?? 0,
      });
      map.set(r.operator_id, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.items.length - a.items.length);
  });

export type OperatorEfficiency = {
  operator_id: string;
  operator_code: string;
  operator_name: string;
  stages_concluidas: number;
  tempo_produtivo_min: number;
  tempo_esperado_min: number;
  eficiencia_pct: number | null; // 100 = exatamente no esperado; >100 melhor
  retrabalhos: number;
};

const rangeSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export const getOperatorEfficiency = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => rangeSchema.parse(d))
  .handler(async ({ data, context }): Promise<OperatorEfficiency[]> => {
    const sb = context.supabase as any;
    const from = data.from ? new Date(data.from) : (() => { const d = new Date(); d.setDate(d.getDate() - 30); d.setHours(0,0,0,0); return d; })();
    const to = data.to ? new Date(data.to) : new Date();

    let q = sb.from("order_stages")
      .select("operator_id, stage, productive_seconds, order_id, finished_at, operators(code, name)")
      .eq("status", "concluida")
      .not("operator_id", "is", null)
      .gte("finished_at", from.toISOString())
      .lte("finished_at", to.toISOString());
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    // Resolver expected_minutes em lote via RPC por linha (chamadas paralelas)
    const stages = (rows ?? []) as any[];
    const expected = await Promise.all(
      stages.map((r) =>
        sb.rpc("get_expected_minutes", { _order_id: r.order_id, _stage: r.stage })
          .then((res: any) => (typeof res?.data === "number" ? res.data : null))
          .catch(() => null)
      )
    );

    // Retrabalhos no período por operador
    const { data: reworks } = await sb.from("rework_events")
      .select("operator_id, created_at")
      .gte("created_at", from.toISOString())
      .lte("created_at", to.toISOString());
    const reworkByOp = new Map<string, number>();
    for (const r of (reworks ?? []) as any[]) {
      if (!r.operator_id) continue;
      reworkByOp.set(r.operator_id, (reworkByOp.get(r.operator_id) ?? 0) + 1);
    }

    const acc = new Map<string, OperatorEfficiency>();
    stages.forEach((r, i) => {
      const op = r.operators; if (!op) return;
      const cur = acc.get(r.operator_id) ?? {
        operator_id: r.operator_id,
        operator_code: op.code,
        operator_name: op.name,
        stages_concluidas: 0,
        tempo_produtivo_min: 0,
        tempo_esperado_min: 0,
        eficiencia_pct: null,
        retrabalhos: 0,
      };
      cur.stages_concluidas += 1;
      cur.tempo_produtivo_min += Math.round((r.productive_seconds ?? 0) / 60);
      const exp = expected[i];
      if (typeof exp === "number" && exp > 0) cur.tempo_esperado_min += exp;
      acc.set(r.operator_id, cur);
    });

    const result = Array.from(acc.values()).map((o) => {
      const eff = o.tempo_produtivo_min > 0 && o.tempo_esperado_min > 0
        ? Math.round((o.tempo_esperado_min / o.tempo_produtivo_min) * 100)
        : null;
      return {
        ...o,
        eficiencia_pct: eff,
        retrabalhos: reworkByOp.get(o.operator_id) ?? 0,
      };
    });

    return result.sort((a, b) => (b.eficiencia_pct ?? -1) - (a.eficiencia_pct ?? -1));
  });
