import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getOperatorEfficiency,
  getOperatorTimeBreakdown,
  listForgottenStages,
  pauseForgottenStage,
} from "@/lib/analytics.functions";
import { Download, BarChart3, AlarmClock, PauseCircle } from "lucide-react";
import { STAGE_LABELS } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin/relatorios")({
  component: RelatoriosPage,
});

function defaultFrom() {
  const d = new Date(); d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}
function defaultTo() { return new Date().toISOString().slice(0, 10); }

function RelatoriosPage() {
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(defaultTo());
  const [search, setSearch] = useState("");
  const fetchFn = useServerFn(getOperatorEfficiency);

  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ["report-operators", from, to],
    queryFn: () => fetchFn({ data: { from: new Date(from).toISOString(), to: new Date(to + "T23:59:59").toISOString() } }),
  });

  const filtered = useMemo(
    () => search.trim()
      ? data.filter((o) => o.operator_name.toLowerCase().includes(search.toLowerCase()) || o.operator_code.toLowerCase().includes(search.toLowerCase()))
      : data,
    [data, search]
  );

  function exportCsv() {
    const header = ["Código", "Nome", "Etapas concluídas", "Min. produtivos", "Min. esperados", "Eficiência %", "Retrabalhos"];
    const lines = [header.join(";")];
    for (const o of filtered) {
      lines.push([o.operator_code, o.operator_name, o.stages_concluidas, o.tempo_produtivo_min, o.tempo_esperado_min, o.eficiencia_pct ?? "", o.retrabalhos].join(";"));
    }
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `relatorio-operadores-${from}-a-${to}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  const totals = useMemo(() => filtered.reduce((acc, o) => ({
    stages: acc.stages + o.stages_concluidas,
    prod: acc.prod + o.tempo_produtivo_min,
    exp: acc.exp + o.tempo_esperado_min,
    rework: acc.rework + o.retrabalhos,
  }), { stages: 0, prod: 0, exp: 0, rework: 0 }), [filtered]);

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="size-6 text-primary" />
        <h1 className="text-2xl font-bold">Relatórios de produção</h1>
      </div>
      <p className="text-sm text-muted-foreground">Desempenho dos operadores no período seleccionado.</p>

      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <Label className="text-xs">De</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Até</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Procurar operador</Label>
            <Input placeholder="Nome ou código" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => refetch()} variant="secondary" className="flex-1">Aplicar</Button>
            <Button onClick={exportCsv} variant="outline" className="gap-2"><Download className="size-4" />CSV</Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Operadores" value={filtered.length} />
        <KPI label="Etapas concluídas" value={totals.stages} />
        <KPI label="Min. produtivos" value={totals.prod} />
        <KPI label="Retrabalhos" value={totals.rework} />
      </div>

      <Card className="p-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b">
            <tr>
              <th className="text-left py-2 px-2">Operador</th>
              <th className="text-right px-2">Etapas</th>
              <th className="text-right px-2">Min. gastos</th>
              <th className="text-right px-2">Min. esperados</th>
              <th className="text-right px-2">Eficiência</th>
              <th className="text-right px-2">Retrab.</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="text-center text-muted-foreground py-6">A carregar…</td></tr>}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center text-muted-foreground py-6">Sem dados no período</td></tr>
            )}
            {filtered.map((o) => (
              <tr key={o.operator_id} className="border-b last:border-0">
                <td className="py-2 px-2">
                  <div className="font-medium">{o.operator_name}</div>
                  <div className="text-[11px] text-muted-foreground">{o.operator_code}</div>
                </td>
                <td className="text-right px-2">{o.stages_concluidas}</td>
                <td className="text-right px-2">{o.tempo_produtivo_min}</td>
                <td className="text-right px-2">{o.tempo_esperado_min || "—"}</td>
                <td className="text-right px-2">
                  {o.eficiencia_pct == null ? <span className="text-muted-foreground">—</span> : (
                    <Badge className={o.eficiencia_pct >= 100 ? "bg-emerald-600 text-white" : o.eficiencia_pct >= 75 ? "bg-amber-500 text-white" : "bg-destructive text-destructive-foreground"}>
                      {o.eficiencia_pct}%
                    </Badge>
                  )}
                </td>
                <td className="text-right px-2">{o.retrabalhos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <TimeBreakdownCard from={from} to={to} />
      <ForgottenStagesCard />
    </div>
  );
}

function TimeBreakdownCard({ from, to }: { from: string; to: string }) {
  const fetchFn = useServerFn(getOperatorTimeBreakdown);
  const { data = [], isLoading } = useQuery({
    queryKey: ["report-time-breakdown", from, to],
    queryFn: () => fetchFn({ data: { from: new Date(from).toISOString(), to: new Date(to + "T23:59:59").toISOString() } }),
  });

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h2 className="font-semibold">Tempo por pessoa</h2>
        <p className="text-xs text-muted-foreground">
          Duração do processo (do início ao fim), tempo a trabalhar e tempo de espera, por volume concluído. Encomendas de teste ficam de fora.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b">
            <tr>
              <th className="text-left py-2 px-2">Operador</th>
              <th className="text-right px-2">Volumes</th>
              <th className="text-right px-2">Processo (min)</th>
              <th className="text-right px-2">A trabalhar (min)</th>
              <th className="text-right px-2">Espera (min)</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="text-center text-muted-foreground py-6">A carregar…</td></tr>}
            {!isLoading && data.length === 0 && (
              <tr><td colSpan={5} className="text-center text-muted-foreground py-6">Sem dados no período</td></tr>
            )}
            {data.map((o) => (
              <tr key={o.operator_id} className="border-b last:border-0">
                <td className="py-2 px-2">
                  <div className="font-medium">{o.operator_name}</div>
                  <div className="text-[11px] text-muted-foreground">{o.operator_code}</div>
                </td>
                <td className="text-right px-2">{o.operacoes}</td>
                <td className="text-right px-2">{o.processo_min}</td>
                <td className="text-right px-2">{o.mao_de_obra_min}</td>
                <td className="text-right px-2">{o.espera_min}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ForgottenStagesCard() {
  const [minHours, setMinHours] = useState(12);
  const listFn = useServerFn(listForgottenStages);
  const pauseFn = useServerFn(pauseForgottenStage);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["forgotten-stages", minHours],
    queryFn: () => listFn({ data: { min_hours: minHours } }),
  });

  const pause = useMutation({
    mutationFn: (id: string) => pauseFn({ data: { order_coli_stage_id: id, reason: "Operação esquecida em curso" } }),
    onSuccess: (r: any) => {
      if (r?.ok === false) { toast.error(r.message); return; }
      toast.success(r?.message ?? "Operação em pausa");
      refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao pausar"),
  });

  const items = data && data.ok ? data.items : [];
  const errorMsg = data && !data.ok ? data.message : null;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlarmClock className="size-5 text-amber-500" />
          <div>
            <h2 className="font-semibold">Operações esquecidas em curso</h2>
            <p className="text-xs text-muted-foreground">A decorrer sem pausa há demasiado tempo — corrigir para não falsear os tempos.</p>
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label className="text-xs">Mais de (horas)</Label>
            <Input
              type="number"
              min={1}
              max={720}
              className="w-24"
              value={minHours}
              onChange={(e) => setMinHours(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <Button variant="secondary" onClick={() => refetch()} disabled={isFetching}>Atualizar</Button>
        </div>
      </div>

      {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
      {isLoading && <p className="text-sm text-muted-foreground">A carregar…</p>}
      {!isLoading && !errorMsg && items.length === 0 && (
        <p className="text-sm text-muted-foreground">Nada esquecido. Tudo em ordem.</p>
      )}

      <div className="space-y-2">
        {items.map((it) => (
          <div key={it.order_coli_stage_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2">
            <div className="min-w-0">
              <div className="font-medium flex items-center gap-2">
                <Link to="/producao" search={{ q: it.order_number } as any} className="hover:underline">
                  {it.order_number}
                </Link>
                <Badge variant="outline">Volume {it.coli_number} de {it.total_colis}</Badge>
                <Badge variant="secondary">{STAGE_LABELS[it.stage] ?? it.stage}</Badge>
                {it.is_test && <Badge className="bg-slate-500 text-white">Teste</Badge>}
              </div>
              <div className="text-xs text-muted-foreground">
                {it.operator_name ? `${it.operator_name} (${it.operator_code})` : "Sem operador"} · há {it.hours_running}h
              </div>
            </div>
            <Button size="sm" variant="outline" className="gap-2" disabled={pause.isPending} onClick={() => pause.mutate(it.order_coli_stage_id)}>
              <PauseCircle className="size-4" /> Pausar por correção
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function KPI({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-3">
      <div className="text-2xl font-bold leading-none">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </Card>
  );
}