import { Check, Scissors, Box, AlertCircle } from "lucide-react";
import type { ConvergenceLines, LineState } from "@/lib/convergence";
export { computeLines } from "@/lib/convergence";
export type { ConvergenceLines, LineState } from "@/lib/convergence";

const SUBSTAGE_LABEL: Record<string, string> = {
  corte: "Corte",
  costura: "Costura",
  estrutura: "Estrutura",
  branco: "Branco",
};

/**
 * Mostra as duas linhas paralelas (Tecido + Estrutura) e o estado de
 * convergência para a estofagem. Não altera lógica — apenas visualiza.
 */
export function ConvergenceStatus({
  lines,
  variant = "compact",
  highlightWhenReady = false,
}: {
  lines: ConvergenceLines;
  variant?: "compact" | "full";
  highlightWhenReady?: boolean;
}) {
  const readyCount = (lines.tecido.ready ? 1 : 0) + (lines.estrutura.ready ? 1 : 0);
  const isReady = readyCount === 2;
  const missing: string[] = [];
  if (!lines.tecido.ready) missing.push("Costura");
  if (!lines.estrutura.ready) missing.push("Branco");

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <LinePill
          icon={<Scissors className="size-3" />}
          label="Tecido"
          state={lines.tecido}
          readyLabel="Costura ✓"
          pendingLabel={lines.tecido.currentSubstage ? `Em ${SUBSTAGE_LABEL[lines.tecido.currentSubstage] ?? lines.tecido.currentSubstage}` : "Costura pendente"}
        />
        <LinePill
          icon={<Box className="size-3" />}
          label="Estrutura"
          state={lines.estrutura}
          readyLabel="Branco ✓"
          pendingLabel={lines.estrutura.currentSubstage ? `Em ${SUBSTAGE_LABEL[lines.estrutura.currentSubstage] ?? lines.estrutura.currentSubstage}` : "Branco pendente"}
        />
      </div>
      <div
        className={`text-[11px] font-medium inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
          isReady
            ? `bg-emerald-600 text-white ${highlightWhenReady ? "ring-2 ring-emerald-300" : ""}`
            : "bg-muted text-muted-foreground"
        }`}
      >
        {isReady ? (
          <>
            <Check className="size-3" />
            {variant === "full" ? "2 de 2 prontas — pronta para estofar" : "2/2 pronta p/ estofar"}
          </>
        ) : (
          <>
            <AlertCircle className="size-3" />
            {readyCount} de 2 prontas {missing.length ? `— falta ${missing.join(" + ")}` : ""}
          </>
        )}
      </div>
    </div>
  );
}

function LinePill({
  icon, label, state, readyLabel, pendingLabel,
}: {
  icon: React.ReactNode;
  label: string;
  state: LineState;
  readyLabel: string;
  pendingLabel: string;
}) {
  return (
    <div
      className={`flex-1 min-w-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium border ${
        state.ready
          ? "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
          : "bg-muted text-muted-foreground border-border"
      }`}
      title={`${label}: ${state.ready ? readyLabel : pendingLabel}`}
    >
      <span className="opacity-70">{icon}</span>
      <span className="truncate">{state.ready ? readyLabel : pendingLabel}</span>
      {state.ready && state.fromStock && (
        <span className="ml-auto text-[8px] uppercase tracking-wide bg-emerald-600 text-white rounded px-1">stock</span>
      )}
    </div>
  );
}
