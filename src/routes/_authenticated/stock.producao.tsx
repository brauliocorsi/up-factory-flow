import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { completeStockProduction } from "@/lib/stock.functions";

const listStockProductions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("production_orders")
      .select("id, order_number, product_description, status, stock_item_type, stock_quantity, created_at")
      .eq("is_stock_production", true)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const Route = createFileRoute("/_authenticated/stock/producao")({
  component: StockProductionPage,
});

function StockProductionPage() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ["stock-prod"], queryFn: () => listStockProductions() });
  const complete = useMutation({
    mutationFn: (id: string) => completeStockProduction({ data: { order_id: id } }),
    onSuccess: () => {
      toast.success("Stock atualizado");
      qc.invalidateQueries({ queryKey: ["stock-prod"] });
      qc.invalidateQueries({ queryKey: ["shells"] });
      qc.invalidateQueries({ queryKey: ["covers"] });
      qc.invalidateQueries({ queryKey: ["stock", "overview"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Produção para stock</h1>
        <p className="text-sm text-muted-foreground">Ordens sem encomenda de cliente. Concluir dá entrada no stock.</p>
      </div>
      <Card className="p-2 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ordem</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="text-right">Qtd.</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">A carregar…</TableCell></TableRow>}
            {!isLoading && rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Sem produções de stock</TableCell></TableRow>
            )}
            {rows.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.order_number}</TableCell>
                <TableCell><Badge variant="secondary">{r.stock_item_type === "shell" ? "Casco" : "Capa"}</Badge></TableCell>
                <TableCell className="text-sm">{r.product_description}</TableCell>
                <TableCell className="text-right font-semibold">{r.stock_quantity}</TableCell>
                <TableCell><Badge variant={r.status === "concluida" ? "outline" : "default"}>{r.status}</Badge></TableCell>
                <TableCell className="text-right">
                  {r.status !== "concluida" && (
                    <Button size="sm" onClick={() => complete.mutate(r.id)} disabled={complete.isPending}>
                      Concluir e dar entrada
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}