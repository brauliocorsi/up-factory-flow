import type { PanelIdle } from "@/lib/publicPanel.functions";

export function IdlePausePanel({ rows }: { rows: PanelIdle[] }) {
  const sorted = [...rows].sort((a, b) => b.idle_min - a.idle_min);
  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="text-sm uppercase tracking-widest text-muted-foreground mb-3">Ocioso e pausas hoje</div>
      {sorted.length === 0 ? (
        <div className="text-sm text-muted-foreground">Sem registos hoje.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {sorted.map((r) => (
            <div key={r.operator_id} className="rounded-xl border p-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate">{r.operator_name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {r.current_pause_reason ? `Em pausa: ${r.current_pause_reason}` : `Produtivo ${r.productive_min} min`}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-black tabular-nums text-destructive">{r.idle_min}m</div>
                <div className="text-[10px] uppercase text-muted-foreground">ocioso</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-black tabular-nums text-amber-600">{r.pause_min}m</div>
                <div className="text-[10px] uppercase text-muted-foreground">pausa</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
