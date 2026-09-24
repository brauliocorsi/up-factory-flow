import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, ListTree } from "lucide-react";
import { formatDatePT } from "@/lib/format";
import { getStageQueue, type Stage, type StageQueueItem } from "@/lib/planning.functions";
import { useAuth } from "@/hooks/useAuth";

const STATUS_STYLE: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-800 border-emerald-300",
  atrasada_folga: "bg-amber-100 text-amber-800 border-amber-300",
  risco_saida: "bg-red-100 text-red-800 border-red-300",
};
const STATUS_LABEL: Record<string, string> = {
  ok: "No prazo",
  atrasada_folga: "Atrasada",
  risco_saida: "Risco de atraso",
};

const DOT_STYLE: Record<string, string> = {
  ok: "bg-emerald-500",
  atrasada_folga: "bg-amber-500",
  risco_saida: "bg-red-500",
};

type FilterKey = "todas" | "atrasadas" | "hoje" | "prazo";

const FILTER_DEFS: { key: FilterKey; label: string; dot?: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "atrasadas", label: "Atrasadas", dot: "bg-red-500" },
  { key: "hoje", label: "Hoje", dot: "bg-amber-500" },
  { key: "prazo", label: "No prazo", dot: "bg-emerald-500" },
];

function QueueFilters({
  filter,
  setFilter,
  counts,
  compact,
}: {
  filter: FilterKey;
  setFilter: (f: FilterKey) => void;
  counts: Record<FilterKey, number>;
  compact?: boolean;
}) {
  return (
    <div className={`flex gap-1 ${compact ? "px-1 pb-1.5" : "mb-2"}`}>
      {FILTER_DEFS.map((f) => (
        <button
          key={f.key}
          onClick={() => setFilter(f.key)}
          className={`flex items-center justify-center gap-1 flex-1 ${compact ? "text-[10px] px-1.5 py-1" : "text-xs px-2 py-1"} rounded-md border transition ${
            filter === f.key
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card text-muted-foreground border-border hover:bg-accent"
          }`}
        >
          {f.dot && <span className={`inline-block size-1.5 rounded-full ${f.dot}`} />}
          {f.label}
          <span className="opacity-60">{counts[f.key]}</span>
        </button>
      ))}
    </div>
  );
}

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
  const [filter, setFilter] = useState<FilterKey>("todas");
  const { data, isLoading, error } = useQuery({
    queryKey: ["stage-queue", stage],
    queryFn: () => fetchQueue({ data: { stage } }),
    refetchInterval: 60_000,
    enabled: Boolean(session),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const today = new Date().toISOString().slice(0, 10);

  const counts: Record<FilterKey, number> = {
    todas: items.length,
    atrasadas: items.filter((it) => it.status === "atrasada_folga" || it.status === "risco_saida").length,
    hoje: items.filter((it) => (it.target_date ?? "").slice(0, 10) === today).length,
    prazo: items.filter((it) => it.status === "ok").length,
  };

  const filtered = items.filter((it) => {
    if (filter === "atrasadas") return it.status === "atrasada_folga" || it.status === "risco_saida";
    if (filter === "hoje") return (it.target_date ?? "").slice(0, 10) === today;
    if (filter === "prazo") return it.status === "ok";
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const da = a.due_date ?? "9999-12-31";
    const db = b.due_date ?? "9999-12-31";
    return da.localeCompare(db);
  });

  const cap = variant === "sidebar" ? 50 : 20;
  const visible = showAll ? sorted : sorted.slice(0, cap);

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
        <QueueFilters filter={filter} setFilter={setFilter} counts={counts} compact />
        {isLoading ? (
          <div className="text-xs text-muted-foreground py-3 px-1">A calcular fila…</div>
        ) : error ? (
          <div className="text-xs text-destructive px-1">Erro: {(error as Error)?.message ?? "falha ao carregar"}</div>
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
                  <span className="text-[10px] text-muted-foreground" title="Data-alvo da etapa">→ {formatDatePT(it.target_date)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-1">
                  <span className="text-[10px] text-muted-foreground truncate flex-1">
                    {it.product_description}
                  </span>
                  <span className="text-[10px] font-semibold text-foreground/70 shrink-0" title="Data de saída">
                    Saída {formatDatePT(it.due_date)}
                  </span>
                </div>
              </button>
            ))}
            {sorted.length > cap && (
              <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)} className="w-full gap-1 text-xs">
                {showAll ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                {showAll ? `Ver top ${cap}` : `Ver todas (${sorted.length})`}
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
        {sorted.length > cap && (
          <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)} className="gap-1">
            {showAll ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            {showAll ? `Mostrar top ${cap}` : `Ver todas (${sorted.length})`}
          </Button>
        )}
      </div>
      <QueueFilters filter={filter} setFilter={setFilter} counts={counts} />
      {isLoading ? (
        <div className="text-xs text-muted-foreground py-3">A calcular fila…</div>
      ) : error ? (
        <div className="text-xs text-destructive">Erro: {(error as Error)?.message ?? "falha ao carregar"}</div>
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
                <span className="font-semibold text-foreground/70" title="Data de saída">Saída {formatDatePT(it.due_date)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}