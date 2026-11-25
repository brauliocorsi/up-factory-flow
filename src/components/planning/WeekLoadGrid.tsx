import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, AlertTriangle, Clock, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGE_LABELS, formatDatePT } from "@/lib/format";
import { getWeekCapacityPlan, type Stage, type WeekLoadCell } from "@/lib/planning.functions";
import { hoursLabel, loadSummary } from "@/lib/productionCalculations";
import { DayLoadDialog } from "./DayLoadDialog";
import { StageQueuePanel } from "./StageQueuePanel";

const GRID_STAGES: Stage[] = [
  "estrutura",
  "corte",
  "costura",
  "branco",
  "estofagem",
  "qualidade",
  "embalagem",
];
const DAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex"];
const STATE_LABEL = {
  unknown: "Tempo por definir",
  no_team: "Sem equipa",
  over: "Carga excedida",
  available: "Dentro da capacidade",
};
const STATE_CLASS = {
  unknown: "border-warning/40 bg-warning/10",
  no_team: "border-border bg-muted/30",
  over: "border-destructive/30 bg-destructive/5",
  available: "border-success/30 bg-success/5",
};
function isoDate(d: Date) {
  return d.toLocaleDateString("sv-SE");
}

export function WeekLoadGrid({ canEdit }: { canEdit: boolean }) {
  const navigate = useNavigate();
  const [weekOffset, setWeekOffset] = useState(0);
  const [queueStage, setQueueStage] = useState<Stage>("estrutura");
  const [detail, setDetail] = useState<{ stage: Stage; date: string; capacity: number } | null>(
    null,
  );
  const fetchWeek = useServerFn(getWeekCapacityPlan);
  const days = useMemo(() => {
    const monday = new Date();
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + weekOffset * 7);
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      return isoDate(d);
    });
  }, [weekOffset]);
  const from = days[0] ?? "";
  const to = days[4] ?? from;
  const {
    data = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["week-capload", from, to],
    queryFn: () => fetchWeek({ data: { from, to } }),
    refetchInterval: 30_000,
  });
  const byKey = new Map<string, WeekLoadCell>(
    data.map((c) => [`${c.stage}|${String(c.date).slice(0, 10)}`, c]),
  );
  const relevant = data.filter((c) => GRID_STAGES.includes(c.stage));
  const load = relevant.reduce((sum, c) => sum + c.load_minutes, 0);
  const unknown = relevant.filter((c) => c.has_unknown).length;
  const over = relevant.filter((c) => c.load_minutes > c.capacity_minutes).length;
  const today = isoDate(new Date());
  return (
    <div className="min-w-0 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h2 className="font-semibold">Plano semanal</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Datas-alvo por etapa · {formatDatePT(from)} — {formatDatePT(to)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Semana anterior"
            onClick={() => setWeekOffset((v) => v - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)}>
            Esta semana
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Semana seguinte"
            onClick={() => setWeekOffset((v) => v + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </header>
      <div className="grid grid-cols-1 gap-4 border-b pb-5 sm:grid-cols-3">
        {[
          { label: "Trabalho necessário", value: hoursLabel(load), icon: Clock },
          { label: "Dias/postos em excesso", value: String(over), icon: CalendarDays },
          { label: "Dias/postos sem tempos", value: String(unknown), icon: AlertTriangle },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Icon className="size-4" />
              {label}
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">
              {isLoading ? "—" : value}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant={unknown ? "warning" : over ? "danger" : "secondary"}>
          {isLoading
            ? "A carregar"
            : isError
              ? "Dados indisponíveis"
              : unknown
                ? "Estimativa incompleta"
                : over
                  ? "Rever distribuição"
                  : "Estimativa por posto"}
        </Badge>
        <span className="text-xs text-muted-foreground">
          Capacidades não somadas entre postos: um colaborador pode pertencer a vários.
        </span>
      </div>
      {isLoading ? (
        <div className="py-10 text-center text-muted-foreground">A carregar o plano…</div>
      ) : isError ? (
        <div role="alert" className="py-8 text-destructive">
          Não foi possível carregar o plano.
        </div>
      ) : (
        <div className="space-y-5">
          <div className="hidden grid-cols-[110px_repeat(5,minmax(0,1fr))] gap-2 lg:grid">
            <span className="text-xs text-muted-foreground">Posto</span>
            {days.map((d, i) => (
              <div key={d} className="text-center text-xs font-medium">
                {DAY_LABELS[i]} · {d.slice(8)}/{d.slice(5, 7)}
              </div>
            ))}
          </div>
          {GRID_STAGES.map((s) => (
            <section
              key={s}
              className="grid gap-2 border-b pb-5 lg:grid-cols-[110px_repeat(5,minmax(0,1fr))] lg:border-0 lg:pb-0"
            >
              <h3 className="text-sm font-semibold lg:self-center">{STAGE_LABELS[s]}</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:contents">
                {days.map((d, i) => {
                  const c = byKey.get(`${s}|${d}`);
                  const cap = c?.capacity_minutes ?? 0;
                  const min = c?.load_minutes ?? 0;
                  const summary = loadSummary(min, cap, c?.has_unknown ?? false);
                  return (
                    <Button
                      key={d}
                      variant="outline"
                      onClick={() => setDetail({ stage: s, date: d, capacity: cap })}
                      aria-label={`${STAGE_LABELS[s]}, ${formatDatePT(d)}, ver encomendas`}
                      className={cn(
                        "h-auto min-h-28 w-full flex-col items-stretch gap-1 whitespace-normal p-3 text-left font-normal",
                        STATE_CLASS[summary.state],
                        d === today && "ring-1 ring-primary/40",
                      )}
                    >
                      <span className="flex justify-between text-xs lg:hidden">
                        <strong>{DAY_LABELS[i]}</strong>
                        {formatDatePT(d)}
                      </span>
                      <span className="text-lg font-semibold tabular-nums">
                        {hoursLabel(min)}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          / {hoursLabel(cap)}
                        </span>
                      </span>
                      <span className="text-[11px]">
                        {STATE_LABEL[summary.state]}
                        {summary.percent === null ? "" : ` · ${summary.percent}%`}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {c?.items_count ?? 0} encomendas
                        {c?.includes_overdue ? " · inclui atraso" : ""}
                      </span>
                      {summary.balance < 0 && (
                        <span className="text-[11px] font-medium text-destructive">
                          Excesso {hoursLabel(-summary.balance)}
                        </span>
                      )}
                    </Button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      <section className="border-t pt-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Ordem de trabalho · fila atual</h2>
          <Select value={queueStage} onValueChange={(v) => setQueueStage(v as Stage)}>
            <SelectTrigger className="w-44" aria-label="Posto da fila">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRID_STAGES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STAGE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <StageQueuePanel
          stage={queueStage}
          variant="sidebar"
          onItemClick={(item) => {
            navigate({ to: "/producao", search: { q: item.order_number, stage: queueStage } });
          }}
        />
      </section>
      {detail && (
        <DayLoadDialog
          stage={detail.stage}
          date={detail.date}
          capacityMinutes={detail.capacity}
          canEdit={canEdit}
          open
          onOpenChange={(v) => {
            if (!v) setDetail(null);
          }}
        />
      )}
    </div>
  );
}
