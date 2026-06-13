import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserCircle2, Pause, Play } from "lucide-react";
import { getActiveByOperator } from "@/lib/analytics.functions";
import { STAGE_LABELS, timeAgo } from "@/lib/format";

export function OperatorsActiveView() {
  const fetchFn = useServerFn(getActiveByOperator);
  const { data = [], isLoading } = useQuery({
    queryKey: ["operators-active"],
    queryFn: () => fetchFn(),
    refetchInterval: 15000,
  });

  if (isLoading) return <div className="text-sm text-muted-foreground p-6 text-center">A carregar…</div>;
  if (data.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        Nenhum operador a trabalhar neste momento.
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {data.map((op) => (
        <Card key={op.operator_id} className="p-3 space-y-3">
          <div className="flex items-center gap-2 border-b pb-2">
            <div className="size-9 rounded-full bg-primary/10 text-primary grid place-items-center">
              <UserCircle2 className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm leading-tight truncate">{op.operator_name}</div>
              <div className="text-[11px] text-muted-foreground">Código {op.operator_code}</div>
            </div>
            <Badge variant="secondary">{op.items.length}</Badge>
          </div>
          <div className="space-y-2">
            {op.items.map((it) => (
              <div key={it.order_stage_id} className={`rounded-md border p-2 ${it.is_paused ? "bg-amber-50 border-amber-200" : "bg-emerald-50/50 border-emerald-200"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold">{it.order_number}</span>
                  <Badge variant="outline" className="text-[10px]">{STAGE_LABELS[it.stage] ?? it.stage}</Badge>
                </div>
                <div className="text-xs mt-1 line-clamp-2">{it.product_description}</div>
                <div className="flex items-center justify-between mt-1.5 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    {it.is_paused ? <Pause className="size-3 text-amber-600" /> : <Play className="size-3 text-emerald-600" />}
                    {it.is_paused ? "Em pausa" : "A produzir"}
                  </span>
                  <span>{it.started_at ? timeAgo(it.started_at) : "—"}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}