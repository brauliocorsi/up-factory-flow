import type { Stage } from "@/lib/production.functions";

/**
 * Regras de dependência entre etapas (espelham public.stage_prerequisites na base).
 * - Estrutura e Corte arrancam livremente.
 * - Estrutura liberta Branco; Corte liberta Costura.
 * - Estofagem exige Corte, Costura e Branco (e portanto Estrutura).
 * - Estofagem → Qualidade → Embalagem → Picagem.
 */
export const STAGE_PREREQS: Record<Stage, Stage[]> = {
  estrutura: [],
  corte: [],
  branco: ["estrutura"],
  costura: ["corte"],
  estofagem: ["estrutura", "corte", "costura", "branco"],
  qualidade: ["estofagem"],
  embalagem: ["qualidade"],
  picagem: ["embalagem"],
};

/** Etapas anteriores que ainda não estão concluídas (as que existem na rota). */
export function pendingPrereqs(
  stage: Stage,
  states: Array<{ stage: Stage; status: string }> | undefined | null,
): Stage[] {
  if (!states || states.length === 0) return [];
  const required = STAGE_PREREQS[stage] ?? [];
  return required.filter((s) =>
    states.some((st) => st.stage === s && st.status !== "concluida"),
  );
}
