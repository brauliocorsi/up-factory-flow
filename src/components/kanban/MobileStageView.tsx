import { useState } from "react";
import type { DashboardData } from "@/lib/orders.functions";
import { STAGES_ORDER, STAGE_LABELS } from "@/lib/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OrderCard } from "./OrderCard";

export function MobileStageView({ data }: { data: DashboardData }) {
  const [active, setActive] = useState<string>(STAGES_ORDER[0] ?? "estrutura");
  const items = data.byStage[active] ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <Select value={active} onValueChange={setActive}>
          <SelectTrigger aria-label="Etapa do quadro" className="w-52 bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STAGES_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {STAGE_LABELS[s]} · {data.byStage[s]?.length ?? 0}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{items.length} encomendas</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.length === 0 ? (
          <div className="col-span-full py-12 text-center text-sm text-muted-foreground">
            Sem encomendas nesta etapa
          </div>
        ) : (
          items.map((o) => <OrderCard key={o.id} order={o} />)
        )}
      </div>
    </div>
  );
}
