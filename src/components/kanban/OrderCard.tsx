import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { timeAgo, formatDatePT, STAGE_STATUS_LABELS } from "@/lib/format";
import type { DashboardOrder } from "@/lib/orders.functions";
import { Clock, AlertTriangle, Flame, ChevronDown, Check } from "lucide-react";
import { ConvergenceStatus } from "./ConvergenceStatus";
const CONVERGENCE_STAGES = new Set(["corte", "costura", "estrutura", "branco", "estofagem"]);

export function OrderCard({ order }: { order: DashboardOrder }) {
  const [expanded, setExpanded] = useState(false);
  const overdue = order.due_date && new Date(order.due_date) < new Date();
  const blocked = order.current_stage_status === "bloqueada";
  const fromStock = Boolean(order.has_stock_completed);
  const state = STAGE_STATUS_LABELS[order.current_stage_status] ?? order.current_stage_status;
  const ready = order.lines?.tecido.ready && order.lines?.estrutura.ready;
  return (
    <Card
      className="gap-0 rounded-lg border bg-card p-4 shadow-none transition-shadow hover:shadow-soft"
      data-order-id={order.id}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-muted-foreground">
          {order.customer_order ?? order.order_number}
        </span>
        <div className="flex items-center gap-1.5">
          {order.priority > 0 && (
            <Flame className="size-3.5 text-warning" aria-label="Prioritária" />
          )}
          <span
            className={`size-1.5 rounded-full ${blocked ? "bg-destructive" : order.current_stage_status === "em_curso" ? "bg-success" : "bg-muted-foreground/50"}`}
            title={state}
          />
        </div>
      </div>
      <h4 className="mt-3 break-words text-sm font-semibold leading-relaxed">
        {order.product_description}
      </h4>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {order.is_stock_production && (
          <Badge variant="outline" className="text-[10px]">
            Stock
          </Badge>
        )}
        {fromStock && (
          <Badge variant="success" className="text-[10px]">
            De stock
          </Badge>
        )}
        <span>{state}</span>
        {blocked && (
          <span className="inline-flex items-center gap-1 text-destructive">
            <AlertTriangle className="size-3" />
            Bloqueada
          </span>
        )}
        {overdue && <span className="text-destructive">Em atraso</span>}
        {ready && CONVERGENCE_STAGES.has(order.current_stage) && (
          <span className="inline-flex items-center gap-1 text-success">
            <Check className="size-3" />
            Pronta para estofar
          </span>
        )}
      </div>
      {order.observation && (
        <div className="mt-3 flex items-start gap-1.5 border-l-2 border-warning pl-2 text-xs leading-relaxed">
          <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" />
          <span className="break-words">{order.observation}</span>
        </div>
      )}
      <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3">
        <div className="min-w-0 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <Clock className="size-3 shrink-0" />
            {order.stage_started_at ? timeAgo(order.stage_started_at) : "Por iniciar"}
          </div>
          {order.due_date && <div className="mt-1">Saída {formatDatePT(order.due_date)}</div>}
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 shrink-0"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={`order-details-${order.id}`}
          aria-label={`Detalhes de ${order.order_number}`}
          title="Detalhes da encomenda"
        >
          <ChevronDown className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </Button>
      </div>
      {expanded && (
        <div id={`order-details-${order.id}`} className="mt-3 space-y-3 border-t pt-3">
          <dl className="grid grid-cols-2 gap-3 text-xs">
            {[
              ["Encomenda", order.order_number],
              ["Modelo", order.model_name],
              ["Medida", order.measure],
              ["Tecido", order.fabric_type],
              ["Estrutura", order.structure_type],
            ]
              .filter(([, v]) => v)
              .map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[10px] text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-words">{value}</dd>
                </div>
              ))}
          </dl>
          {order.lines && CONVERGENCE_STAGES.has(order.current_stage) && (
            <ConvergenceStatus
              lines={order.lines}
              variant={order.current_stage === "estofagem" ? "full" : "compact"}
              highlightWhenReady={order.current_stage === "estofagem"}
            />
          )}
        </div>
      )}
    </Card>
  );
}
