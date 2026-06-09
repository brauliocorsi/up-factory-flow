import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { listOrders, listModels, previewCancelOrder, cancelOrder, type CancelPreview } from "@/lib/orders.functions";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { STAGE_LABELS, ORDER_STATUS_LABELS, formatDatePT } from "@/lib/format";
import { Search, Plus, Upload, Printer, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";

export const Route = createFileRoute("/_authenticated/encomendas/")({
  component: EncomendasPage,
});

function EncomendasPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [modelId, setModelId] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cancelTarget, setCancelTarget] = useState<{ id: string; order_number: string } | null>(null);
  const [cancelPreview, setCancelPreview] = useState<CancelPreview | null>(null);

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

  const orderList = orders ?? [];
  const allIds = useMemo(() => orderList.map((o) => o.id), [orderList]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds));
  }
  function printSelected() {
    if (!selected.size) return;
    navigate({ to: "/etiquetas/imprimir", search: { ids: Array.from(selected).join(",") } });
  }
  function printOne(id: string) {
    navigate({ to: "/etiquetas/imprimir", search: { ids: id } });
  }

  async function openCancel(id: string, order_number: string) {
    setCancelTarget({ id, order_number });
    setCancelPreview(null);
    try {
      const p = await previewCancelOrder({ data: { id } });
      setCancelPreview(p);
    } catch (e: any) {
      toast.error(e.message);
      setCancelTarget(null);
    }
  }

  const doCancel = useMutation({
    mutationFn: (id: string) => cancelOrder({ data: { id } }),
    onSuccess: () => {
      toast.success("Encomenda cancelada");
      setCancelTarget(null);
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["shells"] });
      qc.invalidateQueries({ queryKey: ["covers"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Encomendas</h1>
          <p className="text-sm text-muted-foreground">Lista completa de encomendas em produção</p>
        </div>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <Button size="sm" onClick={printSelected} variant="default" className="gap-2">
              <Printer className="size-4" /> Imprimir etiquetas ({selected.size})
            </Button>
          )}
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link to="/importar"><Upload className="size-4" /> Importar</Link>
          </Button>
          <Button asChild size="sm" className="gap-2">
            <Link to="/encomendas/nova"><Plus className="size-4" /> Nova encomenda</Link>
          </Button>
        </div>
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
                <TableHead className="w-10">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Selecionar tudo" />
                </TableHead>
                <TableHead>Nº</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead>Medida</TableHead>
                <TableHead>Tecido</TableHead>
                <TableHead>Entrada</TableHead>
                <TableHead>Saída</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Etapa atual</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orderList.map((o) => (
                <TableRow key={o.id} data-state={selected.has(o.id) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(o.id)}
                      onCheckedChange={() => toggle(o.id)}
                      aria-label={`Selecionar ${o.order_number}`}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{o.order_number}</TableCell>
                  <TableCell>{o.product_description}</TableCell>
                  <TableCell>{o.model_name ?? "—"}</TableCell>
                  <TableCell>{o.measure ?? "—"}</TableCell>
                  <TableCell>{o.fabric_type ?? "—"}</TableCell>
                  <TableCell>{formatDatePT(o.entry_date)}</TableCell>
                  <TableCell>{formatDatePT(o.due_date)}</TableCell>
                  <TableCell><Badge variant="secondary">{ORDER_STATUS_LABELS[o.status]}</Badge></TableCell>
                  <TableCell><Badge>{STAGE_LABELS[o.current_stage]}</Badge></TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" className="gap-1 h-8" onClick={() => printOne(o.id)}>
                      <Printer className="size-3" /> Etiqueta
                    </Button>
                    {o.status !== "cancelada" && (
                      <Button size="sm" variant="ghost" className="gap-1 h-8 text-destructive" onClick={() => openCancel(o.id, o.order_number)}>
                        <XCircle className="size-3" /> Cancelar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {orderList.length === 0 && (
                <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">Sem encomendas</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      <div className="md:hidden space-y-2">
        {orderList.map((o) => (
          <Card key={o.id} className={`p-3 space-y-2 ${selected.has(o.id) ? "ring-2 ring-primary" : ""}`}>
            <div className="flex items-start gap-2">
              <Checkbox
                checked={selected.has(o.id)}
                onCheckedChange={() => toggle(o.id)}
                className="mt-1"
                aria-label={`Selecionar ${o.order_number}`}
              />
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center justify-between gap-2">
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
                  <Badge>{STAGE_LABELS[o.current_stage]}</Badge>
                  <Button size="sm" variant="ghost" className="gap-1 h-8" onClick={() => printOne(o.id)}>
                    <Printer className="size-3" /> Etiqueta
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        ))}
        {orderList.length === 0 && <div className="text-center text-sm text-muted-foreground py-8">Sem encomendas</div>}
      </div>

      <Dialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancelar encomenda {cancelTarget?.order_number}?</DialogTitle></DialogHeader>
          {!cancelPreview ? (
            <div className="text-sm text-muted-foreground py-4">A analisar impacto no stock…</div>
          ) : (
            <div className="space-y-2 text-sm">
              {cancelPreview.shell_reserved_to_release && (
                <div>🔓 Reserva do casco <b>{cancelPreview.shell_code}</b> será libertada.</div>
              )}
              {cancelPreview.cover_reserved_to_release && (
                <div>🔓 Reserva da capa <b>{cancelPreview.cover_code}</b> será libertada.</div>
              )}
              {cancelPreview.shell_to_return_to_stock && (
                <div>📦 Casco <b>{cancelPreview.shell_code ?? "(novo)"}</b> volta ao stock (+1).</div>
              )}
              {cancelPreview.cover_to_return_to_stock && (
                <div>📦 Capa <b>{cancelPreview.cover_code ?? "(nova)"}</b> volta ao stock (+1).</div>
              )}
              {!cancelPreview.shell_reserved_to_release && !cancelPreview.cover_reserved_to_release &&
               !cancelPreview.shell_to_return_to_stock && !cancelPreview.cover_to_return_to_stock && (
                <div className="text-muted-foreground">Nenhum impacto no stock. As etapas em curso serão anuladas.</div>
              )}
              <div className="text-xs text-muted-foreground pt-2">Etapas ainda não concluídas serão marcadas como anuladas.</div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>Voltar</Button>
            <Button
              variant="destructive"
              disabled={!cancelPreview || doCancel.isPending}
              onClick={() => cancelTarget && doCancel.mutate(cancelTarget.id)}
            >
              {doCancel.isPending ? "A cancelar…" : "Confirmar cancelamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}