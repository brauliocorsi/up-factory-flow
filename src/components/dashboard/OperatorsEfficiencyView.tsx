import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, TrendingDown, UserCircle2 } from "lucide-react";
import { getOperatorEfficiency, type OperatorEfficiency } from "@/lib/analytics.functions";
import type { ReactNode } from "react";

export function OperatorsEfficiencyView() {
  const fetchFn = useServerFn(getOperatorEfficiency);
  const { data = [], isLoading } = useQuery({
    queryKey: ["operators-efficiency", "30d"],
    queryFn: () => fetchFn({ data: {} }),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground p-6 text-center">A carregar…</div>;

  const withEff = data.filter((o) => o.eficiencia_pct != null);
  const top = withEff.slice(0, 3);
  const bottom = [...withEff].reverse().slice(0, 3);

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground">Últimos 30 dias · Eficiência = tempo esperado ÷ tempo gasto. ≥100% melhor que o esperado.</div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RankCard
          title="Top 3 — Melhor desempenho"
          icon={<Trophy className="size-4 text-emerald-600" />}
          rows={top}
          empty="Sem dados suficientes"
          variant="top"
        />
        <RankCard
          title="Pior desempenho"
          icon={<TrendingDown className="size-4 text-destructive" />}
          rows={bottom}
          empty="Sem dados suficientes"
          variant="bottom"
        />
      </div>

      <Card className="p-3">
        <div className="text-sm font-semibold mb-2">Todos os operadores</div>
        <div className="overflow-x-auto">
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
              {data.length === 0 && (
                <tr><td colSpan={6} className="text-center text-muted-foreground py-6">Sem dados</td></tr>
              )}
              {data.map((o) => (
                <tr key={o.operator_id} className="border-b last:border-0">
                  <td className="py-2 px-2">
                    <div className="font-medium">{o.operator_name}</div>
                    <div className="text-[11px] text-muted-foreground">{o.operator_code}</div>
                  </td>
                  <td className="text-right px-2">{o.stages_concluidas}</td>
                  <td className="text-right px-2">{o.tempo_produtivo_min}</td>
                  <td className="text-right px-2">{o.tempo_esperado_min || "—"}</td>
                  <td className="text-right px-2">{renderEff(o.eficiencia_pct)}</td>
                  <td className="text-right px-2">{o.retrabalhos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function renderEff(pct: number | null) {
  if (pct == null) return <span className="text-muted-foreground">—</span>;
  const cls = pct >= 100 ? "bg-emerald-600 text-white" : pct >= 75 ? "bg-amber-500 text-white" : "bg-destructive text-destructive-foreground";
  return <Badge className={cls}>{pct}%</Badge>;
}

function RankCard({ title, icon, rows, empty, variant }: {
  title: string; icon: ReactNode; rows: OperatorEfficiency[]; empty: string; variant: "top" | "bottom";
}) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 mb-2">{icon}<div className="text-sm font-semibold">{title}</div></div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground py-4 text-center">{empty}</div>
      ) : (
        <ol className="space-y-2">
          {rows.map((r, idx) => (
            <li key={r.operator_id} className="flex items-center gap-3 p-2 rounded-md border">
              <div className={`size-8 rounded-full grid place-items-center text-sm font-bold ${
                variant === "top"
                  ? idx === 0 ? "bg-amber-400 text-amber-950" : idx === 1 ? "bg-slate-300 text-slate-900" : "bg-orange-300 text-orange-950"
                  : "bg-destructive/10 text-destructive"
              }`}>{idx + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate flex items-center gap-1.5">
                  <UserCircle2 className="size-4 text-muted-foreground" />
                  {r.operator_name}
                </div>
                <div className="text-[11px] text-muted-foreground">{r.stages_concluidas} etapas · {r.tempo_produtivo_min}m</div>
              </div>
              {renderEff(r.eficiencia_pct)}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}