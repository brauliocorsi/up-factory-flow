import { Card } from "@/components/ui/card";
import { Clock, Factory, CheckCircle2, AlertTriangle } from "lucide-react";

export function StatCards({ stats }: { stats: { pendentes: number; em_producao: number; concluidas_hoje: number; bloqueadas: number } }) {
  const items = [
    { label: "Pendentes", value: stats.pendentes, icon: Clock, color: "text-muted-foreground" },
    { label: "Em produção", value: stats.em_producao, icon: Factory, color: "text-primary" },
    { label: "Concluídas hoje", value: stats.concluidas_hoje, icon: CheckCircle2, color: "text-success" },
    { label: "Bloqueadas", value: stats.bloqueadas, icon: AlertTriangle, color: "text-destructive" },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 px-4 pt-4">
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <Card key={it.label} className="p-4 flex items-center gap-3">
            <div className={`size-10 rounded-lg bg-muted grid place-items-center ${it.color}`}>
              <Icon className="size-5" />
            </div>
            <div>
              <div className="text-2xl font-bold leading-none">{it.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{it.label}</div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}