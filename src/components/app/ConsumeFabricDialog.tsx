import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Scissors } from "lucide-react";
import {
  consumeFabric,
  getFabricConsumeContext,
  listFabricAvailability,
  undoFabricConsumption,
} from "@/lib/stock.functions";
import { FabricPicker, FabricStockNotice } from "@/components/fabric/fabricUi";

/**
 * Baixa de tecido na etapa de Corte, por tecido completo (fabric_catalog).
 * O tecido da OF (fabric_ref_tec) vem pré-selecionado.
 */
export function ConsumeFabricDialog({
  orderId,
  orderNumber,
  operatorCode,
  canUndo = false,
  compact = false,
}: {
  orderId: string;
  orderNumber: string;
  operatorCode?: string;
  canUndo?: boolean;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [refTec, setRefTec] = useState("");
  const [meters, setMeters] = useState("");

  const ctxQuery = useQuery({
    queryKey: ["fabric-consume-ctx", orderId],
    queryFn: () => getFabricConsumeContext({ data: { order_id: orderId } }),
    enabled: open,
  });
  const fabricsQuery = useQuery({
    queryKey: ["fabric-availability"],
    queryFn: () => listFabricAvailability(),
    enabled: open,
  });
  const ctx = ctxQuery.data as any;
  const fabrics = fabricsQuery.data ?? [];

  useEffect(() => {
    if (!ctx?.ok) return;
    setRefTec((p) => p || (ctx.suggested_ref_tec ?? ""));
    setMeters((p) => p || (ctx.meters_per_unit != null ? String(ctx.meters_per_unit) : ""));
  }, [ctx]);

  const consumption = ctx?.consumption ?? null;
  const fabric = fabrics.find((f) => f.ref_tec === refTec) ?? null;
  const needed = Number(meters || 0);
  const insufficient = Boolean(fabric && needed > 0 && fabric.meters < needed);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["fabric-consumptions"] });
    qc.invalidateQueries({ queryKey: ["fabric-consume-ctx", orderId] });
    qc.invalidateQueries({ queryKey: ["fabric-availability"] });
  };

  const consume = useMutation({
    mutationFn: () =>
      consumeFabric({
        data: { order_id: orderId, ref_tec: refTec, meters: needed, ...(operatorCode ? { operator_code: operatorCode } : {}) },
      }),
    onSuccess: (res: any) => {
      if (!res?.ok) {
        // Mensagem tal como a base de dados a devolve (ex.: stock insuficiente).
        toast.error(res?.message ?? "Não foi possível consumir o tecido.");
        refresh();
        return;
      }
      toast.success(`Consumidos ${needed.toFixed(1)} m — restam ${Number(res.remaining).toFixed(1)} m`);
      setOpen(false);
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao consumir tecido"),
  });

  const undo = useMutation({
    mutationFn: () => undoFabricConsumption({ data: { order_id: orderId } }),
    onSuccess: (res: any) => {
      if (!res?.ok) return toast.error(res?.message ?? "Não foi possível anular.");
      toast.success("Consumo anulado — metros devolvidos ao stock");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao anular consumo"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {compact ? (
          <Button size="sm" variant="outline" className="gap-1 shrink-0">
            <Scissors className="size-3.5" /> Tecido
          </Button>
        ) : (
          <Button size="lg" variant="outline" className="gap-2 h-12 flex-1 sm:flex-none">
            <Scissors className="size-4" /> Consumir tecido
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Consumir tecido — {orderNumber}</DialogTitle>
        </DialogHeader>

        {(ctxQuery.isLoading || fabricsQuery.isLoading) && (
          <div className="text-sm text-muted-foreground py-6">A carregar…</div>
        )}
        {ctx && ctx.ok === false && <div className="text-sm text-destructive py-4">{ctx.message}</div>}

        {ctx?.ok && consumption && (
          <div className="space-y-3 py-2">
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              Tecido já consumido: <span className="font-semibold">{Number(consumption.meters).toFixed(1)} m</span>{" "}
              <Badge variant="secondary" className="ml-1 text-xs">
                {consumption.fabric_name ?? consumption.ref_tec ?? consumption.fabric_ref_code ?? "—"}
              </Badge>
            </div>
            {canUndo && (
              <Button
                variant="destructive"
                disabled={undo.isPending}
                onClick={() => {
                  if (confirm("Anular o consumo e devolver os metros ao stock?")) undo.mutate();
                }}
              >
                Anular consumo
              </Button>
            )}
          </div>
        )}

        {ctx?.ok && !consumption && ctx.reverted_consumption && (
          <div className="rounded-md border border-warning bg-warning/10 p-3 text-xs">
            Esta OF já teve um consumo anulado. Hoje só é permitido um registo de consumo por OF, por isso uma nova baixa
            vai ser recusada — fala com o escritório.
          </div>
        )}

        {ctx?.ok && !consumption && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Tecido</Label>
              <FabricPicker fabrics={fabrics} value={refTec} onChange={setRefTec} />
              {!ctx.suggested_ref_tec && (
                <p className="text-xs text-muted-foreground">A OF não tem tecido definido — escolha na lista.</p>
              )}
              <FabricStockNotice fabric={fabric} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Metros a consumir (do modelo)</Label>
              <Input type="number" min={0} step="0.1" value={meters} onChange={(e) => setMeters(e.target.value)} className="h-11" />
              {ctx.meters_per_unit == null && (
                <p className="text-xs text-destructive">
                  O modelo {ctx.model?.code ?? ""} não tem metros por unidade definidos (Catálogo &gt; Modelos).
                </p>
              )}
              {insufficient && (
                <p className="text-xs text-destructive">
                  Só existem {fabric!.meters.toFixed(1)} m deste tecido.
                </p>
              )}
            </div>
          </div>
        )}

        {ctx?.ok && !consumption && (
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button disabled={!refTec || needed <= 0 || consume.isPending} onClick={() => consume.mutate()}>
              Consumir {needed > 0 ? `${needed.toFixed(1)} m` : ""}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
