import type { Stage } from "@/lib/production.functions";

// Ordem canónica das etapas (igual à função SQL stage_order_index).
export const STAGE_ORDER: Record<Stage, number> = {
  estrutura: 1, corte: 2, costura: 3, branco: 4,
  estofagem: 5, qualidade: 6, embalagem: 7, picagem: 8,
};

type ColiRouteInfo = { order_coli_id: string; order_id: string; coli_number: number };

export async function loadRouteStageOrder(colis: ColiRouteInfo[]) {
  // Use admin client: route/catalog lookup tables are blocked for operator-only users
  // by RESTRICTIVE RLS. Auth is already enforced by requireSupabaseAuth on the caller.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sb: any = supabaseAdmin;
  const uniqueColis = Array.from(new Map(colis.map((c) => [c.order_coli_id, c])).values());
  const orderIds = Array.from(new Set(uniqueColis.map((c) => c.order_id)));
  const orderKeys = new Map<string, { category_code: string | null; structure_code: string | null }>();
  if (orderIds.length === 0) return new Map<string, Map<Stage, number>>();

  const { data: orders } = await sb
    .from("production_orders")
    .select("id, structure_type, model_id")
    .in("id", orderIds);

  const modelIds = Array.from(new Set(((orders ?? []) as any[]).map((o) => o.model_id).filter(Boolean))) as string[];
  const { data: models } = modelIds.length > 0
    ? await sb.from("models").select("id, category_id").in("id", modelIds)
    : { data: [] };
  const categoryIds = Array.from(new Set(((models ?? []) as any[]).map((m) => m.category_id).filter(Boolean))) as string[];
  const { data: categoryRows } = categoryIds.length > 0
    ? await sb.from("ref_categories").select("id, code").in("id", categoryIds)
    : { data: [] };
  const categoryById = new Map(((categoryRows ?? []) as any[]).map((c) => [c.id, c.code]));
  const categoryByModelId = new Map(((models ?? []) as any[]).map((m) => [m.id, categoryById.get(m.category_id) ?? null]));
  const { data: structureRows } = await sb.from("ref_structures").select("code, name");
  const structureCodeByValue = new Map<string, string>();
  for (const s of (structureRows ?? []) as any[]) {
    structureCodeByValue.set(s.code, s.code);
    structureCodeByValue.set(s.name, s.code);
  }

  for (const o of (orders ?? []) as any[]) {
    orderKeys.set(o.id, {
      category_code: categoryByModelId.get(o.model_id) ?? null,
      structure_code: structureCodeByValue.get(o.structure_type) ?? o.structure_type ?? null,
    });
  }

  const routeCategories = Array.from(new Set(Array.from(orderKeys.values()).map((k) => k.category_code).filter(Boolean))) as string[];
  const structures = Array.from(new Set(Array.from(orderKeys.values()).map((k) => k.structure_code).filter(Boolean))) as string[];
  if (routeCategories.length === 0 || structures.length === 0) return new Map<string, Map<Stage, number>>();

  const { data: routes } = await sb
    .from("structure_coli_routes")
    .select("id, category_code, structure_code, coli_number, structure_coli_stages(stage, included, sort_order)")
    .in("category_code", routeCategories)
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

export function routeRank(stage: Stage, routeOrder?: Map<Stage, number>) {
  const configured = routeOrder?.get(stage);
  const fallback = STAGE_ORDER[stage] ?? 99;
  return configured == null ? 1000 + fallback : configured * 100 + fallback;
}