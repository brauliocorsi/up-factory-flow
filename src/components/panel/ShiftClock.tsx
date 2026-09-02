import { currentPhase, elapsedUsefulMinutes, formatMinutes, SHIFT_TOTAL_MINUTES } from "@/lib/shift";
import { Clock, Coffee, Moon, Sun } from "lucide-react";

export function ShiftClock({ now }: { now: Date }) {
  const phase = currentPhase(now);
  const elapsed = elapsedUsefulMinutes(now);
  const remaining = Math.max(0, SHIFT_TOTAL_MINUTES - elapsed);
  const pct = Math.round((elapsed / SHIFT_TOTAL_MINUTES) * 100);

  const info = (() => {
    switch (phase.kind) {
      case "trabalho":
        return { icon: Sun, text: `Em produção · ${phase.block.label}`, sub: `Faltam ${formatMinutes(phase.remaining)} neste bloco`, cls: "text-emerald-500" };
      case "pausa":
        return { icon: Coffee, text: "Pausa", sub: `Retoma em ${formatMinutes(phase.remaining)}`, cls: "text-amber-500" };
      case "antes":
        return { icon: Clock, text: "Antes do turno", sub: "Início às 08:00", cls: "text-muted-foreground" };
      case "fim":
        return { icon: Moon, text: "Turno terminado", sub: "Resumo do dia", cls: "text-muted-foreground" };
      default:
        return { icon: Moon, text: "Sem turno", sub: "Fim de semana", cls: "text-muted-foreground" };
    }
  })();
  const Icon = info.icon;

  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Icon className={`size-7 ${info.cls}`} />
          <div>
            <div className="text-lg font-bold leading-tight">{info.text}</div>
            <div className="text-xs text-muted-foreground">{info.sub}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-4xl font-black tabular-nums leading-none">
            {now.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {formatMinutes(elapsed)} úteis decorridos · faltam {formatMinutes(remaining)}
          </div>
        </div>
      </div>
      <div className="mt-4 h-2.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}
