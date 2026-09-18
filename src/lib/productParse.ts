/**
 * Reconhecimento de produto a partir de texto livre (folhas de Excel).
 * Módulo puro: recebe o catálogo e devolve o que conseguiu identificar,
 * marcando cada linha como reconhecida, em dúvida ou não reconhecida.
 */

import {
  buildBedCode,
  buildSofaCode,
  buildSommierCode,
  bedProductName,
  sofaProductName,
  sommierProductName,
  fabricLabel,
  type BedVariant,
  type SofaVariant,
} from "./productCodes";

export type ParseCatalog = {
  models: Array<{
    id: string;
    code: string;
    name: string;
    category_code: string; // CAM | SOF | SOM …
    structure_code?: string | null;
    sofa_family_code?: string | null;
  }>;
  structures: Array<{ code: string; name: string }>;
  sofa_families: Array<{ code: string; name: string }>;
  measures: Array<{ code: string; name: string }>;
  collections: Array<{ code: string; name: string; fabric_type_code?: string | null }>;
  fabrics: Array<{
    ref_tec: string;
    fabric_ref_code: string;
    fabric_type_code: string;
    supplier_ref: string;
    color_code?: string | null;
  }>;
  colors: Array<{ code: string; name: string }>;
};

export type RowStatus = "reconhecida" | "duvida" | "nao_reconhecida";

export type ParsedRow = {
  raw: string;
  category_code: string | null;
  model_id: string | null;
  model_code: string | null;
  model_name: string | null;
  structure_code: string | null;
  structure_name: string | null;
  sofa_family_code: string | null;
  sofa_family_name: string | null;
  measure_code: string | null;
  measure_label: string | null;
  /** Medida atípica que ainda não existe no catálogo (gama 5xx a criar). */
  measure_new: string | null;
  width_cm: number | null;
  ref_tec: string | null;
  fabric_label: string | null;
  collection_code: string | null;
  variant: BedVariant | SofaVariant | null;
  elevatorio: boolean;
  fundos: boolean;
  customizations: string[];
  product_code: string | null;
  product_name: string | null;
  status: RowStatus;
  issues: string[];
};

export function normalize(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[×]/g, "x")
    .replace(/\s+/g, " ")
    .trim();
}

/** Medidas conhecidas: dimensões reais → código da tabela. */
export const KNOWN_MEASURES: Record<string, string> = {
  "190x140": "140",
  "195x150": "150",
  "200x160": "160",
  "200x180": "180",
  "190x90": "090",
  "200x90": "091",
};

const EXCLUDE_BEFORE = /(cab\.?|cabeceira|ilhargueiro|ilharga|peseira)\s*(de\s*)?$/i;

/** Corrige gralhas de dígito a mais: 900 → 90, 2000 → 200, 1200 → 120. */
function fixDimension(n: number): number {
  let v = n;
  while (v > 260 && v % 10 === 0) v = v / 10;
  return Math.round(v);
}

type FoundMeasure = { a: number; b: number; excluded: boolean; index: number };

function findMeasures(text: string): FoundMeasure[] {
  const out: FoundMeasure[] = [];
  const re = /(\d{2,4})(?:[.,]\d+)?\s*x\s*(\d{2,4})(?:[.,]\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 22), m.index);
    out.push({
      a: fixDimension(Number(m[1])),
      b: fixDimension(Number(m[2])),
      excluded: EXCLUDE_BEFORE.test(before.trim()),
      index: m.index,
    });
  }
  return out;
}

function measureKeys(a: number, b: number): string[] {
  return [`${a}x${b}`, `${b}x${a}`];
}

