export type LineState = {
  ready: boolean;
  fromStock?: boolean;
  currentSubstage?: string | null;
};

export type ConvergenceLines = {
  tecido: LineState;
  estrutura: LineState;
};

/**
 * Calcula o estado das duas linhas paralelas (Tecido + Estrutura) a partir
 * das etapas de uma encomenda. Reutiliza order_stages (status + notes);
 * não cria dados novos nem altera a lógica de bloqueio existente.
 */
export function computeLines(
  stages: Array<{ stage: string; status: string; notes?: string | null }>
): ConvergenceLines {
  const find = (name: string) => stages.find((s) => s.stage === name);
  const isStock = (s: { notes?: string | null } | undefined) =>
    !!s && typeof s.notes === "string" && s.notes.startsWith("Concluída de stock");

  const costura = find("costura");
  const corte = find("corte");
  const branco = find("branco");
  const estrutura = find("estrutura");

  const tecidoReady = costura?.status === "concluida";
  const estruturaReady = branco?.status === "concluida";

  let tecidoCurrent: string | null = null;
  if (!tecidoReady) {
    if (corte && corte.status !== "concluida") tecidoCurrent = "corte";
    else if (costura && costura.status !== "concluida") tecidoCurrent = "costura";
  }
  let estruturaCurrent: string | null = null;
  if (!estruturaReady) {
    if (estrutura && estrutura.status !== "concluida") estruturaCurrent = "estrutura";
    else if (branco && branco.status !== "concluida") estruturaCurrent = "branco";
  }

  return {
    tecido: { ready: tecidoReady, fromStock: tecidoReady && isStock(costura), currentSubstage: tecidoCurrent },
    estrutura: { ready: estruturaReady, fromStock: estruturaReady && isStock(branco), currentSubstage: estruturaCurrent },
  };
}