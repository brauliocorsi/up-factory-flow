import { Pause, Play, UserCircle2 } from "lucide-react";
import type { PanelOperator } from "@/lib/publicPanel.functions";
import { STAGE_LABELS } from "@/lib/format";

type Order = NonNullable<PanelOperator["orders"]>[number];

function liveSeconds(o: { productive_seconds: number; is_paused: boolean; last_resume_at: string | null }, now: Date): number {
  const base = o.productive_seconds ?? 0;
  if (o.is_paused || !o.last_resume_at) return base;
  const extra = Math.max(0, (now.getTime() - new Date(o.last_resume_at).getTime()) / 1000);
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
          {operators.map((op) => {
            const orders: Order[] = op.orders?.length
              ? op.orders
              : [{ id: op.order_number, order_number: op.order_number, stage: op.stage, coli_number: null, coli_total: null, is_paused: op.is_paused, pause_reason: null, last_resume_at: op.last_resume_at, productive_seconds: op.productive_seconds }];
            return (
              <div
                key={op.operator_name}
                className={`rounded-xl border p-3 ${
                  op.is_paused ? "border-amber-500/40 bg-amber-500/5" : "border-emerald-500/40 bg-emerald-500/5"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <UserCircle2 className="size-7 text-muted-foreground shrink-0" />
                  <div className="font-bold truncate text-lg leading-tight flex-1">{op.operator_name}</div>
                  <span className="rounded-full bg-primary/15 text-primary px-2 py-0.5 text-xs font-semibold">
                    {orders.length} {orders.length === 1 ? "encomenda" : "encomendas"}
                  </span>
                </div>
                <div className="space-y-1">
                  {orders.map((o) => (
                    <div key={o.id} className="flex items-center gap-2 text-sm">
                      {o.is_paused ? <Pause className="size-3 text-amber-500 shrink-0" /> : <Play className="size-3 text-emerald-500 shrink-0" />}
                      <span className="font-mono font-semibold">{o.order_number}</span>
                      <span className="text-muted-foreground truncate">
                        {STAGE_LABELS[o.stage] ?? o.stage}
                        {o.coli_total && o.coli_total > 1 ? ` · vol. ${o.coli_number} de ${o.coli_total}` : ""}
                        {o.is_paused ? ` · ${o.pause_reason ?? "pausa"}` : ""}
                      </span>
                      <span className="ml-auto tabular-nums font-semibold">{fmt(liveSeconds(o, now))}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
