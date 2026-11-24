/**
 * Fita de laminado das camas (separada da variante N/F).
 * Não existe L00: sem laminado não há sufixo.
 */
export type LaminateCode = "L01" | "L02" | "L03" | "L04" | "L05" | "L06";

export const LAMINATES: Array<{ code: LaminateCode; color: string; label: string }> = [
  { code: "L01", color: "Dourado", label: "Laminado Dourado" },
  { code: "L02", color: "Prata", label: "Laminado Prata" },
  { code: "L03", color: "Rose", label: "Laminado Rose" },
  { code: "L04", color: "Bronze", label: "Laminado Bronze" },
  { code: "L05", color: "Espelho", label: "Laminado Espelho" },
  { code: "L06", color: "Inox", label: "Laminado Inox" },
];

/** Cor por omissão nos modelos de laminado de série. */
export const DEFAULT_LAMINATE: LaminateCode = "L02";

/** Números de modelo CAM retirados a 05/11/2026: nunca usar em códigos novos. */
export const RETIRED_BED_MODELS = ["111", "117", "118", "122", "125", "129", "132", "135"] as const;

export function isRetiredBedModel(code?: string | null): boolean {
  return (RETIRED_BED_MODELS as readonly string[]).includes(String(code ?? "").trim());
}

export function isLaminateCode(v: unknown): v is LaminateCode {
  return typeof v === "string" && /^L0[1-6]$/.test(v);
}

export function laminateLabel(code?: string | null): string | null {
  return LAMINATES.find((l) => l.code === code)?.label ?? null;
}

function norm(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Extrai a cor do laminado de um nome livre. Só devolve uma cor quando o texto
 * fala de laminado, fita ou faixa (evita confundir «espelhos» decorativos).
 */
export function detectLaminate(text: string): LaminateCode | null {
  const t = norm(text);
  const ctx = /(laminad|fita|faixa)/.test(t);
  if (!ctx) return null;
  if (/ouro\s*rose|\brose\b/.test(t)) return "L03";
  if (/\bprat(a|eado|eada)\b/.test(t)) return "L02";
  if (/\bdourad[oa]\b/.test(t)) return "L01";
  if (/\bbronze\b/.test(t)) return "L04";
  if (/laminad[oa]\s+espelho/.test(t)) return "L05";
  if (/\binox\b/.test(t)) return "L06";
  return null;
}

/** True se o texto menciona laminado (com ou sem cor). */
export function mentionsLaminate(text: string): boolean {
  return /laminad/.test(norm(text));
}

export type CodeKind = "CAM" | "PERCAM" | "SOF" | "SOM" | "EAN13" | "OUTRO";

export function classifyProductCode(code?: string | null): CodeKind | null {
  const c = String(code ?? "").replace(/\s+/g, "").toUpperCase();
  if (!c) return null;
  if (/^CAM\d{3}0[1-3]\d{3}\d{6}[NF](L0[1-6])?$/.test(c)) return "CAM";
  if (/^PERCAM\d{3}0[1-3]\d{3}\d{6}[NF](L0[1-6])?$/.test(c)) return "PERCAM";
  if (/^SOF[A-Z0-9]{15}$/.test(c)) return "SOF";
  if (/^SOM[A-Z0-9]{14}$/.test(c)) return "SOM";
  if (/^\d{13}$/.test(c)) return "EAN13";
  return "OUTRO";
}

/** Segmenta o código para a etiqueta. Não CAM/SOF/SOM: devolve em bloco. */
export function formatProductCode(code?: string | null): string {
  const c = String(code ?? "").replace(/\s+/g, "").toUpperCase();
  const kind = classifyProductCode(c);
  if (kind === "CAM" || kind === "PERCAM") {
    const p = kind === "PERCAM" ? 6 : 3;
    const parts = [c.slice(0, p), c.slice(p, p + 3), c.slice(p + 3, p + 5), c.slice(p + 5, p + 8), c.slice(p + 8, p + 14), c.slice(p + 14, p + 15)];
    if (c.length > p + 15) parts.push(c.slice(p + 15));
    return parts.join(" ");
  }
  if (kind === "SOF") return [c.slice(0, 3), c.slice(3, 6), c.slice(6, 8), c.slice(8, 11), c.slice(11, 17), c.slice(17)].join(" ");
  if (kind === "SOM") return [c.slice(0, 3), c.slice(3, 6), c.slice(6, 7), c.slice(7, 8), c.slice(8, 11), c.slice(11)].join(" ");
  return c;
}

/** Código que precisa de ser normalizado (EAN-13 ou formato desconhecido). */
export function needsNormalization(code?: string | null): boolean {
  const k = classifyProductCode(code);
  return k === "EAN13" || k === "OUTRO";
}
