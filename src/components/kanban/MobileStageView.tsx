import { useState } from "react";
import type { DashboardData } from "@/lib/orders.functions";
import { STAGES_ORDER, STAGE_LABELS } from "@/lib/format";
import { OrderCard } from "./OrderCard";

export function MobileStageView({ data }: { data: DashboardData }) {
  const [active, setActive] = useState<string>(STAGES_ORDER[0]);
  const items = data.byStage[active] ?? [];
  return (
    <div>
      <div className="overflow-x-auto sticky top-14 bg-background z-10 border-b">
        <div className="flex">
          {STAGES_ORDER.map((s) => {
            const count = data.byStage[s]?.length ?? 0;
            const isActive = active === s;
            return (
              <button
                key={s}
                onClick={() => setActive(s)}
                className={`shrink-0 px-4 py-3 text-xs font-medium border-b-2 transition ${isActive ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
              >
                {STAGE_LABELS[s]} <span className="ml-1 bg-muted rounded-full px-1.5 py-0.5 text-[10px]">{count}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="p-4 space-y-2">
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-12">Sem encomendas nesta etapa</div>
        ) : items.map((o) => <OrderCard key={o.id} order={o} />)}
      </div>
    </div>
  );
}