import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { getErpIntegrationStatus, processErpOutbox } from "@/lib/erpIntegration.functions";

export const Route = createFileRoute("/_authenticated/admin/integracao-erp")({
  head: () => ({
    meta: [
      { title: "Integração ERP — UP Fábrica" },
      { name: "description", content: "Estado da ligação ao ERP UP Móveis Base: encomendas recebidas e eventos enviados." },
      { property: "og:title", content: "Integração ERP — UP Fábrica" },
      { property: "og:description", content: "Encomendas do ERP e fila de eventos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ErpPage,
});

const STATE_LABEL: Record<string, string> = {
  pendente: "Pendente",
  a_enviar: "A enviar",
  entregue: "Entregue (ACK)",
  erro: "Erro",
  incerto: "Incerto — reconciliar",
};

function ErpPage() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const statusFn = useServerFn(getErpIntegrationStatus);
  const sendFn = useServerFn(processErpOutbox);
  const { data, error, isLoading } = useQuery({
    queryKey: ["erp-status"],
    queryFn: () => statusFn(),
    enabled: Boolean(session),
    refetchInterval: 30_000,
  });
  const send = useMutation({
    mutationFn: (event_id?: string) => sendFn({ data: { event_id } }),
    onSuccess: (r) => {
      (r.ok ? toast.success : toast.error)(r.message);
      qc.invalidateQueries({ queryKey: ["erp-status"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha"),
  });

  if (isLoading) return <p className="p-6 text-muted-foreground">A carregar…</p>;
  if (error) return <p className="p-6 text-destructive">{(error as Error).message}</p>;
  const d = data!;
  return (
    <div className="space-y-6 p-4 md:p-6">
      <h1 className="text-2xl font-semibold">Integração ERP (UP Móveis Base)</h1>
      <Card className="flex flex-wrap gap-3 p-4">
        <Badge variant={d.inboundConfigured ? "default" : "secondary"}>
          Receção de encomendas: {d.inboundConfigured ? "configurada" : "desligada"}
        </Badge>
        <Badge variant={d.outboundConfigured ? "default" : "secondary"}>
          Envio de eventos: {d.outboundConfigured ? "configurado" : "desligado"}
        </Badge>
        <Button size="sm" disabled={!d.outboundConfigured || send.isPending} onClick={() => send.mutate(undefined)}>
          Enviar pendentes
        </Button>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 font-medium">Fila de eventos</h2>
        {d.outbox.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem eventos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr><th>OP</th><th>Evento</th><th>Estado</th><th>Tentativas</th><th>Último erro</th><th /></tr>
              </thead>
              <tbody>
                {d.outbox.map((e: any) => (
                  <tr key={e.event_id} className="border-t">
                    <td className="py-1">{e.production_orders?.order_number}</td>
                    <td>{e.event_status === "produced" ? "Produzido" : "Recebido em armazém"}</td>
                    <td>{STATE_LABEL[e.state] ?? e.state}</td>
                    <td>{e.attempts}</td>
                    <td className="max-w-xs truncate text-muted-foreground">{e.last_error ?? ""}</td>
                    <td>
                      {e.state !== "entregue" && (
                        <Button size="sm" variant="outline" disabled={!d.outboundConfigured || send.isPending} onClick={() => send.mutate(e.event_id)}>
                          Reenviar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 font-medium">OPs recebidas do ERP</h2>
        {d.links.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma encomenda recebida.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr><th>Venda</th><th>OP</th><th>Unidade</th><th>Produto</th><th>Correspondência</th></tr>
            </thead>
            <tbody>
              {d.links.map((l: any) => (
                <tr key={l.id} className="border-t">
                  <td className="py-1">{l.sale_number}</td>
                  <td>{l.production_orders?.order_number}</td>
                  <td>{l.unit_index}/{l.line_quantity}</td>
                  <td>{l.product_code ?? "—"}</td>
                  <td>
                    <Badge variant={l.mapping_status === "mapeado" ? "default" : "destructive"}>
                      {l.mapping_status === "mapeado" ? "Mapeado" : "Por validar"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
