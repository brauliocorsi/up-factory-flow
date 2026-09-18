/**
 * Geração e validação dos códigos e nomes de produto.
 * Nenhum utilizador escreve código à mão: tudo passa por aqui.
 *
 * CAMA:     CAM + Modelo(3) + Estrutura(2) + Medida(3) + Tecido(6) + Variante(1)
 * SOFÁ:     SOF + Modelo(3) + Família(2)   + Largura(3) + Tecido(6) + Variante(1)
 * SOMMIER:  SOM + Modelo(3) + Elevatório(1) + Fundos(1) + Medida(3) + Tecido(6)
 */

export type BedVariant = "N" | "F";
/** Lado da chaise, sempre Olhando De Frente (ODF). */
export type SofaVariant = "N" | "E" | "D" | "R";

export const ODF_LABEL = "ODF (Olhando De Frente)";

export const SOFA_VARIANTS: Array<{
  value: SofaVariant;
  label: string;
  short: string;
  help: string;
}> = [
  { value: "N", label: "Sem chaise", short: "—", help: "Sofá sem chaise." },
  { value: "E", label: "Chaise à esquerda", short: "Esq", help: `Chaise do lado esquerdo, ${ODF_LABEL}.` },
  { value: "D", label: "Chaise à direita", short: "Drt", help: `Chaise do lado direito, ${ODF_LABEL}.` },
  { value: "R", label: "Chaise reversível", short: "Rev", help: "Chaise montável dos dois lados." },
];

export const BED_VARIANTS: Array<{ value: BedVariant; label: string }> = [
  { value: "N", label: "N — Normal" },
  { value: "F", label: "F — Flutuante" },
];

/** Os 6 dígitos do tecido: TEC020305 → 020305. */
export function fabricBlock(refTec?: string | null): string {
  const t = (refTec ?? "").trim().toUpperCase();
  return /^TEC\d{6}$/.test(t) ? t.slice(3) : "";
}

function pad(v: string | number | null | undefined, len: number): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return s.length >= len ? s.slice(-len) : s.padStart(len, "0");
}

export type BedCodeInput = {
  modelCode?: string | null;
  structureCode?: string | null;
  measureCode?: string | null;
  refTec?: string | null;
  variant?: BedVariant | null;
};

export function buildBedCode(i: BedCodeInput): string {
  const parts = [
    "CAM",
    pad(i.modelCode, 3),
    pad(i.structureCode, 2),
    pad(i.measureCode, 3),
    fabricBlock(i.refTec),
    i.variant ?? "",
  ];
  return parts.every(Boolean) ? parts.join("") : "";
}

export type SofaCodeInput = {
  modelCode?: string | null;
  familyCode?: string | null;
  /** Largura real em cm (não é código de tabela). */
  widthCm?: number | string | null;
  refTec?: string | null;
  variant?: SofaVariant | null;
};

export function buildSofaCode(i: SofaCodeInput): string {
  const width = Number(i.widthCm);
  const parts = [
    "SOF",
    pad(i.modelCode, 3),
    pad(i.familyCode, 2),
    Number.isFinite(width) && width > 0 ? pad(Math.round(width), 3) : "",
    fabricBlock(i.refTec),
    i.variant ?? "",
  ];
  return parts.every(Boolean) ? parts.join("") : "";
}

export type SommierCodeInput = {
  modelCode?: string | null;
  /** Elevatório: 1 = sim, 0 = não. */
  elevatorio?: boolean | null;
  /** Fundos: 1 = com fundos, 0 = sem. */
  fundos?: boolean | null;
  measureCode?: string | null;
  refTec?: string | null;
};

export function buildSommierCode(i: SommierCodeInput): string {
  const parts = [
    "SOM",
    pad(i.modelCode, 3),
    i.elevatorio ? "1" : "0",
    i.fundos ? "1" : "0",
    pad(i.measureCode, 3),
    fabricBlock(i.refTec),
  ];
  return parts.every(Boolean) ? parts.join("") : "";
}

/** Medidas na gama 5xx são atípicas (sob-medida de cliente). */
export function isCustomMeasure(measureCode?: string | null): boolean {
  return /^5\d{2}$/.test((measureCode ?? "").trim());
}

// ---------------------------------------------------------------------------
// Nomes de produto (gerados, nunca escritos)
// ---------------------------------------------------------------------------

function clean(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function fabricSuffix(fabricLabel?: string | null): string {
  const l = (fabricLabel ?? "").trim();
  return l ? ` - ${l}` : "";
}

export function bedProductName(i: {
  modelName?: string | null;
  structureName?: string | null;
  variant?: BedVariant | null;
  measureName?: string | null;
  fabricLabel?: string | null;
}): string {
  const measure = (i.measureName ?? "").trim();
  const head = clean([
    "Cama",
    i.modelName,
    i.structureName,
    i.variant === "F" ? "Flutuante" : null,
    measure ? `${measure.replace(/\s*cm$/i, "")}cm` : null,
  ]);
  return head + fabricSuffix(i.fabricLabel);
}

export function sofaProductName(i: {
  modelName?: string | null;
  familyCode?: string | null;
  familyName?: string | null;
  variant?: SofaVariant | null;
  widthCm?: number | string | null;
  fabricLabel?: string | null;
}): string {
  const isSofaBed = i.familyCode === "03" || /sof[áa]-?cama/i.test(i.familyName ?? "");
  const chaise = SOFA_VARIANTS.find((v) => v.value === i.variant);
  const chaisePart = i.variant && i.variant !== "N" ? `Chaise ${chaise?.short ?? ""}`.trim() : null;
  const width = Number(i.widthCm);
  const head = clean([
    isSofaBed ? "Sofá-Cama" : "Sofá",
    i.modelName,
    isSofaBed ? null : i.familyName,
    chaisePart,
    Number.isFinite(width) && width > 0 ? `${Math.round(width)}cm` : null,
  ]);
  return head + fabricSuffix(i.fabricLabel);
}

export function sommierProductName(i: {
  modelName?: string | null;
  elevatorio?: boolean | null;
  fundos?: boolean | null;
  measureName?: string | null;
  fabricLabel?: string | null;
}): string {
  const measure = (i.measureName ?? "").trim();
  const head = clean([
    "Sommier",
    i.modelName,
    i.elevatorio ? "Elevatório" : null,
    i.fundos ? "c/ Fundos" : null,
    measure ? `${measure.replace(/\s*cm$/i, "")}cm` : null,
  ]);
  return head + fabricSuffix(i.fabricLabel);
}

/** Rótulo do tecido para os nomes: referência do fornecedor + cor. */
export function fabricLabel(i: {
  supplierRef?: string | null;
  collectionName?: string | null;
  colorName?: string | null;
}): string {
  const supplier = (i.supplierRef ?? "").trim();
  if (supplier) return supplier;
  return clean([i.collectionName, i.colorName]);
}
