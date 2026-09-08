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
      sb.from("order_stages")
        .select("id, status, is_paused, operator_id, production_orders!inner(is_test)")
        .in("status", ["em_curso", "bloqueada"])
        .eq("production_orders.is_test", false),
      sb.from("order_stages")
        .select("id, productive_seconds, production_orders!inner(is_test)")
        .eq("status", "concluida")
        .eq("production_orders.is_test", false)
        .gte("finished_at", isoToday),
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
      .select("operator_id, stage, productive_seconds, order_id, finished_at, operators(code, name), production_orders!inner(is_test)")
      .eq("status", "concluida")
      .eq("production_orders.is_test", false)
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

// ============================================================
// Fase 6 — indicadores fiáveis e operações esquecidas
// ============================================================

export type OperatorTimeBreakdown = {
  operator_id: string;
  operator_code: string;
  operator_name: string;
  operacoes: number;
  processo_min: number; // do início ao fim (relógio de parede)
  mao_de_obra_min: number; // tempo efectivamente a trabalhar
  espera_min: number; // pausas e paragens
};

/**
 * Tempo por pessoa no período, separando duração do processo, mão de obra e
 * espera. Baseia-se nos volumes (order_coli_stages) e ignora encomendas
 * marcadas como teste.
 */
export const getOperatorTimeBreakdown = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => rangeSchema.parse(d))
  .handler(async ({ data, context }): Promise<OperatorTimeBreakdown[]> => {
    const sb = context.supabase as any;
    const from = data.from ? new Date(data.from) : (() => { const d = new Date(); d.setDate(d.getDate() - 30); d.setHours(0, 0, 0, 0); return d; })();
    const to = data.to ? new Date(data.to) : new Date();

    const { data: rows, error } = await sb
      .from("order_coli_stages")
      .select("operator_id, started_at, finished_at, productive_seconds, paused_seconds, operators(code, name), production_orders!inner(is_test)")
      .eq("status", "concluida")
      .eq("production_orders.is_test", false)
      .not("operator_id", "is", null)
      .gte("finished_at", from.toISOString())
      .lte("finished_at", to.toISOString());
    if (error) throw new Error(error.message);

    const acc = new Map<string, OperatorTimeBreakdown>();
    for (const r of (rows ?? []) as any[]) {
      const op = r.operators;
      if (!op) continue;
      const cur = acc.get(r.operator_id) ?? {
        operator_id: r.operator_id,
        operator_code: op.code,
        operator_name: op.name,
        operacoes: 0,
        processo_min: 0,
        mao_de_obra_min: 0,
        espera_min: 0,
      };
      const labourSec = Math.max(0, r.productive_seconds ?? 0);
      let processSec = labourSec;
      if (r.started_at && r.finished_at) {
        const diff = (new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000;
        if (Number.isFinite(diff) && diff > 0) processSec = diff;
      }
      const waitSec = Math.max(0, processSec - labourSec);
      cur.operacoes += 1;
      cur.processo_min += processSec / 60;
      cur.mao_de_obra_min += labourSec / 60;
      cur.espera_min += waitSec / 60;
      acc.set(r.operator_id, cur);
    }

    return Array.from(acc.values())
      .map((o) => ({
        ...o,
        processo_min: Math.round(o.processo_min),
        mao_de_obra_min: Math.round(o.mao_de_obra_min),
        espera_min: Math.round(o.espera_min),
      }))
      .sort((a, b) => b.mao_de_obra_min - a.mao_de_obra_min);
  });

export type ForgottenStage = {
  order_coli_stage_id: string;
  order_id: string;
  order_number: string;
  coli_number: number;
  total_colis: number;
  stage: string;
  operator_code: string | null;
  operator_name: string | null;
  started_at: string | null;
  hours_running: number;
  is_test: boolean;
};

export const listForgottenStages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ min_hours: z.number().min(0).max(720).optional() }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<{ ok: true; items: ForgottenStage[] } | { ok: false; message: string }> => {
    const { data: rows, error } = await (context.supabase as any).rpc("list_forgotten_stages", {
      _min_hours: data.min_hours ?? 12,
    });
    if (error) return { ok: false, message: error.message };
    return {
      ok: true,
      items: ((rows ?? []) as any[]).map((r) => ({
        order_coli_stage_id: r.order_coli_stage_id,
        order_id: r.order_id,
        order_number: r.order_number,
        coli_number: r.coli_number,
        total_colis: r.total_colis,
        stage: r.stage,
        operator_code: r.operator_code ?? null,
        operator_name: r.operator_name ?? null,
        started_at: r.started_at ?? null,
        hours_running: Number(r.hours_running ?? 0),
        is_test: Boolean(r.is_test),
      })),
    };
  });

export const pauseForgottenStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ order_coli_stage_id: z.string().uuid(), reason: z.string().trim().max(300).optional() }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc("admin_pause_forgotten_stage", {
      _order_coli_stage_id: data.order_coli_stage_id,
      _reason: data.reason ?? null,
    });
    if (error) return { ok: false as const, message: error.message };
    return res as { ok: boolean; message: string };
  });

export const setOrdersTestFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ order_ids: z.array(z.string().uuid()).min(1).max(500), is_test: z.boolean() }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc("set_orders_test_flag", {
      _order_ids: data.order_ids,
      _is_test: data.is_test,
    });
    if (error) return { ok: false as const, message: error.message };
    return { ok: true as const, updated: Number(res ?? 0) };
  });

// ============================================================
// Etapa 13 — mão de obra por pessoa e por dia (Europe/Lisbon)
// ============================================================

export type LaborDayRow = {
  day: string;              // AAAA-MM-DD (hora de Lisboa)
  operator_id: string | null;
  operator_code: string;
  operator_name: string;
  minutos: number;
  volumes: number;
};

/**
 * Reparte o tempo efectivamente trabalhado por pessoa e por dia, a partir dos
 * períodos de trabalho registados em cada volume. Períodos que atravessam a
 * meia-noite são divididos pelo dia respectivo (hora de Lisboa). Encomendas
 * marcadas como teste ficam de fora. Só admin/escritório.
 */
export const getLaborByPersonDaily = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; rows: LaborDayRow[] } | { ok: false; message: string }> => {
    const { data: res, error } = await (context.supabase as any).rpc("labor_by_person", {
      _from: data.from,
      _to: data.to,
    });
    if (error) return { ok: false as const, message: error.message };
    const rows: LaborDayRow[] = ((res ?? []) as any[]).map((r) => ({
      day: String(r.day),
      operator_id: r.operator_id ?? null,
      operator_code: r.operator_code ?? "—",
      operator_name: r.operator_name ?? "Sem operador",
      minutos: Math.round(Number(r.seconds ?? 0) / 60),
      volumes: Number(r.stages ?? 0),
    }));
    return { ok: true as const, rows };
  });
