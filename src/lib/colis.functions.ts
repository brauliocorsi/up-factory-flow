import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { STAGES, type Stage } from "@/lib/production.functions";

// Ordem canónica das etapas (igual à função SQL stage_order_index).
const STAGE_ORDER: Record<Stage, number> = {
  estrutura: 1, corte: 2, costura: 3, branco: 4,
  estofagem: 5, qualidade: 6, embalagem: 7, picagem: 8,
};

/**
 * Colis (Parte 2) — operação por coli na produção.
 *
 * Cada coli tem o seu próprio Iniciar/Pausar/Retomar/Finalizar com
 * cronómetro próprio. O agregado em `order_stages` é sincronizado
 * automaticamente pelo RPC `record_coli_stage_event` no servidor.
 */

export type ColiStageItem = {
  id: string;                    // order_coli_stages.id
  order_id: string;
  order_coli_id: string;
  coli_number: number;
  coli_name: string;
  stage: Stage;
  status: string;
  is_paused: boolean;
  productive_seconds: number;
  paused_seconds: number;
  started_at: string | null;
  finished_at: string | null;
  last_resume_at: string | null;
  operator_code: string | null;
};

export type ColiSummary = {
  order_coli_id: string;
  coli_number: number;
  coli_name: string;
  current_stage: Stage | null;     // primeira etapa não concluída da rota deste coli
  current_status: string | null;   // status nessa etapa
  done_stages: Stage[];
  pending_stages: Stage[];
};

type ColiRouteInfo = { order_coli_id: string; order_id: string; coli_number: number };

function nestedCategoryCode(models: any): string | null {
  const model = Array.isArray(models) ? models[0] : models;
  const category = Array.isArray(model?.ref_categories) ? model.ref_categories[0] : model?.ref_categories;
  return category?.code ?? null;
}

async function loadRouteStageOrder(sb: any, colis: ColiRouteInfo[]) {
  const uniqueColis = Array.from(new Map(colis.map((c) => [c.order_coli_id, c])).values());
  const orderIds = Array.from(new Set(uniqueColis.map((c) => c.order_id)));
  const orderKeys = new Map<string, { category_code: string | null; structure_code: string | null }>();
  if (orderIds.length === 0) return new Map<string, Map<Stage, number>>();

  const { data: orders } = await sb
    .from("production_orders")
    .select("id, structure_type, models(ref_categories(code))")
    .in("id", orderIds);

  for (const o of (orders ?? []) as any[]) {
    orderKeys.set(o.id, {
      category_code: nestedCategoryCode(o.models),
      structure_code: o.structure_type ?? null,
    });
  }

  const categories = Array.from(new Set(Array.from(orderKeys.values()).map((k) => k.category_code).filter(Boolean))) as string[];
  const structures = Array.from(new Set(Array.from(orderKeys.values()).map((k) => k.structure_code).filter(Boolean))) as string[];
  if (categories.length === 0 || structures.length === 0) return new Map<string, Map<Stage, number>>();

  const { data: routes } = await sb
    .from("structure_coli_routes")
    .select("id, category_code, structure_code, coli_number, structure_coli_stages(stage, included, sort_order)")
    .in("category_code", categories)
    .in("structure_code", structures);

  const routeStages = new Map<string, Map<Stage, number>>();
  for (const r of (routes ?? []) as any[]) {
    const stages = new Map<Stage, number>();
    for (const s of (r.structure_coli_stages ?? []) as any[]) {
      if (s.included) stages.set(s.stage as Stage, Number(s.sort_order ?? 0));
    }
    routeStages.set(`${r.category_code}|${r.structure_code}|${r.coli_number}`, stages);
  }

  const byColi = new Map<string, Map<Stage, number>>();
  for (const c of uniqueColis) {
    const key = orderKeys.get(c.order_id);
    const route = key ? routeStages.get(`${key.category_code}|${key.structure_code}|${c.coli_number}`) : null;
    if (route) byColi.set(c.order_coli_id, route);
  }
  return byColi;
}

function routeRank(stage: Stage, routeOrder?: Map<Stage, number>) {
  const configured = routeOrder?.get(stage);
  const fallback = STAGE_ORDER[stage] ?? 99;
  return configured == null ? 1000 + fallback : configured * 100 + fallback;
}

