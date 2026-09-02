import { Pause, Play, UserCircle2 } from "lucide-react";
import type { PanelOperator } from "@/lib/publicPanel.functions";
import { STAGE_LABELS } from "@/lib/format";

function liveSeconds(op: PanelOperator, now: Date): number {
  const base = op.productive_seconds ?? 0;
  if (op.is_paused || !op.last_resume_at) return base;
  const extra = Math.max(0, (now.getTime() - new Date(op.last_resume_at).getTime()) / 1000);
  return base + extra;
}

function fmt(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function LiveOperatorsPanel({ operators, now }: { operators: PanelOperator[]; now: Date }) {
  return (
    <div className="rounded-2xl border bg-card p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm uppercase tracking-widest text-muted-foreground">Quem está a produzir</div>
        <div className="text-2xl font-black tabular-nums">{operators.length}</div>
      </div>
      {operators.length === 0 ? (
        <div className="flex-1 grid place-items-center text-muted-foreground text-sm">
          Ninguém a produzir neste momento.
        </div>
      ) : (
        <div className="space-y-2 overflow-y-auto flex-1 pr-1">
          {operators.map((op) => (
            <div
              key={`${op.operator_name}-${op.order_number}`}
              className={`rounded-xl border p-3 flex items-center gap-3 ${
                op.is_paused ? "border-amber-500/40 bg-amber-500/5" : "border-emerald-500/40 bg-emerald-500/5"
              }`}
            >
              <UserCircle2 className="size-9 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-bold truncate text-lg leading-tight">{op.operator_name}</div>
                <div className="text-sm text-muted-foreground truncate">
                  <span className="font-mono font-semibold text-foreground">{op.order_number}</span>
                  {" · "}
                  {STAGE_LABELS[op.stage] ?? op.stage}
                  {(op.order_count ?? 1) > 1 && (
                    <span className="ml-2 rounded-full bg-primary/15 text-primary px-2 py-0.5 text-[11px] font-semibold">
                      +{(op.order_count ?? 1) - 1} encomenda(s)
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xl font-bold tabular-nums">{fmt(liveSeconds(op, now))}</div>
                <div className={`text-[11px] flex items-center gap-1 justify-end ${op.is_paused ? "text-amber-500" : "text-emerald-500"}`}>
                  {op.is_paused ? <Pause className="size-3" /> : <Play className="size-3" />}
                  {op.is_paused ? "Em pausa" : "A produzir"}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
