import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { timeAgo } from "@/lib/format";
import type { DashboardOrder } from "@/lib/orders.functions";
import { Clock, AlertTriangle, Flame } from "lucide-react";

export function OrderCard({ order }: { order: DashboardOrder }) {
  const overdue = order.due_date && new Date(order.due_date) < new Date();
  const blocked = order.current_stage_status === "bloqueada";

  return (
    <Card className={`p-3 space-y-2 border-l-4 ${blocked ? "border-l-destructive bg-destructive/5" : overdue ? "border-l-destructive" : order.priority > 0 ? "border-l-warning" : "border-l-primary"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="font-mono text-xs font-bold text-muted-foreground">{order.order_number}</div>
        {order.priority > 0 && <Flame className="size-3.5 text-warning" />}
        {blocked && <AlertTriangle className="size-3.5 text-destructive" />}
      </div>
      <div className="text-sm font-medium leading-tight">{order.product_description}</div>
      {order.model_name && <Badge variant="secondary" className="text-[10px]">{order.model_name}</Badge>}
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground pt-1">
        <Clock className="size-3" />
        {order.stage_started_at ? `${timeAgo(order.stage_started_at)} nesta etapa` : "Por iniciar"}
      </div>
      {overdue && <div className="text-[11px] font-medium text-destructive">Atrasada</div>}
    </Card>
  );
}