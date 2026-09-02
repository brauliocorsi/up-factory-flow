import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { PackageCheck, Send, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listFinishedGoods, transferToExternalSystem } from "@/lib/finishedGoods.functions";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";

export const Route = createFileRoute("/_authenticated/stock/produto-final")({
  component: ProdutoFinalPage,
});

function ProdutoFinalPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listFinishedGoods);
  const transferFn = useServerFn(transferToExternalSystem);
  const [status, setStatus] = useState<"em_stock"|"transferido"|"todos">("em_stock");

  const { data: rows } = useQuery({
    queryKey: ["finished-goods", status],
    queryFn: () => listFn({ data: { status } }),
  });
  useRealtimeOrders([["finished-goods"]], { tables: ["finished_goods", "production_orders", "stock_movements"] });

  const mut = useMutation({
    mutationFn: (id: string) => transferFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Marcado como transferido");
      qc.invalidateQueries({ queryKey: ["finished-goods"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  const inStock = (rows ?? []).filter((r) => r.status === "em_stock").length;
  const transferred = (rows ?? []).filter((r) => r.status === "transferido").length;

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-3">
        <PackageCheck className="size-6 text-primary" />
        <h1 className="text-2xl font-bold">Stock de Produto Final</h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Em stock</div><div className="text-2xl font-bold text-emerald-600">{inStock}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Transferidos</div><div className="text-2xl font-bold">{transferred}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Total visível</div><div className="text-2xl font-bold">{rows?.length ?? 0}</div></Card>
      </div>

      <Card className="p-3 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Estado:</span>
        <Select value={status} onValueChange={(v) => setStatus(v as any)}>
          <SelectTrigger className="w-[180px] h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="em_stock">Em stock</SelectItem>
            <SelectItem value="transferido">Transferidos</SelectItem>
            <SelectItem value="todos">Todos</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-[11px] text-muted-foreground ml-auto">
          Integração com sistema externo: a definir (botão "Transferir" marca manualmente).
        </span>
      </Card>

      <div className="space-y-2">
        {(rows ?? []).length === 0 ? (
          <div className="text-center text-muted-foreground py-12 border border-dashed rounded-md">
            Sem produtos para este filtro
          </div>
        ) : (rows ?? []).map((r) => (
          <Card key={r.id} className={`p-3 border-l-4 ${r.status === "em_stock" ? "border-l-emerald-500" : "border-l-muted"}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-bold">{r.order_number ?? "—"}</span>
                  {r.status === "em_stock"
                    ? <Badge className="bg-emerald-600 text-white">Em stock</Badge>
                    : <Badge variant="secondary">Transferido</Badge>}
                  {r.ready_for_transfer && r.status === "em_stock" && (
                    <Badge variant="outline" className="text-primary border-primary">Pronto para transferir</Badge>
                  )}
                </div>
                <div className="text-sm font-medium mt-1">{r.product_description ?? r.product_code ?? "—"}</div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  {r.barcode && <span>Código de barras: <span className="font-mono">{r.barcode}</span> · </span>}
                  Embalado {new Date(r.created_at).toLocaleString("pt-PT")}
                  {r.transferred_at && <> · Transferido {new Date(r.transferred_at).toLocaleString("pt-PT")}</>}
                </div>
              </div>
              {r.status === "em_stock" && (
                <Button size="sm" disabled={mut.isPending} onClick={() => mut.mutate(r.id)} className="gap-1">
                  <Send className="size-4" /> Marcar como transferido
                </Button>
              )}
              {r.status === "transferido" && (
                <span className="text-xs text-emerald-700 inline-flex items-center gap-1">
                  <CheckCircle2 className="size-4" /> Transferido
                </span>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
