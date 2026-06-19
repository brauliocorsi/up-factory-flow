import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyPickedOrders } from "@/lib/picking.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, History, PackageCheck } from "lucide-react";
import { useMySession } from "@/hooks/useMySession";

export const Route = createFileRoute("/_authenticated/picagem/historico")({
  component: HistoricoPage,
});

function HistoricoPage() {
  const { role, operator } = useMySession();
  const fn = useServerFn(listMyPickedOrders);
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["my-picked-orders"],
    queryFn: () => fn({ data: { limit: 200 } }),
    refetchInterval: 30_000,
  });

  const today = new Date().toISOString().slice(0, 10);
  const todayCount = data.filter((r) => (r.finished_at ?? "").slice(0, 10) === today).length;

  return (
    <div className="container mx-auto p-4 max-w-5xl space-y-6">
      <div className="border-b pb-4">
        <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2"><History className="size-7 text-primary" /> O que piquei</h1>
        <p className="text-sm text-muted-foreground">
          {role === "admin" ? "Todas as encomendas concluídas na picagem." : operator?.name ? `Histórico de ${operator.name}.` : "Histórico do picador."}
        </p>
      </div>

      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-6 flex items-center gap-4">
          <PackageCheck className="size-10 text-primary" />
          <div>
            <p className="text-3xl font-extrabold">{todayCount}</p>
            <p className="text-xs uppercase text-muted-foreground">encomendas picadas hoje</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Últimas {data.length}</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <p className="text-sm text-destructive">{(error as any).message}</p>
          ) : data.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Ainda sem encomendas picadas.</p>
          ) : (
            <div className="divide-y">
              {data.map((r) => (
                <div key={r.order_id + (r.finished_at ?? "")} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold">{r.order_number}</span>
                      <span className="text-xs text-muted-foreground">{r.coli_count} colis</span>
                    </div>
                    <p className="text-sm truncate">{r.product_description}</p>
                    <p className="text-xs text-muted-foreground">{r.structure_type} · {r.measure} · {r.color}</p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground shrink-0">
                    <div>{r.finished_at ? new Date(r.finished_at).toLocaleString("pt-PT") : "—"}</div>
                    {role === "admin" && r.operator_name && <div className="mt-1">{r.operator_name}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
