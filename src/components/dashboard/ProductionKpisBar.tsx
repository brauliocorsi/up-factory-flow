import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { getProductionKpis } from "@/lib/analytics.functions";
import { Factory, Pause, AlertTriangle, CheckCircle2, Wrench, UserCircle2, Timer } from "lucide-react";

export function ProductionKpisBar() {
  const fetchKpis = useServerFn(getProductionKpis);
  const { data } = useQuery({ queryKey: ["production-kpis"], queryFn: () => fetchKpis(), refetchInterval: 20000 });
  const items = [
    { label: "Em produção", value: data?.em_producao ?? 0, icon: Factory, color: "text-primary" },
    { label: "Em pausa", value: data?.pausadas ?? 0, icon: Pause, color: "text-amber-600" },
    { label: "Bloqueadas", value: data?.bloqueadas ?? 0, icon: AlertTriangle, color: "text-destructive" },
    { label: "Concluídas hoje", value: data?.concluidas_hoje ?? 0, icon: CheckCircle2, color: "text-emerald-600" },
    { label: "Retrabalhos", value: data?.retrabalhos_abertos ?? 0, icon: Wrench, color: "text-orange-600" },
    { label: "Operadores ativos", value: data?.operadores_ativos ?? 0, icon: UserCircle2, color: "text-sky-600" },
    { label: "Min. produtivos hoje", value: data?.tempo_produtivo_hoje_min ?? 0, icon: Timer, color: "text-violet-600" },
  ];
  return (
    <div className="px-4 pt-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <Card key={it.label} className="p-3 flex items-center gap-2">
              <Icon className={`size-4 ${it.color}`} />
              <div className="min-w-0">
                <div className="text-lg font-bold leading-none">{it.value}</div>
                <div className="text-[10px] text-muted-foreground mt-1 truncate">{it.label}</div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}