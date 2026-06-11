import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wrench, Clock } from "lucide-react";
import { STAGE_LABELS } from "@/lib/format";
import { STAGES, type Stage } from "@/lib/production.functions";
import { listReworkEvents, getReworkMetrics } from "@/lib/rework.functions";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";

export const Route = createFileRoute("/_authenticated/retrabalho")({
  component: ReworkPage,
});

function ReworkPage() {
  const [status, setStatus] = useState<"aberto"|"resolvido"|"todos">("todos");
  const [detected, setDetected] = useState<Stage | "all">("all");
  const [target, setTarget] = useState<Stage | "all">("all");

  const listFn = useServerFn(listReworkEvents);
  const metricsFn = useServerFn(getReworkMetrics);

  const filters = {
    status: status === "todos" ? undefined : status,
    detected_stage: detected === "all" ? undefined : detected,
    target_stage: target === "all" ? undefined : target,
  };

  const { data: events } = useQuery({
    queryKey: ["rework-events", filters],
    queryFn: () => listFn({ data: filters }),
  });
  const { data: metrics } = useQuery({
    queryKey: ["rework-metrics"],
    queryFn: () => metricsFn(),
    refetchInterval: 30000,
  });
  useRealtimeOrders([["rework-events"], ["rework-metrics"]]);

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-3">
        <Wrench className="size-6 text-orange-600" />
        <h1 className="text-2xl font-bold">Retrabalho</h1>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Total" value={metrics?.total ?? 0} />
        <Metric label="Em aberto" value={metrics?.open ?? 0} accent="text-orange-600" />
        <Metric label="Resolvidos" value={metrics?.resolved ?? 0} accent="text-emerald-600" />
        <Metric label="Motivos distintos" value={metrics?.by_reason.length ?? 0} />
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <RankCard title="Onde se detetam" data={metrics?.by_detected.map(d => ({ label: STAGE_LABELS[d.stage], count: d.count })) ?? []} />
        <RankCard title="Para onde voltam" data={metrics?.by_target.map(d => ({ label: STAGE_LABELS[d.stage], count: d.count })) ?? []} />
        <RankCard title="Motivos mais frequentes" data={metrics?.by_reason.map(d => ({ label: d.reason, count: d.count })) ?? []} />
      </div>

      {/* Filtros */}
      <Card className="p-3 flex flex-wrap gap-2 items-center">
        <FilterSelect label="Estado" value={status} onChange={(v) => setStatus(v as any)} options={[
          { v: "todos", l: "Todos" }, { v: "aberto", l: "Abertos" }, { v: "resolvido", l: "Resolvidos" },
        ]} />
        <FilterSelect label="Detetado em" value={detected} onChange={(v) => setDetected(v as any)} options={[
          { v: "all", l: "Todas as etapas" }, ...STAGES.map((s) => ({ v: s, l: STAGE_LABELS[s] })),
        ]} />
        <FilterSelect label="Enviado para" value={target} onChange={(v) => setTarget(v as any)} options={[
          { v: "all", l: "Todas as etapas" }, ...STAGES.map((s) => ({ v: s, l: STAGE_LABELS[s] })),
        ]} />
      </Card>

      {/* Lista */}
      <div className="space-y-2">
        {(events ?? []).length === 0 ? (
          <div className="text-center text-muted-foreground py-12 border border-dashed rounded-md">
            Sem retrabalhos para os filtros selecionados
          </div>
        ) : (events ?? []).map((e) => (
          <Card key={e.id} className={`p-3 border-l-4 ${e.status === "aberto" ? "border-l-orange-500" : "border-l-emerald-500"}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-bold">{e.order_number}</span>
                  {e.status === "aberto"
                    ? <Badge className="bg-orange-600 text-white">Em aberto</Badge>
                    : <Badge className="bg-emerald-600 text-white">Resolvido</Badge>}
                </div>
                <div className="text-sm font-medium mt-1">{e.product_description}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Detetado em <strong>{STAGE_LABELS[e.detected_at_stage]}</strong> → enviado para <strong>{STAGE_LABELS[e.sent_to_stage]}</strong>
                  {e.operator_name && ` · por ${e.operator_name} (${e.operator_code})`}
                </div>
                <div className="text-xs mt-1">
                  <span className="font-semibold">Motivo:</span> {e.reason_label ?? "—"}
                  {e.reason_notes && <span className="text-muted-foreground"> · {e.reason_notes}</span>}
                </div>
              </div>
              <div className="text-right text-[11px] text-muted-foreground inline-flex items-center gap-1">
                <Clock className="size-3" />
                {new Date(e.created_at).toLocaleString("pt-PT")}
                {e.resolved_at && (
                  <div className="block text-emerald-700">Resolvido {new Date(e.resolved_at).toLocaleString("pt-PT")}</div>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold ${accent ?? ""}`}>{value}</div>
    </Card>
  );
}

function RankCard({ title, data }: { title: string; data: { label: string; count: number }[] }) {
  const max = Math.max(1, ...data.map(d => d.count));
  return (
    <Card className="p-3">
      <div className="text-sm font-semibold mb-2">{title}</div>
      {data.length === 0 ? (
        <div className="text-xs text-muted-foreground">Sem dados ainda</div>
      ) : (
        <div className="space-y-1">
          {data.slice(0, 6).map((d) => (
            <div key={d.label}>
              <div className="flex justify-between text-xs"><span>{d.label}</span><span className="font-semibold">{d.count}</span></div>
              <div className="h-1.5 bg-muted rounded overflow-hidden">
                <div className="h-full bg-orange-500" style={{ width: `${(d.count / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}:</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-[180px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}