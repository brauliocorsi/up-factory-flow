import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { STAGE_LABELS, formatDatePT } from "@/lib/format";
import { STAGES, getStageCapacityLoad, type Stage } from "@/lib/planning.functions";

export const Route = createFileRoute("/_authenticated/admin/planeamento/carga")({
  component: CargaPage,
  errorComponent: ({ error, reset }) => (
    <div className="max-w-xl mx-auto p-6 text-center space-y-3">
      <AlertTriangle className="size-8 text-orange-600 mx-auto" />
      <p className="text-sm text-muted-foreground">{error?.message}</p>
      <Button onClick={() => reset()}>Tentar novamente</Button>
    </div>
  ),
});

function isoOffset(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

function CargaPage() {
  const [stage, setStage] = useState<Stage>("estofagem");
  const [from, setFrom] = useState(isoOffset(0));
  const [to, setTo] = useState(isoOffset(14));
  const fetchFn = useServerFn(getStageCapacityLoad);

  const { data = [], isLoading } = useQuery({
    queryKey: ["stage-capload", stage, from, to],
    queryFn: () => fetchFn({ data: { stage, from, to } }),
    refetchInterval: 60_000,
  });

  const hasUnknown = useMemo(() => data.some((d: any) => d.has_unknown), [data]);

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link
          to="/admin/planeamento"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Voltar
        </Link>
        <h1 className="text-2xl font-bold">Carga vs capacidade</h1>
      </div>

      <Card className="p-3 flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">Etapa</Label>
          <Select value={stage} onValueChange={(v) => setStage(v as Stage)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STAGES.map((s) => (<SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">De</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">Até</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
      </Card>

      {hasUnknown && (
        <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 text-sm">
          ⚠ Alguns produtos não têm SLA cadastrado — a carga apresentada está subestimada.
        </div>
      )}
      <div className="text-xs text-muted-foreground">
        Carga do dia de hoje inclui trabalho atrasado por concluir (acumulado).
      </div>

      <Card className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-center text-muted-foreground text-sm">A calcular…</div>
        ) : data.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">Sem dias úteis no intervalo.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase">
              <tr>
                <th className="text-left p-2">Dia</th>
                <th className="text-right p-2">Capacidade (min)</th>
                <th className="text-right p-2">Carga (min)</th>
                <th className="text-right p-2">Peças</th>
                <th className="text-left p-2 w-1/3">%</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d: any) => {
                const pct = d.capacity_minutes > 0 ? Math.round((d.load_minutes / d.capacity_minutes) * 100) : 0;
                const color =
                  pct > 100 ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-emerald-500";
                return (
                  <tr key={d.date} className="border-t">
                    <td className="p-2">
                      {formatDatePT(d.date)}
                      {d.includes_overdue && (
                        <span className="ml-2 text-[10px] text-muted-foreground">(hoje + atrasado)</span>
                      )}
                    </td>
                    <td className="p-2 text-right tabular-nums">{d.capacity_minutes}</td>
                    <td className="p-2 text-right tabular-nums">{d.load_minutes}</td>
                    <td className="p-2 text-right tabular-nums">{d.items_count}</td>
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <div className="relative w-full h-2 bg-muted rounded">
                          <div
                            className={`h-2 rounded ${color}`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums w-12 text-right">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}