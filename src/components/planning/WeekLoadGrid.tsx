import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGE_LABELS } from "@/lib/format";
import { getWeekCapacityPlan, type Stage, type WeekLoadCell } from "@/lib/planning.functions";
import { DayLoadDialog } from "./DayLoadDialog";

const GRID_STAGES: Stage[] = [
  "estrutura", "corte", "costura", "branco", "estofagem", "qualidade", "embalagem",
];

const DAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex"];

function isoDate(d: Date) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

/** Segunda-feira da semana de `base`, deslocada `weeks` semanas. */
function mondayOf(base: Date, weeks: number) {
  const d = new Date(base);
  const dow = (d.getDay() + 6) % 7; // 0 = segunda
  d.setDate(d.getDate() - dow + weeks * 7);
  d.setHours(12, 0, 0, 0);
  return d;
}

function tone(pct: number) {
  if (pct > 100) return "bg-red-500/15 text-red-700 border-red-300";
  if (pct >= 80) return "bg-amber-500/15 text-amber-800 border-amber-300";
  if (pct > 0) return "bg-emerald-500/15 text-emerald-700 border-emerald-300";
  return "bg-muted/40 text-muted-foreground border-border";
}

/**
 * Semana de planeamento: tempo necessário (soma dos tempos por modelo) contra
 * o tempo útil disponível (jornada × pessoas presentes) por operação e dia.
 */
export function WeekLoadGrid({ canEdit }: { canEdit: boolean }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [detail, setDetail] = useState<{ stage: Stage; date: string; capacity: number } | null>(null);
  const fetchWeek = useServerFn(getWeekCapacityPlan);

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

  const { data = [], isLoading } = useQuery({
    queryKey: ["week-capload", from, to],
    queryFn: () => fetchWeek({ data: { from, to } }),
    refetchInterval: 60_000,
  });

  const byKey = useMemo(() => {
    const m = new Map<string, WeekLoadCell>();
    for (const c of data) m.set(`${c.stage}|${String(c.date).slice(0, 10)}`, c);
    return m;
  }, [data]);

  const todayStr = isoDate(new Date());
  const hasUnknown = data.some((c) => c.has_unknown);
  const overDays = data.filter((c) => c.over_minutes > 0).length;

  return (
    <div className="space-y-3">
      <Card className="p-3 flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => setWeekOffset((v) => v - 1)} aria-label="Semana anterior">
          <ChevronLeft className="size-4" />
        </Button>
        <div className="text-sm font-semibold">
          Semana de {days[0]!.split("-").reverse().join("/")} a {days[4]!.split("-").reverse().join("/")}
        </div>
        <Button variant="outline" size="sm" onClick={() => setWeekOffset((v) => v + 1)} aria-label="Semana seguinte">
          <ChevronRight className="size-4" />
        </Button>
        {weekOffset !== 0 && (
          <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)}>Esta semana</Button>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs">
          {overDays > 0 ? (
            <Badge className="bg-red-600 text-white">{overDays} dia(s) a exceder</Badge>
          ) : (
            <Badge className="bg-emerald-600 text-white">Semana dentro do tempo</Badge>
          )}
        </div>
      </Card>

      {hasUnknown && (
        <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 text-sm">
          ⚠ Há produtos sem tempo definido no modelo — os totais estão subestimados. Define os tempos em SLA &gt; Tempo por modelo.
        </div>
      )}

      <Card className="p-0 overflow-x-auto">
        {isLoading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">A calcular…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase">
              <tr>
                <th className="text-left p-2 min-w-28">Operação</th>
                {days.map((d, i) => (
                  <th key={d} className={cn("p-2 text-center min-w-32", d === todayStr && "text-primary")}>
                    {DAY_LABELS[i]} {d.slice(8, 10)}/{d.slice(5, 7)}
                  </th>
                ))}
                <th className="p-2 text-center min-w-28">Semana</th>
              </tr>
            </thead>
            <tbody>
              {GRID_STAGES.map((s) => {
                const cells = days.map((d) => byKey.get(`${s}|${d}`));
                const cap = cells.reduce((a, c) => a + (c?.capacity_minutes ?? 0), 0);
                const load = cells.reduce((a, c) => a + (c?.load_minutes ?? 0), 0);
                const weekPct = cap > 0 ? Math.round((load / cap) * 100) : load > 0 ? 999 : 0;
                return (
                  <tr key={s} className="border-t">
                    <td className="p-2 font-medium">{STAGE_LABELS[s]}</td>
                    {days.map((d, i) => {
                      const c = cells[i];
                      const capacity = c?.capacity_minutes ?? 0;
                      const loadMin = c?.load_minutes ?? 0;
                      const pct = capacity > 0 ? Math.round((loadMin / capacity) * 100) : loadMin > 0 ? 999 : 0;
                      return (
                        <td key={d} className="p-1 align-top">
                          <button
                            type="button"
                            onClick={() => setDetail({ stage: s, date: d, capacity })}
                            className={cn(
                              "w-full rounded-md border px-2 py-1.5 text-left transition hover:brightness-95",
                              tone(pct),
                            )}
                            title={`${loadMin} min necessários de ${capacity} min disponíveis`}
                          >
                            <div className="text-xs font-semibold tabular-nums">
                              {loadMin}/{capacity} min
                            </div>
                            <div className="text-[10px] tabular-nums">
                              {pct}% · {c?.items_count ?? 0} pç
                              {c?.has_unknown ? " ⚠" : ""}
                            </div>
                            {c && c.over_minutes > 0 && (
                              <div className="text-[10px] font-semibold">excede {c.over_minutes} min</div>
                            )}
                          </button>
                        </td>
                      );
                    })}
                    <td className="p-2 text-center">
                      <div className="text-xs font-semibold tabular-nums">{load}/{cap}</div>
                      <div className={cn("text-[10px] tabular-nums", weekPct > 100 && "text-red-600 font-semibold")}>
                        {weekPct}%
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <p className="text-xs text-muted-foreground">
        Tempo disponível = jornada diária × pessoas presentes na operação. Tempo necessário = tempo do modelo
        de cada produto com data-alvo nesse dia. O dia de hoje inclui o trabalho atrasado.
      </p>

      {detail && (
        <DayLoadDialog
          stage={detail.stage}
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
