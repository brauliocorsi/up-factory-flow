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

const DOT_STYLE: Record<string, string> = {
  ok: "bg-emerald-500",
  atrasada_folga: "bg-amber-500",
  risco_saida: "bg-red-500",
};

export function StageQueuePanel({
  stage,
  variant = "panel",
  onItemClick,
}: {
  stage: Stage;
  variant?: "panel" | "sidebar";
  onItemClick?: (item: StageQueueItem) => void;
}) {
  const fetchQueue = useServerFn(getStageQueue);
  const { session } = useAuth();
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["stage-queue", stage],
    queryFn: () => fetchQueue({ data: { stage } }),
    refetchInterval: 60_000,
    enabled: Boolean(session),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const cap = variant === "sidebar" ? 50 : 20;
  const visible = showAll ? items : items.slice(0, cap);

  function handleClick(it: StageQueueItem) {
    if (onItemClick) {
      onItemClick(it);
      return;
    }
    const el = document.getElementById(`stage-card-${it.order_stage_id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary");
      setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 1500);
    }
  }

  if (variant === "sidebar") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold px-1">
          <ListTree className="size-4 text-muted-foreground" />
          Fila prioritária <span className="text-muted-foreground">({total})</span>
        </div>
        {isLoading ? (
          <div className="text-xs text-muted-foreground py-3 px-1">A calcular fila…</div>
        ) : error ? (
          <div className="text-xs text-destructive px-1">Erro: {(error as Error).message}</div>
        ) : visible.length === 0 ? (
          <div className="text-xs text-muted-foreground py-3 px-1">Sem encomendas em fila.</div>
        ) : (
          <div className="space-y-1.5">
            {visible.map((it: StageQueueItem, idx: number) => (
              <button
                key={it.order_stage_id}
                onClick={() => handleClick(it)}
                className="w-full text-left rounded-md border bg-card hover:bg-accent transition p-2 group"
                title={it.product_description ?? undefined}
              >
                <div className="flex items-center gap-2">
                  <span className={`inline-block size-2.5 rounded-full shrink-0 ${DOT_STYLE[it.status]}`} />
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">#{idx + 1}</span>
                  <span className="font-mono text-sm font-bold truncate">
                    {it.customer_order ?? it.order_number}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-1">
                  <Badge className={`text-[9px] px-1.5 py-0 ${STATUS_STYLE[it.status]}`} variant="outline">
                    {STATUS_LABEL[it.status]}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">→ {formatDatePT(it.target_date)}</span>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground truncate">
                  {it.product_description}
                </div>
              </button>
            ))}
            {total > cap && (
              <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)} className="w-full gap-1 text-xs">
                {showAll ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                {showAll ? `Ver top ${cap}` : `Ver todas (${total})`}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ListTree className="size-4 text-muted-foreground" />
          Fila prioritária ({total})
        </div>
        {total > cap && (
          <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)} className="gap-1">
            {showAll ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            {showAll ? `Mostrar top ${cap}` : `Ver todas (${total})`}
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
            <button
              key={it.order_stage_id}
              onClick={() => handleClick(it)}
              className="w-full text-left flex items-center justify-between gap-2 text-xs rounded-md border bg-card/60 hover:bg-accent px-2 py-1.5"
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
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}