/** Lista os colis em curso/pendentes numa etapa, agrupados por encomenda. */
export const getColisByStage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ stage: z.enum(STAGES) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    // 1) Etapas desta aba ainda não concluídas.
    const { data: rows, error } = await sb
      .from("order_coli_stages")
      .select(
        `id, order_id, order_coli_id, stage, status, is_paused,
         productive_seconds, paused_seconds, started_at, finished_at, last_resume_at,
         order_colis!inner(coli_number, coli_name),
         operators(code)`,
      )
      .eq("stage", data.stage)
      .neq("status", "concluida");
    if (error) throw new Error(error.message);

    // 2) Como create_order_colis cria TODAS as etapas da rota em 'pendente'
    //    de uma só vez, é preciso filtrar: só mostrar o coli na aba <stage>
    //    se <stage> for a PRIMEIRA etapa ainda não concluída da rota desse coli.
    //    (i.e. todas as etapas anteriores da rota têm de estar 'concluida').
    const coliIds = Array.from(new Set((rows ?? []).map((r: any) => r.order_coli_id)));
    const currentStageByColi = new Map<string, Stage>();
    if (coliIds.length > 0) {
      const { data: allStages, error: eS } = await sb
        .from("order_coli_stages")
        .select("order_coli_id, stage, status")
        .in("order_coli_id", coliIds);
      if (eS) throw new Error(eS.message);
      const byColi = new Map<string, { stage: Stage; status: string }[]>();
      for (const r of (allStages ?? []) as any[]) {
        const arr = byColi.get(r.order_coli_id) ?? [];
        arr.push({ stage: r.stage, status: r.status });
        byColi.set(r.order_coli_id, arr);
      }
      for (const [cid, arr] of byColi) {
        const sorted = arr
          .slice()
          .sort((a, b) => (STAGE_ORDER[a.stage] ?? 99) - (STAGE_ORDER[b.stage] ?? 99));
        const current = sorted.find((s) => s.status !== "concluida");
        if (current) currentStageByColi.set(cid, current.stage);
      }
    }

    const filtered = (rows ?? []).filter(
      (r: any) => currentStageByColi.get(r.order_coli_id) === data.stage,
    );

    const items: ColiStageItem[] = filtered.map((r: any) => ({
      id: r.id,
      order_id: r.order_id,
      order_coli_id: r.order_coli_id,
      coli_number: r.order_colis?.coli_number ?? 0,
      coli_name: r.order_colis?.coli_name ?? "",
      stage: r.stage,
      status: r.status,
      is_paused: Boolean(r.is_paused),
      productive_seconds: r.productive_seconds ?? 0,
      paused_seconds: r.paused_seconds ?? 0,
      started_at: r.started_at,
      finished_at: r.finished_at,
      last_resume_at: r.last_resume_at,
      operator_code: r.operators?.code ?? null,
    }));

    const byOrder: Record<string, ColiStageItem[]> = {};
    for (const it of items) {
      (byOrder[it.order_id] ??= []).push(it);
    }
    for (const arr of Object.values(byOrder)) {
      arr.sort((a, b) => a.coli_number - b.coli_number);
    }

    // Decidir "vista por coli" pelo TOTAL de order_colis da encomenda,
    // não pelos colis presentes nesta etapa. Caso contrário, ao finalizar
    // todos menos um coli, o cartão colapsa para a vista antiga.
    const orderIds = Object.keys(byOrder);
    const multiColiOrderIds: string[] = [];
    if (orderIds.length > 0) {
      const { data: allColis, error: e2 } = await sb
        .from("order_colis")
        .select("order_id")
        .in("order_id", orderIds);
      if (e2) throw new Error(e2.message);
      const counts = new Map<string, number>();
      for (const r of (allColis ?? []) as any[]) {
        counts.set(r.order_id, (counts.get(r.order_id) ?? 0) + 1);
      }
      for (const [oid, n] of counts) {
        if (n > 1) multiColiOrderIds.push(oid);
      }
    }
    return { byOrder, multiColiOrderIds };
  });

/** Resumo dos colis duma encomenda (para mostrar "Cabeceira ✓ · Ilhargas em curso"). */
export const getColisSummaryForOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ order_ids: z.array(z.string().uuid()).min(1) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<Record<string, ColiSummary[]>> => {
    const sb = context.supabase as any;
    const { data: colis, error } = await sb
      .from("order_colis")
      .select(`id, order_id, coli_number, coli_name`)
      .in("order_id", data.order_ids);
    if (error) throw new Error(error.message);

    const coliIds = (colis ?? []).map((c: any) => c.id);
    let stagesByColi = new Map<string, { stage: Stage; status: string }[]>();
    if (coliIds.length > 0) {
      const { data: cs, error: e2 } = await sb
        .from("order_coli_stages")
        .select("order_coli_id, stage, status, created_at")
        .in("order_coli_id", coliIds)
        .order("created_at", { ascending: true });
      if (e2) throw new Error(e2.message);
      for (const s of (cs ?? []) as any[]) {
        const arr = stagesByColi.get(s.order_coli_id) ?? [];
        arr.push({ stage: s.stage, status: s.status });
        stagesByColi.set(s.order_coli_id, arr);
      }
    }

    const out: Record<string, ColiSummary[]> = {};
    for (const c of (colis ?? []) as any[]) {
      const all = stagesByColi.get(c.id) ?? [];
      const done = all.filter((x) => x.status === "concluida").map((x) => x.stage);
      const pending = all.filter((x) => x.status !== "concluida").map((x) => x.stage);
      const current = all.find((x) => x.status !== "concluida") ?? null;
      (out[c.order_id] ??= []).push({
        order_coli_id: c.id,
        coli_number: c.coli_number,
        coli_name: c.coli_name,
        current_stage: current?.stage ?? null,
        current_status: current?.status ?? null,
        done_stages: done,
        pending_stages: pending,
      });
    }
    for (const arr of Object.values(out)) {
      arr.sort((a, b) => a.coli_number - b.coli_number);
    }
    return out;
  });

const eventSchema = z.object({
  order_coli_stage_id: z.string().uuid(),
  operator_code: z.string().trim().min(1).max(32),
  event: z.enum(["iniciar", "pausar", "retomar", "finalizar"]),
});

export const recordColiStageEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => eventSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc(
      "record_coli_stage_event",
      {
        _order_coli_stage_id: data.order_coli_stage_id,
        _operator_code: data.operator_code,
        _event: data.event,
      },
    );
    if (error) throw new Error(error.message);
    return res;
  });