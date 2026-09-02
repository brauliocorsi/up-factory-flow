import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAnyRole } from "@/lib/roleGuards";
import { z } from "zod";

/**
 * QUALIDADE — templates por categoria + registo de conferências.
 * Reutiliza operadores e o sistema de retrabalho existentes.
 */

export type QualityTemplate = {
  id: string;
  category_code: string;
  name: string;
  active: boolean;
  is_default?: boolean;
  items: { id: string; label: string; sort_order: number }[];
};

export const listQualityTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<QualityTemplate[]> => {
    const sb = context.supabase as any;
    const { data: tpls, error } = await sb
      .from("quality_templates")
      .select("id, category_code, name, active, is_default")
      .order("category_code");
    if (error) throw new Error(error.message);
    const ids = (tpls ?? []).map((t: any) => t.id);
    const { data: items } = ids.length
      ? await sb.from("quality_template_items")
          .select("id, template_id, label, sort_order")
          .in("template_id", ids).order("sort_order")
      : { data: [] as any[] };
    const byT = new Map<string, any[]>();
    for (const it of (items ?? []) as any[]) {
      const arr = byT.get(it.template_id) ?? [];
      arr.push({ id: it.id, label: it.label, sort_order: it.sort_order });
      byT.set(it.template_id, arr);
    }
    return (tpls ?? []).map((t: any) => ({ ...t, items: byT.get(t.id) ?? [] }));
  });

export const getTemplateForOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ order_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<QualityTemplate | null> => {
    const sb = context.supabase as any;
    const norm = (s: unknown) => (typeof s === "string" ? s.trim().toUpperCase() : "");

    // 1) Buscar dados mínimos da encomenda (defensivo — qualquer falha é ignorada,
    //    caímos no template-base genérico mais à frente).
    let desc = "";
    let barcode = "";
    let catCode = "";
    try {
      const { data: o } = await sb
        .from("production_orders")
        .select("id, product_description, barcode, models(category_id, ref_categories:category_id(code))")
        .eq("id", data.order_id)
        .maybeSingle();
      desc = norm(o?.product_description);
      barcode = norm(o?.barcode);
      catCode = norm(o?.models?.ref_categories?.code);
    } catch {
      /* ignora — o fallback final trata */
    }

    // 2) Detetar categoria: categoria do modelo → prefixo do código de barras → nome do produto
    let code = catCode;
    if (!code && barcode) code = barcode.slice(0, 3);
    if (!code || (code !== "CAM" && code !== "SOF" && code !== "GEN")) {
      if (/\bCAMA\b/.test(desc)) code = "CAM";
      else if (/\bSOF[AÁ]\b/.test(desc)) code = "SOF";
    }

    // 3) Tentar template específico (só faz sentido para códigos plausíveis)
    let tpl: any = null;
    if (code) {
      const { data: t } = await sb.from("quality_templates")
        .select("id, category_code, name, active, is_default")
        .eq("category_code", code).eq("active", true)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      tpl = t ?? null;
    }

    // 4) Fallback final: template-base (is_default = true) ou, em último recurso,
    //    qualquer template com category_code = 'GEN' ativo.
    if (!tpl) {
      const { data: t } = await sb.from("quality_templates")
        .select("id, category_code, name, active, is_default")
        .eq("is_default", true).eq("active", true)
        .limit(1).maybeSingle();
      tpl = t ?? null;
    }
    if (!tpl) {
      const { data: t } = await sb.from("quality_templates")
        .select("id, category_code, name, active, is_default")
        .eq("category_code", "GEN").eq("active", true)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      tpl = t ?? null;
    }

    if (!tpl) return null;
    const { data: items } = await sb.from("quality_template_items")
      .select("id, label, sort_order").eq("template_id", tpl.id).order("sort_order");
    return { ...tpl, items: items ?? [] };
  });

export const upsertQualityTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid().optional(),
    category_code: z.string().trim().min(1).max(16),
    name: z.string().trim().min(1).max(120),
    active: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    if (data.id) {
      const { error } = await sb.from("quality_templates").update({
        category_code: data.category_code, name: data.name, active: data.active ?? true,
      }).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: ins, error } = await sb.from("quality_templates").insert({
      category_code: data.category_code, name: data.name, active: data.active ?? true,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: ins.id };
  });

