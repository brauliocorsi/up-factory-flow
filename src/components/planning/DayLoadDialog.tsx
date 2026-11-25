import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hoursLabel } from "@/lib/productionCalculations";
import { PowerOff } from "lucide-react";
import { STAGE_LABELS, formatDatePT } from "@/lib/format";
import { getDayStageOrders, type Stage } from "@/lib/planning.functions";
import { updateOrder, deactivateOrders } from "@/lib/orders.functions";

/**
 * Detalhe de um dia numa operação: encomendas previstas, minutos de cada uma
 * e total, com a possibilidade de mover a data de saída ou tirar do planeamento
 * até o dia caber no tempo disponível.
 */
export function DayLoadDialog({
  stage,
  date,
  capacityMinutes,
  canEdit,
  open,
  onOpenChange,
}: {
  stage: Stage;
  date: string;
  capacityMinutes: number;
  canEdit: boolean;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const fetchDay = useServerFn(getDayStageOrders);
  const updateOrderFn = useServerFn(updateOrder);
  const deactivateFn = useServerFn(deactivateOrders);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["day-stage-orders", stage, date],
    queryFn: () => fetchDay({ data: { stage, date } }),
    enabled: open,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["day-stage-orders"] });
    qc.invalidateQueries({ queryKey: ["week-capload"] });
    qc.invalidateQueries({ queryKey: ["stage-capload"] });
    qc.invalidateQueries({ queryKey: ["planning-orders"] });
    qc.invalidateQueries({ queryKey: ["orders"] });
    qc.invalidateQueries({ queryKey: ["stage-queue"] });
  }

  const dueMut = useMutation({
    mutationFn: (v: { id: string; due_date: string }) => updateOrderFn({ data: v }),
    onSuccess: () => {
      toast.success("Data de saída atualizada");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro a guardar"),
  });

  const offMut = useMutation({
    mutationFn: (id: string) => deactivateFn({ data: { order_ids: [id] } }),
    onSuccess: () => {
      toast.success("Tirada do planeamento");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível tirar do planeamento"),
  });

  const total = rows.reduce((a, r) => a + (r.expected_minutes ?? 0), 0);
  const unknown = rows.filter((r) => r.expected_minutes == null).length;
  const over = total - capacityMinutes;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {STAGE_LABELS[stage]} — {formatDatePT(date)}
          </DialogTitle>
          <DialogDescription>
            {hoursLabel(total)} necessárias de {hoursLabel(capacityMinutes)} disponíveis
            {capacityMinutes > 0 && (
              <>
                {" · "}
                {over > 0 ? (
                  <span className="text-destructive font-semibold">excede {hoursLabel(over)}</span>
                ) : (
                  <span className="text-success font-semibold">
                    sobram {hoursLabel(Math.abs(over))}
                  </span>
                )}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {unknown > 0 && (
          <div className="rounded-md border border-warning/30 bg-warning/10 text-foreground px-3 py-2 text-xs">
            ⚠ {unknown} produto(s) sem tempo definido no modelo — o total está subestimado.
          </div>
        )}

        <div className="max-h-[55vh] overflow-y-auto divide-y">
          {isLoading && (
            <p className="py-6 text-center text-sm text-muted-foreground">A carregar…</p>
          )}
          {!isLoading && rows.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nada previsto neste dia.
            </p>
          )}
          {rows.map((r) => (
            <div key={r.order_id} className="py-2 flex flex-wrap items-center gap-2 text-xs">
              <div className="min-w-40 flex-1">
                <div className="font-mono font-semibold">{r.customer_order ?? r.order_number}</div>
                <div className="text-muted-foreground break-words">
                  {[r.product_description, r.measure].filter(Boolean).join(" · ")}
                </div>
              </div>
              {r.expected_minutes != null ? (
                <Badge variant="secondary" className="tabular-nums">
                  {hoursLabel(r.expected_minutes)}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-warning-foreground border-warning/30">
                  sem tempo
                </Badge>
              )}
              {r.overdue && <Badge variant="danger">atrasada</Badge>}
              <Badge variant="outline">
                {r.order_status === "pendente" ? "Pendente" : "Ativa"}
              </Badge>
              {canEdit ? (
                <Input
                  type="date"
                  aria-label={`Saída da encomenda ${r.order_number}`}
                  className="h-8 w-36 text-xs"
                  defaultValue={r.due_date ?? ""}
                  disabled={dueMut.isPending}
                  onChange={(e) => {
                    if (e.target.value && e.target.value !== (r.due_date ?? "")) {
                      dueMut.mutate({ id: r.order_id, due_date: e.target.value });
                    }
                  }}
                />
              ) : (
                <span className="w-32 text-muted-foreground">
                  {r.due_date ? formatDatePT(r.due_date) : "—"}
                </span>
              )}
              {canEdit && r.order_status !== "pendente" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-xs text-destructive hover:bg-destructive/10"
                  disabled={offMut.isPending}
                  onClick={() => offMut.mutate(r.order_id)}
                >
                  <PowerOff className="size-3" /> Tirar
                </Button>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
