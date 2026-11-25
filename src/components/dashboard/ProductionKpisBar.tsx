import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getProductionKpis } from "@/lib/analytics.functions";
import { Pause, Wrench, Users, Timer } from "lucide-react";
import { hoursLabel } from "@/lib/productionCalculations";

export function ProductionKpisBar() {
  const fetchKpis = useServerFn(getProductionKpis);
  const { data, isError } = useQuery({
    queryKey: ["production-kpis"],
    queryFn: () => fetchKpis(),
    refetchInterval: 20000,
  });
  const items = [
    {
      label: "Operadores ativos",
      value: data?.operadores_ativos,
      icon: Users,
      color: "text-primary",
    },
    { label: "Em pausa", value: data?.pausadas, icon: Pause, color: "text-warning" },
    {
      label: "Retrabalhos abertos",
      value: data?.retrabalhos_abertos,
      icon: Wrench,
      color: "text-destructive",
    },
    {
      label: "Trabalho produtivo hoje",
      value: data ? hoursLabel(data.tempo_produtivo_hoje_min) : undefined,
      icon: Timer,
      color: "text-success",
    },
  ];
  return (
    <section
      aria-label="Indicadores da equipa"
      className="grid grid-cols-2 gap-x-5 gap-y-4 py-1 xl:grid-cols-4"
    >
      {items.map(({ label, value, icon: Icon, color }) => (
        <div key={label} className="flex min-w-0 items-start gap-3">
          <Icon className={`mt-0.5 size-4 shrink-0 ${color}`} />
          <div>
            <div className="text-sm font-semibold tabular-nums">{value ?? "—"}</div>
            <div className="mt-1 text-xs text-muted-foreground">{label}</div>
          </div>
        </div>
      ))}
      {isError && (
        <p role="status" className="col-span-full text-xs text-destructive">
          Indicadores da equipa indisponíveis.
        </p>
      )}
    </section>
  );
}
