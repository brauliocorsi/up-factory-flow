import { useRef } from "react";
import type { DashboardData } from "@/lib/orders.functions";
import { STAGES_ORDER, STAGE_LABELS } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Layers } from "lucide-react";
import { OrderCard } from "./OrderCard";

export function KanbanBoard({ data }: { data: DashboardData }) {
  const scroll = useRef<HTMLDivElement>(null);
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Layers className="size-4" />
          {STAGES_ORDER.length} etapas
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Etapas anteriores"
            title="Etapas anteriores"
            onClick={() => scroll.current?.scrollBy({ left: -620, behavior: "smooth" })}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Etapas seguintes"
            title="Etapas seguintes"
            onClick={() => scroll.current?.scrollBy({ left: 620, behavior: "smooth" })}
          >
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
      <div
        ref={scroll}
        className="overflow-x-auto pb-5 [scrollbar-width:thin]"
        role="region"
        aria-label="Quadro de etapas"
        tabIndex={0}
      >
        <div className="flex min-w-max items-start gap-5">
          {STAGES_ORDER.map((stage, index) => {
            const items = data.byStage[stage] ?? [];
            return (
              <section
                key={stage}
                aria-label={`Coluna ${STAGE_LABELS[stage]}`}
                className="w-72 shrink-0"
              >
                <header className="mb-4 flex items-center gap-2 border-b pb-3">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="text-sm font-semibold">{STAGE_LABELS[stage]}</h3>
                  <span className="ml-auto text-xs font-medium tabular-nums text-muted-foreground">
                    {items.length}
                  </span>
                </header>
                <div className="space-y-3">
                  {items.length === 0 ? (
                    <div className="border-t border-dashed py-10 text-center text-xs text-muted-foreground">
                      Sem encomendas
                    </div>
                  ) : (
                    items.map((o) => <OrderCard key={o.id} order={o} />)
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
