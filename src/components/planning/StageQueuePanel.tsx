import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, ListTree } from "lucide-react";
import { formatDatePT } from "@/lib/format";
import { getStageQueue, type Stage, type StageQueueItem } from "@/lib/planning.functions";

const STATUS_STYLE: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-800 border-emerald-300",
  atrasada_folga: "bg-amber-100 text-amber-800 border-amber-300",
  risco_saida: "bg-red-100 text-red-800 border-red-300",
};
const STATUS_LABEL: Record<string, string> = {
  ok: "no prazo",
  atrasada_folga: "atrasada",
  risco_saida: "risco saída",
};

export function StageQueuePanel({ stage }: { stage: Stage }) {
  const fetchQueue = useServerFn(getStageQueue);
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["stage-queue", stage],
    queryFn: () => fetchQueue({ data: { stage } }),
    refetchInterval: 60_000,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const visible = showAll ? items : items.slice(0, 20);

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ListTree className="size-4 text-muted-foreground" />
          Fila prioritária ({total})
        </div>
        {total > 20 && (
          <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)} className="gap-1">
            {showAll ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            {showAll ? "Mostrar top 20" : `Ver todas (${total})`}
          </Button>
        )}
      </div>
      {isLoading ? (
        <div className="text-xs text-muted-foreground py-3">A calcular fila…</div>
      ) : error ? (
        <div className="text-xs text-destructive">Erro: {(error as Error).message}</div>
      ) : visible.length === 0 ? (
        <div className="text-xs text-muted-foreground py-3">Sem encomendas em fila.</div>
      ) : (
        <div className="space-y-1">
          {visible.map((it: StageQueueItem) => (
            <div
              key={it.order_stage_id}
              className="flex items-center justify-between gap-2 text-xs rounded-md border bg-card/60 px-2 py-1.5"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Badge className={`text-[10px] ${STATUS_STYLE[it.status]}`} variant="outline">
                  {STATUS_LABEL[it.status]}
                </Badge>
                <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                  {it.customer_order ?? it.order_number}
                </span>
                <span className="truncate">{it.product_description}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 text-[11px] text-muted-foreground">
                <span title="Data-alvo da etapa">→ {formatDatePT(it.target_date)}</span>
                <span className="hidden sm:inline" title="Data de saída">saída {formatDatePT(it.due_date)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}