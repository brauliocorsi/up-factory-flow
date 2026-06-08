import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listOrders, listModels } from "@/lib/orders.functions";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STAGE_LABELS, ORDER_STATUS_LABELS, formatDatePT } from "@/lib/format";
import { Search } from "lucide-react";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";

export const Route = createFileRoute("/_authenticated/encomendas")({
  component: EncomendasPage,
});

function EncomendasPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [modelId, setModelId] = useState<string>("all");

  const filters = {
    search: search || undefined,
    status: status === "all" ? undefined : status,
    modelId: modelId === "all" ? undefined : modelId,
  };

  const { data: orders } = useQuery({
    queryKey: ["orders", filters],
    queryFn: () => listOrders({ data: filters }),
  });
  const { data: models } = useQuery({ queryKey: ["models"], queryFn: () => listModels() });

  useRealtimeOrders([["orders"], ["dashboard"]]);

  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Encomendas</h1>
        <p className="text-sm text-muted-foreground">Lista completa de encomendas em produção</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="relative md:col-span-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="Procurar nº encomenda…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-11" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-11"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os estados</SelectItem>
            {Object.entries(ORDER_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={modelId} onValueChange={setModelId}>
          <SelectTrigger className="h-11"><SelectValue placeholder="Modelo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os modelos</SelectItem>
            {(models ?? []).map((m: any) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="hidden md:block">
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead>Medida</TableHead>
                <TableHead>Tecido</TableHead>
                <TableHead>Entrada</TableHead>
                <TableHead>Saída</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Etapa atual</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(orders ?? []).map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-xs">{o.order_number}</TableCell>
                  <TableCell>{o.product_description}</TableCell>
                  <TableCell>{o.model_name ?? "—"}</TableCell>
                  <TableCell>{o.measure ?? "—"}</TableCell>
                  <TableCell>{o.fabric_type ?? "—"}</TableCell>
                  <TableCell>{formatDatePT(o.entry_date)}</TableCell>
                  <TableCell>{formatDatePT(o.due_date)}</TableCell>
                  <TableCell><Badge variant="secondary">{ORDER_STATUS_LABELS[o.status]}</Badge></TableCell>
                  <TableCell><Badge>{STAGE_LABELS[o.current_stage]}</Badge></TableCell>
                </TableRow>
              ))}
              {(orders ?? []).length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Sem encomendas</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      <div className="md:hidden space-y-2">
        {(orders ?? []).map((o) => (
          <Card key={o.id} className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-muted-foreground">{o.order_number}</span>
              <Badge variant="secondary">{ORDER_STATUS_LABELS[o.status]}</Badge>
            </div>
            <div className="text-sm font-medium">{o.product_description}</div>
            <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
              {o.model_name && <span>{o.model_name}</span>}
              {o.measure && <span>· {o.measure}</span>}
              {o.fabric_type && <span>· {o.fabric_type}</span>}
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-muted-foreground">Entrada {formatDatePT(o.entry_date)}</span>
              <Badge>{STAGE_LABELS[o.current_stage]}</Badge>
            </div>
          </Card>
        ))}
        {(orders ?? []).length === 0 && <div className="text-center text-sm text-muted-foreground py-8">Sem encomendas</div>}
      </div>
    </div>
  );
}