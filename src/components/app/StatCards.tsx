import { Clock, Factory, CheckCircle2, AlertTriangle, Layers } from "lucide-react";

export function StatCards({
  stats,
}: {
  stats: {
    pendentes: number;
    em_producao: number;
    concluidas_hoje: number;
    bloqueadas: number;
    prontas_estofar?: number;
  };
}) {
  const items = [
    { label: "Por iniciar", value: stats.pendentes, icon: Clock, color: "text-muted-foreground" },
    { label: "Em produção", value: stats.em_producao, icon: Factory, color: "text-primary" },
    {
      label: "Prontas para estofar",
      value: stats.prontas_estofar ?? 0,
      icon: Layers,
      color: "text-success",
    },
    {
      label: "Concluídas hoje",
      value: stats.concluidas_hoje,
      icon: CheckCircle2,
      color: "text-success",
    },
    {
      label: "Bloqueadas",
      value: stats.bloqueadas,
      icon: AlertTriangle,
      color: "text-destructive",
    },
  ];
  return (
    <section
      aria-label="Resumo das encomendas"
      className="grid grid-cols-2 gap-y-6 border-y py-6 sm:grid-cols-3 xl:grid-cols-5"
    >
      {items.map(({ label, value, icon: Icon, color }) => (
        <div key={label} className="min-w-0 border-l pl-4 first:border-l-0 first:pl-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Icon className={`size-3.5 shrink-0 ${color}`} />
            <span>{label}</span>
          </div>
          <div className="mt-3 text-3xl font-semibold leading-none tabular-nums">{value}</div>
        </div>
      ))}
    </section>
  );
}
