import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { timeAgo } from "@/lib/format";
import type { DashboardOrder } from "@/lib/orders.functions";
import { Clock, AlertTriangle, Flame } from "lucide-react";
import { ConvergenceStatus } from "./ConvergenceStatus";

const CONVERGENCE_STAGES = new Set(["corte", "costura", "estrutura", "branco", "estofagem"]);

export function OrderCard({ order }: { order: DashboardOrder }) {
  const overdue = order.due_date && new Date(order.due_date) < new Date();
  const blocked = order.current_stage_status === "bloqueada";
  const fromStock = Boolean(order.has_stock_completed);

  return (
    <Card className={`p-3 space-y-2 border-l-4 ${blocked ? "border-l-destructive bg-destructive/5" : overdue ? "border-l-destructive" : order.priority > 0 ? "border-l-warning" : "border-l-primary"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="font-mono text-xs font-bold text-muted-foreground">{order.order_number}</div>
        <div className="flex items-center gap-1">
          {order.is_stock_production && <Badge className="text-[9px] px-1.5 py-0 h-4 bg-accent text-accent-foreground">STOCK</Badge>}
          {fromStock && <Badge className="text-[9px] px-1.5 py-0 h-4 bg-emerald-600 text-white">✓ DE STOCK</Badge>}
          {order.priority > 0 && <Flame className="size-3.5 text-warning" />}
          {blocked && <AlertTriangle className="size-3.5 text-destructive" />}
        </div>
      </div>
      <div className="text-sm font-medium leading-tight">{order.product_description}</div>
      {order.model_name && <Badge variant="secondary" className="text-[10px]">{order.model_name}</Badge>}
      {order.observation && (
        <div className="text-[11px] font-semibold bg-warning/15 text-warning-foreground border border-warning/40 rounded px-1.5 py-0.5 flex items-start gap-1">
          <AlertTriangle className="size-3 mt-0.5 shrink-0 text-warning" />
          <span className="leading-tight">{order.observation}</span>
        </div>
      )}
      {order.lines && CONVERGENCE_STAGES.has(order.current_stage) && (
        <ConvergenceStatus
          lines={order.lines}
          variant={order.current_stage === "estofagem" ? "full" : "compact"}
          highlightWhenReady={order.current_stage === "estofagem"}
        />
      )}
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground pt-1">
        <Clock className="size-3" />
        {order.stage_started_at ? `${timeAgo(order.stage_started_at)} nesta etapa` : "Por iniciar"}
      </div>
      {overdue && <div className="text-[11px] font-medium text-destructive">Atrasada</div>}
    </Card>
  );
}