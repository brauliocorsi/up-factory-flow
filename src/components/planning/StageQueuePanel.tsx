import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, ListOrdered, Flame, AlertTriangle, CalendarClock, CheckCircle2, Play, Search } from "lucide-react";
import { formatDatePT } from "@/lib/format";
import { getStageQueue, type Stage, type StageQueueItem } from "@/lib/planning.functions";
import { useAuth } from "@/hooks/useAuth";
import { PriorityBadge } from "./PriorityBadge";

const STATUS_LABEL: Record<string, string> = { ok: "No prazo", atrasada_folga: "Atrasada", risco_saida: "Risco" };
const STATUS_TEXT: Record<string, string> = {
  ok: "text-success", atrasada_folga: "text-warning", risco_saida: "text-destructive",
};
const BAR: Record<string, string> = { ok: "bg-success", atrasada_folga: "bg-warning", risco_saida: "bg-destructive" };

type FilterKey = "todas" | "urgentes" | "atrasadas" | "hoje" | "prazo";
const FILTERS: { key: FilterKey; label: string; icon: typeof Flame }[] = [
  { key: "todas", label: "Todas", icon: ListOrdered },
  { key: "urgentes", label: "Urgentes", icon: Flame },
  { key: "atrasadas", label: "Atraso", icon: AlertTriangle },
  { key: "hoje", label: "Hoje", icon: CalendarClock },
  { key: "prazo", label: "No prazo", icon: CheckCircle2 },
];

export function StageQueuePanel({
  stage, variant = "panel", onItemClick,
}: { stage: Stage; variant?: "panel" | "sidebar"; onItemClick?: (item: StageQueueItem) => void }) {
  const fetchQueue = useServerFn(getStageQueue);
  const { session } = useAuth();
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("todas");
  const [q, setQ] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["stage-queue", stage],
    queryFn: () => fetchQueue({ data: { stage } }),
    refetchInterval: 30_000,
    enabled: Boolean(session),
  });

  const items = data?.items ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const late = (it: StageQueueItem) => it.status !== "ok";
  const match = (it: StageQueueItem, f: FilterKey) =>
    f === "urgentes" ? (it.priority ?? 1) >= 3
    : f === "atrasadas" ? late(it)
    : f === "hoje" ? (it.target_date ?? "").slice(0, 10) === today
    : f === "prazo" ? it.status === "ok" : true;
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, items.filter((i) => match(i, f.key)).length])) as Record<FilterKey, number>;
  const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const list = items.filter((it) => match(it, filter) && (!q.trim() ||
    norm(`${it.customer_order} ${it.order_number} ${it.product_description}`).includes(norm(q.trim()))));

  const cap = variant === "sidebar" ? 30 : 15;
  const visible = showAll ? list : list.slice(0, cap);
  // Posição na fila global (independente do filtro), para todos falarem do mesmo número.
  const pos = new Map(items.map((it, i) => [it.order_stage_id, i + 1]));
  const next = items[0];

  function handleClick(it: StageQueueItem) {
    if (onItemClick) return onItemClick(it);
    const el = document.getElementById(`stage-card-${it.order_stage_id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary");
      setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 1500);
    }
  }

  const body = (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ListOrdered className="size-4 text-primary" /> Fila prioritária
        </div>
        <span className="text-xs text-muted-foreground">{data?.total ?? 0} na fila</span>
      </div>

      {next && (
        <button onClick={() => handleClick(next)}
          className="w-full text-left rounded-xl bg-primary text-primary-foreground p-3 shadow-soft hover:opacity-95 transition">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide opacity-90">
            <Play className="size-3.5 fill-current" /> Começar por esta
          </div>
          <div className="mt-1 font-mono text-xl font-bold">{next.customer_order ?? next.order_number}</div>
          <div className="text-xs opacity-90 line-clamp-2">{next.product_description}</div>
          <div className="mt-2 flex items-center gap-3 text-[11px] opacity-90">
            {(next.priority ?? 1) >= 3 && <span className="inline-flex items-center gap-1 font-bold"><Flame className="size-3" />Urgente</span>}
            <span>Fazer até {formatDatePT(next.target_date)}</span>
            <span>Saída {formatDatePT(next.due_date)}</span>
          </div>
        </button>
      )}

      <div className="grid grid-cols-5 gap-1">
        {FILTERS.map((f) => {
          const Icon = f.icon; const on = filter === f.key;
          return (
            <button key={f.key} onClick={() => setFilter(f.key)} title={f.label}
              className={`flex flex-col items-center gap-0.5 rounded-lg border py-1.5 text-[10px] transition ${on ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground hover:bg-accent"}`}>
              <Icon className="size-3.5" />
              <span className="leading-none">{f.label}</span>
              <span className="font-semibold leading-none">{counts[f.key]}</span>
            </button>
          );
        })}
      </div>

      <div className="relative">
        <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Encomenda ou produto"
          className="w-full h-8 rounded-lg border bg-muted/40 pl-8 pr-2 text-xs outline-none focus:ring-2 focus:ring-ring" />
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground py-3">A calcular fila…</div>
      ) : error ? (
        <div className="text-xs text-destructive">Erro: {(error as Error)?.message ?? "falha ao carregar"}</div>
      ) : visible.length === 0 ? (
        <div className="text-xs text-muted-foreground py-3 text-center">Sem encomendas nesta vista.</div>
      ) : (
        <ol className="space-y-1.5">
          {visible.map((it) => (
            <li key={it.order_stage_id}>
              <button onClick={() => handleClick(it)} title={it.product_description ?? undefined}
                className="w-full text-left flex items-stretch gap-2 rounded-lg border bg-card hover:bg-accent transition overflow-hidden">
                <span className={`w-1 shrink-0 ${BAR[it.status]}`} />
                <span className="flex items-center justify-center w-7 shrink-0 font-mono text-sm font-bold text-muted-foreground">
                  {pos.get(it.order_stage_id)}
                </span>
                <span className="flex-1 min-w-0 py-1.5 pr-2">
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-sm font-bold truncate">{it.customer_order ?? it.order_number}</span>
                    {(it.priority ?? 1) >= 2 && <PriorityBadge priority={it.priority ?? 1} size="xs" />}
                    {it.stage_status === "em_curso" && <span className="text-[10px] font-semibold text-primary">a fazer</span>}
                  </span>
                  <span className="block text-[11px] text-muted-foreground truncate">{it.product_description}</span>
                  <span className="flex items-center justify-between text-[10px] mt-0.5">
                    <span className={`font-semibold ${STATUS_TEXT[it.status]}`}>{STATUS_LABEL[it.status]}</span>
                    <span className="text-muted-foreground">até {formatDatePT(it.target_date)} · saída {formatDatePT(it.due_date)}</span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {list.length > cap && (
        <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)} className="w-full gap-1 text-xs">
          {showAll ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          {showAll ? `Ver só as primeiras ${cap}` : `Ver todas (${list.length})`}
        </Button>
      )}
    </div>
  );

  return variant === "sidebar" ? body : <Card className="p-3">{body}</Card>;
}
