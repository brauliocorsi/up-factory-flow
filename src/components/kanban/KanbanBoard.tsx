import type { DashboardData } from "@/lib/orders.functions";
import { STAGES_ORDER, STAGE_LABELS } from "@/lib/format";
import { OrderCard } from "./OrderCard";

export function KanbanBoard({ data }: { data: DashboardData }) {
  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-3 min-w-max px-4">
        {STAGES_ORDER.map((stage) => {
          const items = data.byStage[stage] ?? [];
          return (
            <div key={stage} className="w-72 shrink-0">
              <div className="flex items-center justify-between px-2 py-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide">{STAGE_LABELS[stage]}</h3>
                <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.length === 0 ? (
                  <div className="text-xs text-muted-foreground text-center py-8 border border-dashed rounded-md">Sem encomendas</div>
                ) : items.map((o) => <OrderCard key={o.id} order={o} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}