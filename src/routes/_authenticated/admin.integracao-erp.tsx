import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { listModels } from "@/lib/orders.functions";
import {
  getErpIntegrationStatus,
  processErpOutbox,
  setErpWorkerEnabled,
  validateErpMapping,
} from "@/lib/erpIntegration.functions";

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

  const toggleFn = useServerFn(setErpWorkerEnabled);
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => toggleFn({ data: { enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["erp-status"] }),
    onError: (e: any) => toast.error(e?.message ?? "Falha"),
  });
  const [mapping, setMapping] = useState<any | null>(null);

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
          Enviar pendentes (ensaio manual)
        </Button>
        <div className="flex items-center gap-2">
          <Switch
            checked={!!d.settings?.worker_enabled}
            disabled={toggle.isPending || (!d.settings?.worker_enabled && (!d.outboundConfigured || !d.settings?.last_ack_at))}
            onCheckedChange={(v) => toggle.mutate(v)}
          />
          <span className="text-sm">Envio automático {d.settings?.worker_enabled ? "ligado" : "desligado"}</span>
        </div>
        <p className="w-full text-xs text-muted-foreground">
          O envio automático só pode ser ligado por admin depois de um envio manual confirmado pelo ERP.
          {d.settings?.last_run_at ? ` Última execução: ${new Date(d.settings.last_run_at).toLocaleString("pt-PT")} — ${d.settings.last_run_summary ?? ""}` : ""}
        </p>
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
              <tr><th>Venda</th><th>OP</th><th>Unidade</th><th>Produto</th><th>Correspondência</th><th /></tr>
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
                  <td>
                    {l.mapping_status === "por_validar" && (
                      <Button size="sm" variant="outline" onClick={() => setMapping(l)}>Validar</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {mapping && <MappingDialog link={mapping} onClose={() => setMapping(null)} />}
    </div>
  );
}

function MappingDialog({ link, onClose }: { link: any; onClose: () => void }) {
  const qc = useQueryClient();
  const modelsFn = useServerFn(listModels);
  const validateFn = useServerFn(validateErpMapping);
  const { data: models = [] } = useQuery({ queryKey: ["models-active"], queryFn: () => modelsFn() });
  const [modelId, setModelId] = useState("");
  const [structure, setStructure] = useState("");
  const [measure, setMeasure] = useState("");
  const [fabric, setFabric] = useState("");
  const save = useMutation({
    mutationFn: () =>
      validateFn({
        data: {
          product_id: link.product_id,
          model_id: modelId,
          structure_type: structure || null,
          measure: measure || null,
          fabric_ref_tec: fabric.trim().toUpperCase() || null,
          notes: null,
        },
      }),
    onSuccess: (r) => {
      toast.success(`Correspondência validada. ${r.orders_updated} OP(s) atualizada(s).`);
      qc.invalidateQueries({ queryKey: ["erp-status"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha"),
  });
  return (
    <Card className="space-y-3 border-primary p-4">
      <h2 className="font-medium">Validar produto do ERP {link.product_code ?? ""}</h2>
      <p className="whitespace-pre-wrap text-sm">{link.description}</p>
      {link.customization && (
        <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify(link.customization, null, 2)}</pre>
      )}
      <p className="text-xs text-muted-foreground">A descrição e a personalização originais ficam guardadas sem alterações. Aplica-se a todas as OPs deste produto ainda por validar.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>Modelo</Label>
          <select className="w-full rounded border bg-background p-2 text-sm" value={modelId} onChange={(e) => setModelId(e.target.value)}>
            <option value="">— escolher —</option>
            {(models as any[]).map((m) => (
              <option key={m.id} value={m.id}>{m.name} ({m.code})</option>
            ))}
          </select>
        </div>
        <div><Label>Estrutura (opcional)</Label><Input value={structure} onChange={(e) => setStructure(e.target.value)} /></div>
        <div><Label>Medida (opcional)</Label><Input value={measure} onChange={(e) => setMeasure(e.target.value)} /></div>
        <div><Label>Tecido TEC (opcional)</Label><Input value={fabric} onChange={(e) => setFabric(e.target.value)} placeholder="TEC000000" /></div>
      </div>
      <div className="flex gap-2">
        <Button disabled={!modelId || save.isPending} onClick={() => save.mutate()}>Confirmar correspondência</Button>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
      </div>
    </Card>
  );
}
