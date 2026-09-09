import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGE_LABELS, formatDatePT } from "@/lib/format";
import {
  getWeekCapacityPlan,
  getDayStageOrders,
  getDailyMinutes,
  type Stage,
  type DayStageOrder,
} from "@/lib/planning.functions";
import { DayLoadDialog } from "./DayLoadDialog";

const PANEL_STAGES: Stage[] = [
  "estofagem", "estrutura", "corte", "costura", "branco", "qualidade", "embalagem",
];

const DAY_LABELS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];

type StatusFilter = "todas" | "ativas" | "pendentes";
type TimeFilter = "todos" | "com_tempo" | "sem_tempo";

function isoDate(d: Date) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

function mondayOf(base: Date, weeks: number) {
  const d = new Date(base);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow + weeks * 7);
  d.setHours(12, 0, 0, 0);
  return d;
}

function tone(pct: number) {
  if (pct > 100) return "border-red-300 bg-red-500/10";
  if (pct >= 80) return "border-amber-300 bg-amber-500/10";
  if (pct > 0) return "border-emerald-300 bg-emerald-500/10";
  return "border-border bg-muted/30";
}

/**
 * Painel de planeamento: por semana e por posto, compara o tempo necessário
 * das encomendas planeadas com o tempo disponível (jornada × pessoas do posto).
 */
