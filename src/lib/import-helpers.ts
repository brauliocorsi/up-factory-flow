export const SYSTEM_FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: "order_number", label: "Nº Encomenda", required: true },
  { key: "product_description", label: "Descrição do produto" },
  { key: "model_name", label: "Modelo (nome)" },
  { key: "measure", label: "Medida" },
  { key: "fabric_type", label: "Tipo de tecido" },
  { key: "fabric_ref", label: "Ref. tecido" },
  { key: "color", label: "Cor" },
  { key: "structure_type", label: "Tipo de estrutura" },
  { key: "entry_date", label: "Data de entrada" },
  { key: "due_date", label: "Data saída prevista" },
  { key: "priority", label: "Prioridade" },
  { key: "notes", label: "Notas" },
  // Códigos opcionais necessários para escrever overrides de SLA por produto
  { key: "category_code", label: "Categoria (código) — SLA" },
  { key: "model_code", label: "Modelo (código) — SLA" },
  { key: "structure_code", label: "Estrutura (código) — SLA" },
  { key: "measure_code", label: "Medida (código) — SLA" },
  // Tempo previsto por etapa, em minutos
  { key: "sla_estrutura", label: "SLA Estrutura (min)" },
  { key: "sla_corte", label: "SLA Corte (min)" },
  { key: "sla_costura", label: "SLA Costura (min)" },
  { key: "sla_branco", label: "SLA Branco (min)" },
  { key: "sla_estofagem", label: "SLA Estofagem (min)" },
  { key: "sla_qualidade", label: "SLA Qualidade (min)" },
  { key: "sla_embalagem", label: "SLA Embalagem (min)" },
  { key: "sla_picagem", label: "SLA Picagem (min)" },
];

const GUESS: Record<string, RegExp[]> = {
  order_number: [/^n[ºo°]?$/i, /encomenda/i, /pedido/i, /^nr/i, /numero/i],
  product_description: [/descri/i, /produto/i, /artigo/i],
  model_name: [/modelo/i, /model$/i],
  measure: [/medida/i, /dimens/i, /tamanho/i],
  fabric_type: [/tipo.*tec/i, /^tecido/i],
  fabric_ref: [/ref.*tec/i, /referen/i, /^ref/i],
  color: [/^cor/i, /color/i],
  structure_type: [/estrutura/i],
  entry_date: [/entrada/i, /in[ií]cio/i, /data.*ent/i],
  due_date: [/sa[ií]da/i, /entrega/i, /prazo/i, /due/i],
  priority: [/prioridade/i, /priority/i, /urg/i],
  notes: [/notas?/i, /obs/i, /coment/i],
  category_code: [/categoria.*c[oó]d|cat.*code/i],
  model_code: [/modelo.*c[oó]d|model.*code/i],
  structure_code: [/estrutura.*c[oó]d/i],
  measure_code: [/medida.*c[oó]d/i],
  sla_estrutura: [/sla.*estrut|tempo.*estrut|estrut.*\bmin\b/i],
  sla_corte: [/sla.*corte|tempo.*corte|corte.*\bmin\b/i],
  sla_costura: [/sla.*costura|tempo.*costura|costura.*\bmin\b/i],
  sla_branco: [/sla.*branco|tempo.*branco|branco.*\bmin\b/i],
  sla_estofagem: [/sla.*estof|tempo.*estof|estof.*\bmin\b/i],
  sla_qualidade: [/sla.*qual|tempo.*qual|qual.*\bmin\b/i],
  sla_embalagem: [/sla.*embal|tempo.*embal|embal.*\bmin\b/i],
  sla_picagem: [/sla.*pica|tempo.*pica|pica.*\bmin\b/i],
};

export function autoGuessMapping(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of SYSTEM_FIELDS) {
    const patterns = GUESS[f.key] ?? [];
    const found = headers.find((h) => patterns.some((re) => re.test(String(h ?? "").trim())));
    if (found) out[f.key] = found;
  }
  return out;
}

export function parseExcelDate(v: any): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    // Excel serial date
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yy] = m;
    if (yy.length === 2) yy = "20" + yy;
    const iso = `${yy.padStart(4, "0")}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    return isNaN(new Date(iso).getTime()) ? null : iso;
  }
  const m2 = s.match(/^\d{4}-\d{2}-\d{2}/);
  if (m2) return m2[0];
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export type MappedRow = {
  order_number: string;
  product_description: string;
  model_id: string | null;
  model_name_raw: string | null;
  measure: string | null;
  fabric_type: string | null;
  fabric_ref: string | null;
  color: string | null;
  structure_type: string | null;
  entry_date: string | null;
  due_date: string | null;
  priority: number;
  notes: string | null;
  errors: string[];
  category_code: string | null;
  model_code: string | null;
  structure_code: string | null;
  measure_code: string | null;
  sla: Partial<Record<
    "estrutura"|"corte"|"costura"|"branco"|"estofagem"|"qualidade"|"embalagem"|"picagem",
    number
  >>;
};

export function applyMapping(
  rows: Record<string, any>[],
  mapping: Record<string, string>,
  models: { id: string; name: string }[],
): MappedRow[] {
  const modelByName = new Map(models.map((m) => [m.name.trim().toLowerCase(), m.id]));
  return rows.map((r) => {
    const get = (k: string) => {
      const col = mapping[k];
      if (!col) return null;
      const v = r[col];
      return v == null || v === "" ? null : v;
    };
    const errs: string[] = [];
    const order_number = String(get("order_number") ?? "").trim();
    if (!order_number) errs.push("Nº encomenda em falta");
    const product_description = String(get("product_description") ?? "").trim() || order_number;

    const modelRaw = get("model_name");
    let model_id: string | null = null;
    if (modelRaw) {
      const id = modelByName.get(String(modelRaw).trim().toLowerCase());
      if (id) model_id = id;
      else errs.push(`Modelo "${modelRaw}" não reconhecido`);
    }
    const entry_date = parseExcelDate(get("entry_date"));
    const due_date = parseExcelDate(get("due_date"));
    if (get("entry_date") && !entry_date) errs.push("Data de entrada inválida");
    if (get("due_date") && !due_date) errs.push("Data de saída inválida");

    const priorityRaw = get("priority");
    const priority = priorityRaw == null ? 0 : Math.max(0, Math.min(10, Number(priorityRaw) || 0));

    const slaStages = ["estrutura","corte","costura","branco","estofagem","qualidade","embalagem","picagem"] as const;
    const sla: MappedRow["sla"] = {};
    for (const s of slaStages) {
      const raw = get(`sla_${s}`);
      if (raw != null) {
        const n = Number(String(raw).replace(",", "."));
        if (Number.isFinite(n) && n > 0) sla[s] = Math.round(n);
      }
    }

    const trimStr = (v: any) => (v == null ? null : String(v).trim() || null);

    return {
      order_number,
      product_description,
      model_id,
      model_name_raw: modelRaw ? String(modelRaw) : null,
      measure: get("measure") ? String(get("measure")) : null,
      fabric_type: get("fabric_type") ? String(get("fabric_type")) : null,
      fabric_ref: get("fabric_ref") ? String(get("fabric_ref")) : null,
      color: get("color") ? String(get("color")) : null,
      structure_type: get("structure_type") ? String(get("structure_type")) : null,
      entry_date,
      due_date,
      priority,
      notes: get("notes") ? String(get("notes")) : null,
      errors: errs,
      category_code: trimStr(get("category_code")),
      model_code: trimStr(get("model_code")),
      structure_code: trimStr(get("structure_code")),
      measure_code: trimStr(get("measure_code")),
      sla,
    };
  });
}