export const setTemplateItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    template_id: z.string().uuid(),
    items: z.array(z.object({
      label: z.string().trim().min(1).max(200),
      sort_order: z.number().int().nonnegative(),
    })),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { error: dErr } = await sb.from("quality_template_items").delete().eq("template_id", data.template_id);
    if (dErr) throw new Error(dErr.message);
    if (data.items.length > 0) {
      const rows = data.items.map((i) => ({ ...i, template_id: data.template_id }));
      const { error } = await sb.from("quality_template_items").insert(rows);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

const submitSchema = z.object({
  order_id: z.string().uuid(),
  template_id: z.string().uuid().nullable().optional(),
  operator_code: z.string().trim().min(1).max(32),
  result: z.enum(["aprovado", "reprovado"]),
  notes: z.string().trim().max(2000).nullable().optional(),
  order_stage_id: z.string().uuid().nullable().optional(),
  items: z.array(z.object({
    template_item_id: z.string().uuid().nullable().optional(),
    label: z.string().trim().min(1).max(200),
    status: z.enum(["ok", "nok"]),
    photo_url: z.string().trim().max(500).nullable().optional(),
  })).min(1),
});

export const submitQualityCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => submitSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAnyRole(context, ["admin", "escritorio", "operador"], "registar conferências de qualidade");
    const sb = context.supabase as any;

    // Validar operador
    const { data: op } = await sb.from("operators")
      .select("id, code, name, active").eq("code", data.operator_code).maybeSingle();
    if (!op || !op.active) throw new Error(`Operador "${data.operator_code}" não encontrado ou inativo`);
    const { data: link } = await sb.from("operator_stages")
      .select("stage").eq("operator_id", op.id).eq("stage", "qualidade").maybeSingle();
    if (!link) throw new Error(`O operador ${op.code} não está atribuído à qualidade`);

    const has_nok = data.items.some((i) => i.status === "nok");

    const { data: check, error: cErr } = await sb.from("quality_checks").insert({
      order_id: data.order_id,
      template_id: data.template_id ?? null,
      operator_id: op.id,
      result: data.result,
      has_nok,
      notes: data.notes ?? null,
    }).select("id").single();
    if (cErr) throw new Error(cErr.message);

    const itemRows = data.items.map((i) => ({
      check_id: check.id,
      template_item_id: i.template_item_id ?? null,
      label: i.label,
      status: i.status,
      photo_url: i.photo_url ?? null,
    }));
    const { error: iErr } = await sb.from("quality_check_items").insert(itemRows);
    if (iErr) throw new Error(iErr.message);

    if (data.result === "aprovado" && data.order_stage_id) {
      // Qualidade não regista tempo: iniciar e finalizar imediatamente
      // através de record_stage_event apenas para satisfazer a constraint
      // "Não se pode finalizar uma etapa que não foi iniciada".
      try {
        const { data: stg } = await sb.from("order_stages")
          .select("started_at, status")
          .eq("id", data.order_stage_id).maybeSingle();
        if (stg && !stg.started_at && stg.status !== "concluida") {
          await sb.rpc("record_stage_event", {
            _order_stage_id: data.order_stage_id,
            _operator_code: op.code,
            _event: "iniciar",
          });
        }
      } catch {
        /* não bloquear o submit do formulário */
      }
      const { error: rpcErr } = await sb.rpc("record_stage_event", {
        _order_stage_id: data.order_stage_id,
        _operator_code: op.code,
        _event: "finalizar",
      });
      if (rpcErr) throw new Error(rpcErr.message);
    }

    return { ok: true, check_id: check.id, has_nok };
  });

export type QualityCheckHistoryRow = {
  id: string;
  order_id: string;
  order_number: string;
  product_description: string;
  result: string;
  has_nok: boolean;
  notes: string | null;
  operator_code: string | null;
  operator_name: string | null;
  created_at: string;
  items: { id: string; label: string; status: string; photo_url: string | null }[];
};

export const listQualityChecks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    order_id: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<QualityCheckHistoryRow[]> => {
    const sb = context.supabase as any;
    let q = sb.from("quality_checks")
      .select("id, order_id, result, has_nok, notes, created_at, operators(code, name), production_orders(order_number, product_description), quality_check_items(id, label, status, photo_url)")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 200);
    if (data.order_id) q = q.eq("order_id", data.order_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      id: r.id, order_id: r.order_id,
      order_number: r.production_orders?.order_number ?? "",
      product_description: r.production_orders?.product_description ?? "",
      result: r.result, has_nok: r.has_nok, notes: r.notes,
      operator_code: r.operators?.code ?? null,
      operator_name: r.operators?.name ?? null,
      created_at: r.created_at,
      items: r.quality_check_items ?? [],
    }));
  });

export const getQualityMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const { data: checks } = await sb.from("quality_checks").select("result").limit(5000);
    const { data: items } = await sb.from("quality_check_items").select("label, status").limit(20000);
    const total = checks?.length ?? 0;
    const aprovados = (checks ?? []).filter((c: any) => c.result === "aprovado").length;
    const reprovados = total - aprovados;
    const nokByLabel = new Map<string, number>();
    for (const it of (items ?? []) as any[]) {
      if (it.status === "nok") nokByLabel.set(it.label, (nokByLabel.get(it.label) ?? 0) + 1);
    }
    return {
      total, aprovados, reprovados,
      approval_rate: total > 0 ? Math.round((aprovados / total) * 100) : 0,
      top_nok: Array.from(nokByLabel, ([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count).slice(0, 10),
    };
  });

export const signQualityPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ path: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: signed, error } = await sb.storage.from("quality-photos").createSignedUrl(data.path, 600);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl as string };
  });