/** Encontra o modelo em qualquer posição da frase; o mais longo ganha. */
function findModels(text: string, catalog: ParseCatalog, categoryCode: string | null) {
  const t = ` ${text} `;
  const pool = catalog.models.filter(
    (m) => !categoryCode || m.category_code === categoryCode,
  );
  const hits = pool.filter((m) => {
    const n = normalize(m.name);
    if (n.length < 3) return false;
    return new RegExp(`(^|[^a-z0-9])${escapeRe(n)}([^a-z0-9]|$)`).test(t);
  });
  hits.sort((x, y) => normalize(y.name).length - normalize(x.name).length);
  return hits;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectCategory(text: string): string | null {
  if (/\bsommier|somier\b/.test(text)) return "SOM";
  if (/\bsofa[- ]?cama\b/.test(text)) return "SOF";
  if (/\bsofa\b/.test(text)) return "SOF";
  if (/\bcama|cabeceira\b/.test(text)) return "CAM";
  return null;
}

function detectCustomizations(text: string): string[] {
  const out: string[] = [];
  const cab = /(?:cab\.?|cabeceira)\s*(?:de\s*)?(\d{2,4})\s*(?:x\s*\d{2,4})?\s*cm?/.exec(text);
  if (cab) out.push(`cab:${fixDimension(Number(cab[1]))}`);
  if (/ilharg/.test(text)) out.push("ilhargueiro");
  if (/furo|tomada/.test(text)) out.push("furos tomadas");
  if (/laminad/.test(text)) out.push("laminado");
  if (/espelh/.test(text)) out.push("espelhos");
  if (/listra|listras/.test(text)) out.push("listras");
  if (/peseira/.test(text)) out.push("peseira");
  return out;
}

function detectBedVariant(text: string): BedVariant {
  return /flutuante|mural/.test(text) ? "F" : "N";
}

function detectSofaVariant(text: string): SofaVariant {
  if (!/chaise|chase|chaiselong/.test(text)) return "N";
  const hasSide = /(odf|vdf)/.test(text) || /\b(esq|esquerda|drt|dir|direita)\b/.test(text);
  if (!hasSide) return "R";
  if (/\b(drt|dir|direita)\b/.test(text)) return "D";
  if (/\b(esq|esquerda)\b/.test(text)) return "E";
  return "R";
}

/** Procura a coleção no texto e o que vem a seguir (nº do fornecedor e/ou cor). */
function findFabric(text: string, catalog: ParseCatalog) {
  const t = ` ${text} `;
  let best: { code: string; name: string; index: number } | null = null;
  for (const c of catalog.collections) {
    const n = normalize(c.name);
    if (n.length < 3) continue;
    const m = new RegExp(`(^|[^a-z0-9])${escapeRe(n)}([^a-z0-9]|$)`).exec(t);
    if (!m) continue;
    const index = m.index + m[1].length;
    if (!best || n.length > normalize(best.name).length) {
      best = { code: c.code, name: c.name, index };
    }
  }
  if (!best) return { collection: null, fabric: null, tail: "" };
  const tail = t.slice(best.index + normalize(best.name).length).trim().replace(/^[-–,]\s*/, "");
  const candidates = catalog.fabrics.filter((f) => f.fabric_ref_code === best!.code);
  const tailNorm = normalize(tail);
  let fabric =
    candidates.find((f) => tailNorm && normalize(f.supplier_ref).includes(tailNorm)) ?? null;
  if (!fabric && tailNorm) {
    const tokens = tailNorm.split(" ").filter(Boolean).slice(0, 3);
    fabric =
      candidates.find((f) => {
        const sup = normalize(f.supplier_ref);
        return tokens.length > 0 && tokens.every((tk) => sup.includes(tk));
      }) ?? null;
  }
  return { collection: best, fabric, tail };
}

export function parseProductRow(raw: string, catalog: ParseCatalog): ParsedRow {
  const text = normalize(raw);
  const issues: string[] = [];
  const row: ParsedRow = {
    raw,
    category_code: null,
    model_id: null,
    model_code: null,
    model_name: null,
    structure_code: null,
    structure_name: null,
    sofa_family_code: null,
    sofa_family_name: null,
    measure_code: null,
    measure_label: null,
    measure_new: null,
    width_cm: null,
    ref_tec: null,
    fabric_label: null,
    collection_code: null,
    variant: null,
    elevatorio: /elevatorio/.test(text),
    fundos: /fundo/.test(text),
    customizations: detectCustomizations(text),
    product_code: null,
    product_name: null,
    status: "nao_reconhecida",
    issues,
  };

  row.category_code = detectCategory(text);

  // --- modelo (em qualquer posição da frase) ---
  let candidates = findModels(text, catalog, row.category_code);
  if (candidates.length === 0 && row.category_code) {
    candidates = findModels(text, catalog, null);
    if (candidates.length > 0) {
      issues.push("Modelo encontrado noutra categoria — confirmar.");
    }
  }
  if (candidates.length === 0) {
    issues.push("Modelo não reconhecido.");
  } else {
    const chosen = candidates[0];
    row.model_id = chosen.id;
    row.model_code = chosen.code;
    row.model_name = chosen.name;
    if (!row.category_code) row.category_code = chosen.category_code;
    const sameLength =
      candidates.filter((c) => normalize(c.name).length === normalize(chosen.name).length).length > 1;
    if (sameLength) issues.push("Mais do que um modelo possível — confirmar.");
    // estrutura/família vêm sempre do modelo, nunca do texto
    row.structure_code = chosen.structure_code ?? null;
    row.sofa_family_code = chosen.sofa_family_code ?? null;
    row.structure_name =
      catalog.structures.find((s) => s.code === row.structure_code)?.name ?? null;
    row.sofa_family_name =
      catalog.sofa_families.find((f) => f.code === row.sofa_family_code)?.name ?? null;
  }

  // --- medida / largura ---
  const measures = findMeasures(text).filter((m) => !m.excluded);
  if (row.category_code === "SOF") {
    const width = measures[0]?.a ?? null;
    const single = /(?:^|[^0-9])(\d{3})\s*cm/.exec(text);
    row.width_cm = width ?? (single ? fixDimension(Number(single[1])) : null);
    if (!row.width_cm) issues.push("Largura do sofá não reconhecida.");
    row.variant = detectSofaVariant(text);
  } else {
    const first = measures[0];
    if (!first) {
      issues.push("Medida não reconhecida.");
    } else {
      const keys = measureKeys(first.a, first.b);
      const known = keys.map((k) => KNOWN_MEASURES[k]).find(Boolean) ?? null;
      const inTable =
        catalog.measures.find((m) => keys.includes(normalize(m.name).replace(/\s|cm/g, ""))) ?? null;
      if (known) {
        row.measure_code = known;
        row.measure_label = keys[0];
      } else if (inTable) {
        row.measure_code = inTable.code;
        row.measure_label = inTable.name;
      } else {
        row.measure_new = keys[0];
        row.measure_label = keys[0];
        issues.push(`Medida atípica ${keys[0]} — será criada na gama 5xx (sob-medida).`);
      }
    }
    row.variant = detectBedVariant(text);
  }

  // --- tecido ---
  const { collection, fabric, tail } = findFabric(text, catalog);
  if (collection) row.collection_code = collection.code;
  if (fabric) {
    row.ref_tec = fabric.ref_tec;
    row.fabric_label = fabricLabel({
      supplierRef: fabric.supplier_ref,
      collectionName: collection?.name ?? null,
      colorName: catalog.colors.find((c) => c.code === fabric.color_code)?.name ?? null,
    });
  } else if (collection) {
    row.fabric_label = [collection.name, tail].filter(Boolean).join(" ").trim();
    issues.push(`Tecido "${row.fabric_label}" sem referência TEC registada.`);
  } else {
    issues.push("Tecido não reconhecido.");
  }

  // --- código e nome gerados ---
  if (row.category_code === "SOF") {
    row.product_code = buildSofaCode({
      modelCode: row.model_code,
      familyCode: row.sofa_family_code,
      widthCm: row.width_cm,
      refTec: row.ref_tec,
      variant: (row.variant as SofaVariant) ?? "N",
    });
    row.product_name = sofaProductName({
      modelName: row.model_name,
      familyCode: row.sofa_family_code,
      familyName: row.sofa_family_name,
      variant: (row.variant as SofaVariant) ?? "N",
      widthCm: row.width_cm,
      fabricLabel: row.fabric_label,
    });
  } else if (row.category_code === "SOM") {
    row.product_code = buildSommierCode({
      modelCode: row.model_code,
      elevatorio: row.elevatorio,
      fundos: row.fundos,
      measureCode: row.measure_code,
      refTec: row.ref_tec,
    });
    row.product_name = sommierProductName({
      modelName: row.model_name,
      elevatorio: row.elevatorio,
      fundos: row.fundos,
      measureName: row.measure_label,
      fabricLabel: row.fabric_label,
    });
  } else {
    row.product_code = buildBedCode({
      modelCode: row.model_code,
      structureCode: row.structure_code,
      measureCode: row.measure_code,
      refTec: row.ref_tec,
      variant: (row.variant as BedVariant) ?? "N",
    });
    row.product_name = bedProductName({
      modelName: row.model_name,
      structureName: row.structure_name,
      variant: (row.variant as BedVariant) ?? "N",
      measureName: row.measure_label,
      fabricLabel: row.fabric_label,
    });
  }
  if (!row.product_code) row.product_code = null;

  // --- estado da linha ---
  if (!row.model_id) row.status = "nao_reconhecida";
  else if (issues.length > 0 || !row.product_code) row.status = "duvida";
  else row.status = "reconhecida";

  return row;
}

export function parseProductRows(rows: string[], catalog: ParseCatalog): ParsedRow[] {
  return rows.map((r) => parseProductRow(r, catalog));
}