export function PlanningPanel({ canEdit }: { canEdit: boolean }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [stage, setStage] = useState<Stage>("estofagem");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todas");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("todos");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<{ date: string; capacity: number } | null>(null);

  const fetchWeek = useServerFn(getWeekCapacityPlan);
  const fetchDay = useServerFn(getDayStageOrders);
  const fetchJornada = useServerFn(getDailyMinutes);

  const monday = useMemo(() => mondayOf(new Date(), weekOffset), [weekOffset]);
  const days = useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(d.getDate() + i);
        return isoDate(d);
      }),
    [monday],
  );
  const from = days[0]!;
  const to = days[4]!;

  const { data: dailyMinutes = 450 } = useQuery({
    queryKey: ["daily-minutes"],
    queryFn: () => fetchJornada(),
    staleTime: 300_000,
  });

  const { data: week = [] } = useQuery({
    queryKey: ["week-capload", from, to],
    queryFn: () => fetchWeek({ data: { from, to } }),
    refetchInterval: 60_000,
  });

  const capacityByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of week) {
      if (c.stage === stage) m.set(String(c.date).slice(0, 10), c.capacity_minutes ?? 0);
    }
    return m;
  }, [week, stage]);

  const dayQueries = useQueries({
    queries: days.map((d) => ({
      queryKey: ["day-stage-orders", stage, d],
      queryFn: () => fetchDay({ data: { stage, date: d } }),
      refetchInterval: 60_000,
    })),
  });

  const loading = dayQueries.some((q) => q.isLoading);
  const term = search.trim().toLowerCase();

  function matches(r: DayStageOrder) {
    if (statusFilter === "ativas" && r.order_status === "pendente") return false;
    if (statusFilter === "pendentes" && r.order_status !== "pendente") return false;
    if (timeFilter === "com_tempo" && r.expected_minutes == null) return false;
    if (timeFilter === "sem_tempo" && r.expected_minutes != null) return false;
    if (!term) return true;
    return [r.order_number, r.customer_order, r.product_description, r.model_name, r.measure]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(term));
  }

  const rowsByDay = days.map((_, i) => (dayQueries[i]?.data ?? []).filter(matches));

  const cells = days.map((d, i) => {
    const rows = rowsByDay[i]!;
    const capacity = capacityByDate.get(d) ?? 0;
    const load = rows.reduce((a, r) => a + (r.expected_minutes ?? 0), 0);
    const unknown = rows.filter((r) => r.expected_minutes == null).length;
    const pct = capacity > 0 ? Math.round((load / capacity) * 100) : load > 0 ? 999 : 0;
    const people = dailyMinutes > 0 ? Math.round((capacity / dailyMinutes) * 10) / 10 : 0;
    return { date: d, rows, capacity, load, unknown, pct, people };
  });

  const totalCap = cells.reduce((a, c) => a + c.capacity, 0);
  const totalLoad = cells.reduce((a, c) => a + c.load, 0);
  const totalItems = cells.reduce((a, c) => a + c.rows.length, 0);
  const totalUnknown = cells.reduce((a, c) => a + c.unknown, 0);
  const totalPct = totalCap > 0 ? Math.round((totalLoad / totalCap) * 100) : totalLoad > 0 ? 999 : 0;
  const overDays = cells.filter((c) => c.load > c.capacity).length;
  const todayStr = isoDate(new Date());

  return (
    <div className="space-y-3">
      <Card className="p-3 flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setWeekOffset((v) => v - 1)} aria-label="Semana anterior">
            <ChevronLeft className="size-4" />
          </Button>
          <div className="px-2 text-sm font-semibold whitespace-nowrap">
            {formatDatePT(from)} — {formatDatePT(to)}
          </div>
          <Button variant="outline" size="sm" onClick={() => setWeekOffset((v) => v + 1)} aria-label="Semana seguinte">
            <ChevronRight className="size-4" />
          </Button>
          {weekOffset !== 0 && (
            <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)}>Esta semana</Button>
          )}
        </div>

        <div>
          <Label className="text-xs">Posto</Label>
          <Select value={stage} onValueChange={(v) => setStage(v as Stage)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PANEL_STAGES.map((s) => (<SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs">Estado</Label>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="ativas">Só ativas</SelectItem>
              <SelectItem value="pendentes">Só pendentes</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs">Tempo</Label>
          <Select value={timeFilter} onValueChange={(v) => setTimeFilter(v as TimeFilter)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="com_tempo">Com tempo definido</SelectItem>
              <SelectItem value="sem_tempo">Sem tempo definido</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-48 flex-1">
          <Label className="text-xs">Pesquisar</Label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nº, produto, modelo, medida…"
          />
        </div>
      </Card>

      <Card className="p-3 flex flex-wrap items-center gap-4 text-sm">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" />
          <span className="font-medium">{STAGE_LABELS[stage]}</span>
          <span className="text-muted-foreground">
            {dailyMinutes} min por pessoa/dia
          </span>
        </div>
        <div className="tabular-nums">
          Semana: <strong>{totalLoad}</strong> min necessários de <strong>{totalCap}</strong> min disponíveis
          {" · "}
          <span className={cn(totalPct > 100 ? "text-red-600 font-semibold" : totalPct >= 80 ? "text-amber-700 font-semibold" : "text-emerald-700 font-semibold")}>
            {totalPct}%
          </span>
          {" · "}{totalItems} peça(s)
        </div>
        <div className="ml-auto">
          {overDays > 0 ? (
            <Badge className="bg-red-600 text-white">{overDays} dia(s) a exceder</Badge>
          ) : (
            <Badge className="bg-emerald-600 text-white">Semana possível</Badge>
          )}
        </div>
      </Card>

      {totalUnknown > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 text-sm">
          ⚠ {totalUnknown} produto(s) sem tempo definido no modelo — tempo desconhecido, carga subestimada.
          Define os tempos em SLA &gt; Tempo por modelo.
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {cells.map((c, i) => {
          const diff = c.capacity - c.load;
          return (
            <Card key={c.date} className={cn("p-3 space-y-2 border-2", tone(c.pct), c.date === todayStr && "ring-2 ring-primary/40")}>
              <div className="flex items-baseline justify-between">
                <div className="font-semibold">{DAY_LABELS[i]}</div>
                <div className="text-xs text-muted-foreground">{formatDatePT(c.date)}</div>
              </div>

              <div className="text-xs text-muted-foreground">
                {c.people} pessoa(s) × {dailyMinutes} min = <strong>{c.capacity} min</strong>
              </div>

              <div className="text-sm tabular-nums">
                Necessário: <strong>{c.load} min</strong> ({c.pct}%)
              </div>
              <div className="h-2 rounded bg-muted overflow-hidden">
                <div
                  className={cn("h-2", c.pct > 100 ? "bg-red-500" : c.pct >= 80 ? "bg-amber-500" : "bg-emerald-500")}
                  style={{ width: `${Math.min(100, c.pct)}%` }}
                />
              </div>

              <div className={cn("text-xs font-semibold", diff < 0 ? "text-red-600" : "text-emerald-700")}>
                {c.capacity === 0 && c.load > 0
                  ? "Sem pessoas atribuídas neste dia"
                  : diff < 0
                    ? `Excede ${Math.abs(diff)} min`
                    : `Sobram ${diff} min`}
              </div>

              <div className="text-xs text-muted-foreground">
                {c.rows.length} peça(s){c.unknown > 0 ? ` · ${c.unknown} sem tempo` : ""}
              </div>

              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setDetail({ date: c.date, capacity: c.capacity })}
              >
                Ver encomendas
              </Button>
            </Card>
          );
        })}
      </div>

      {loading && <p className="text-xs text-muted-foreground">A calcular…</p>}

      <p className="text-xs text-muted-foreground">
        Tempo disponível = jornada diária × pessoas ligadas ao posto (presenças do dia). Tempo necessário = tempo do
        modelo de cada produto com data-alvo nesse dia. O dia de hoje inclui trabalho atrasado.
      </p>

      {detail && (
        <DayLoadDialog
          stage={stage}
          date={detail.date}
          capacityMinutes={detail.capacity}
          canEdit={canEdit}
          open
          onOpenChange={(v) => { if (!v) setDetail(null); }}
        />
      )}
    </div>
  );
}
