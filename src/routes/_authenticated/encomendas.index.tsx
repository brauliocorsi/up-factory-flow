import { needsNormalization } from "@/lib/laminates";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { listOrders, listModels, previewCancelOrder, cancelOrder, type OrderListItem, type CancelPreview } from "@/lib/orders.functions";
import { PlanningWorkspace } from "@/components/planning/PlanningWorkspace";
import { PlanningPanel } from "@/components/planning/PlanningPanel";
import { useMySession } from "@/hooks/useMySession";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { STAGE_LABELS, ORDER_STATUS_LABELS, formatDatePT } from "@/lib/format";
import { Search, Plus, Upload, Printer, XCircle, List, CalendarDays, History, SlidersHorizontal, ChevronDown, Eye, Package, X, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";
import { QualityCheckDialog } from "@/components/quality/QualityCheckDialog";
import { EditOrderDialog } from "@/components/orders/EditOrderDialog";
import { BulkOrderActions } from "@/components/orders/BulkOrderActions";
import { OrderActions } from "@/components/orders/OrderActions";
import { filterOrderList } from "@/lib/orderListFilters";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";


export const Route = createFileRoute("/_authenticated/encomendas/")({
  head: () => ({ meta: [
    { title: "Encomendas e planeamento | UP Fábrica" },
    { name: "description", content: "Encomendas da UP Fábrica: produção, planeamento, datas e histórico." },
    { property: "og:title", content: "Encomendas e planeamento | UP Fábrica" },
    { property: "og:description", content: "Acompanhe as encomendas, o planeamento e as saídas da fábrica." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: EncomendasPage,
});

function EncomendasPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { operator, role } = useMySession();
  const opCode = operator?.code ?? "";
  const canEditPlanning = role === "admin" || role === "escritorio";
  const [tab, setTab] = useState<"lista" | "planeamento" | "por-data" | "historico">("lista");
  const [histSearch, setHistSearch] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [modelId, setModelId] = useState<string>("all");
  const [stage, setStage] = useState("all");
  const [date, setDate] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [detail, setDetail] = useState<OrderListItem | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cancelTarget, setCancelTarget] = useState<{ id: string; order_number: string } | null>(null);
  const [cancelPreview, setCancelPreview] = useState<CancelPreview | null>(null);

  const filters = modelId === "all" ? {} : { modelId };
  const { data: orders, isLoading, isError } = useQuery({
    queryKey: ["orders", filters], queryFn: () => listOrders({ data: filters }),
  });
  const { data: history, isLoading: historyLoading, isError: historyError } = useQuery({
    queryKey: ["orders", "historico"],
    queryFn: () => listOrders({ data: { only_completed: true } }),
    enabled: tab === "historico",
  });
  const { data: models } = useQuery({ queryKey: ["models"], queryFn: () => listModels() });

  useRealtimeOrders([["orders"], ["dashboard"]]);


  const today = new Date().toLocaleDateString("sv-SE");
  const orderList = filterOrderList(orders ?? [], { search, status, stage, date }, today);
  const historyList = filterOrderList(history ?? [], { search: histSearch, status: "all", stage: "all", date: "all" }, today);
  const filterCount = Number(modelId !== "all") + Number(stage !== "all") + Number(date !== "all");
  function resetFilters() { setSearch(""); setStatus("all"); setModelId("all"); setStage("all"); setDate("all"); }
  function actions(o: OrderListItem, historical = false) {
    return <OrderActions number={o.order_number}>
      <Button variant="ghost" onClick={() => setDetail(o)}><Eye className="size-4" /> Ver detalhes</Button>
      <Button variant="ghost" onClick={() => printOne(o.id)}><Printer className="size-4" /> Imprimir etiqueta</Button>
      {!historical && canEditPlanning && o.status !== "cancelada" && <EditOrderDialog orderId={o.id} orderNumber={o.order_number} />}
      {!historical && <QualityCheckDialog orderId={o.id} orderNumber={o.order_number} productDescription={o.product_description} operatorCode={opCode} />}
      {!historical && o.status !== "cancelada" && <Button variant="ghost" className="text-destructive" onClick={() => openCancel(o.id, o.order_number)}><XCircle className="size-4" /> Cancelar encomenda</Button>}
    </OrderActions>;
  }
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
    <div className="mx-auto w-full max-w-[1600px] min-w-0 space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-lg border bg-card text-primary"><Package className="size-5" /></div>
          <div><h1 className="text-2xl font-bold">Encomendas</h1><p className="text-xs text-muted-foreground">Produção · Planeamento · Armazém</p></div>
        </div>
        <div className="flex items-center gap-2">
          {canEditPlanning && <Button asChild variant="outline" size="icon" aria-label="Cálculo de produção" title="Cálculo de produção"><Link to="/planeamento/calculo"><Calculator className="size-4" /></Link></Button>}
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" className="gap-2"><Upload className="size-4" /><span>Importar</span><ChevronDown className="size-3" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem asChild><Link to="/encomendas/importar-produtos"><Upload /> Excel por produto</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link to="/importar"><Upload /> Lista de produção</Link></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button asChild className="gap-2"><Link to="/encomendas/nova"><Plus className="size-4" /> Nova encomenda</Link></Button>
        </div>
      </header>
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-lg bg-muted/60 p-1 sm:flex sm:w-fit">
          <TabsTrigger className="gap-2 px-4 py-2.5" value="lista"><List className="size-4" /> Em operação</TabsTrigger>
          <TabsTrigger className="gap-2 px-4 py-2.5" value="planeamento"><SlidersHorizontal className="size-4" /> Planeamento</TabsTrigger>
          <TabsTrigger className="gap-2 px-4 py-2.5" value="por-data"><CalendarDays className="size-4" /> Por data</TabsTrigger>
          <TabsTrigger className="gap-2 px-4 py-2.5" value="historico"><History className="size-4" /> Histórico</TabsTrigger>
        </TabsList>
        <TabsContent value="lista" className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-60"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input aria-label="Pesquisar encomendas" placeholder="Nº de encomenda ou produto…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 bg-card pl-9" /></div>
            <Button variant={showFilters || filterCount ? "secondary" : "outline"} className="gap-2" onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}><SlidersHorizontal className="size-4" /> Filtros {filterCount > 0 && <Badge variant="secondary">{filterCount}</Badge>}</Button>
            {(search || status !== "all" || filterCount > 0) && <Button variant="ghost" size="icon" title="Limpar filtros" aria-label="Limpar filtros" onClick={resetFilters}><X className="size-4" /></Button>}
          </div>
          <div className="flex flex-wrap gap-2">
            {[{ value: "all", label: "Todas" }, { value: "pendente", label: "Por iniciar" }, { value: "em_producao", label: "Em produção" }, { value: "concluida", label: "Na picagem" }, { value: "cancelada", label: "Canceladas" }].map((item) => <Button key={item.value} size="sm" variant={status === item.value ? "default" : "ghost"} aria-pressed={status === item.value} onClick={() => setStatus(item.value)} className="gap-2 rounded-md">{item.label}<span className="text-xs tabular-nums opacity-70">{(orders ?? []).filter((o) => item.value === "all" || o.status === item.value).length}</span></Button>)}
          </div>
          {showFilters && <div className="grid gap-3 border-y py-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5"><span className="text-xs text-muted-foreground">Estado</span><Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full bg-card"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os estados</SelectItem>{Object.entries(ORDER_STATUS_LABELS).filter(([v]) => v !== "em_armazem").map(([v, l]) => <SelectItem key={v} value={v}>{v === "concluida" ? "Na picagem" : l}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><span className="text-xs text-muted-foreground">Modelo</span><Select value={modelId} onValueChange={setModelId}><SelectTrigger className="w-full bg-card"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os modelos</SelectItem>{(models ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><span className="text-xs text-muted-foreground">Etapa</span><Select value={stage} onValueChange={setStage}><SelectTrigger className="w-full bg-card"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas as etapas</SelectItem>{Object.entries(STAGE_LABELS).map(([v,l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><span className="text-xs text-muted-foreground">Saída prevista</span><Select value={date} onValueChange={setDate}><SelectTrigger className="w-full bg-card"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas as datas</SelectItem><SelectItem value="today">Hoje</SelectItem><SelectItem value="overdue">Em atraso</SelectItem><SelectItem value="none">Sem data</SelectItem></SelectContent></Select></div>
          </div>}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{orderList.length} encomendas</span>{selected.size > 0 && <div className="flex items-center gap-2"><span>{selected.size} selecionadas</span><Button variant="outline" size="sm" onClick={printSelected}><Printer className="size-4 mr-2" /> Etiquetas</Button><Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Limpar seleção</Button></div>}</div>
          <BulkOrderActions ids={Array.from(selected)} canEdit={canEditPlanning} isAdmin={role === "admin"} onDone={() => setSelected(new Set())} />
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="hidden grid-cols-[28px_120px_minmax(0,1fr)_150px_110px_44px] items-center gap-4 border-b bg-muted/40 px-4 py-3 text-xs font-medium text-muted-foreground lg:grid"><Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Selecionar tudo" /><span>Encomenda</span><span>Produto</span><span>Estado / etapa</span><span>Saída prevista</span><span /></div>
            <div className="divide-y">{orderList.map((o) => <div key={o.id} className={`grid grid-cols-[24px_minmax(0,1fr)_44px] items-start gap-x-3 gap-y-2 px-4 py-4 lg:grid-cols-[28px_120px_minmax(0,1fr)_150px_110px_44px] lg:items-center lg:gap-4 ${selected.has(o.id) ? "bg-accent/50" : "hover:bg-muted/20"}`}>
              <Checkbox className="mt-1 lg:mt-0" checked={selected.has(o.id)} onCheckedChange={() => toggle(o.id)} aria-label={`Selecionar ${o.order_number}`} />
              <div className="min-w-0"><div className="font-mono text-sm font-semibold">{o.customer_order ?? o.order_number}</div>{o.customer_order && <div className="mt-1 text-xs text-muted-foreground">{o.order_number}</div>}</div>
              <div className="col-start-2 min-w-0 lg:col-start-auto"><div className="break-words text-sm font-semibold leading-relaxed">{o.product_description}</div><div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">{[o.model_name, o.measure, o.fabric_type].filter(Boolean).join(" · ")}</div>{o.line_kind === "livre" ? <Badge variant="outline" className="mt-2 text-[10px]">Linha livre</Badge> : !o.gc_code ? <Badge variant="warning" className="mt-2 text-[10px]">Sem código GC</Badge> : needsNormalization(o.gc_code) ? <Badge variant="warning" className="mt-2 text-[10px]">Código por normalizar</Badge> : null}</div>
              <div className="col-start-2 space-y-1 lg:col-start-auto"><OrderStateBadge order={o} /><div className="text-xs text-muted-foreground">{STAGE_LABELS[o.current_stage]}</div></div>
              <div className="col-start-2 text-xs lg:col-start-auto"><span className="text-muted-foreground lg:hidden">Saída: </span><span className={o.due_date && o.due_date.slice(0,10) < today && o.status !== "cancelada" ? "font-medium text-destructive" : ""}>{formatDatePT(o.due_date)}</span></div>
              <div className="col-start-3 row-start-1 lg:col-start-auto lg:row-start-auto">{actions(o)}</div>
            </div>)}</div>
            {(isLoading || isError || orderList.length === 0) && <div className="py-14 text-center text-sm text-muted-foreground">{isLoading ? "A carregar encomendas…" : isError ? "Não foi possível carregar as encomendas." : "Sem encomendas com estes filtros"}</div>}
          </div>
        </TabsContent>
        <TabsContent value="planeamento" className="mt-6">{canEditPlanning ? <PlanningWorkspace canEdit /> : <div className="border-y py-12 text-center text-sm text-muted-foreground">O planeamento está disponível para admin e escritório.</div>}</TabsContent>
        <TabsContent value="por-data" className="mt-6">{canEditPlanning ? <PlanningPanel canEdit /> : <div className="border-y py-12 text-center text-sm text-muted-foreground">A vista por data está disponível para admin e escritório.</div>}</TabsContent>
        <TabsContent value="historico" className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold">Recebidas no armazém</h2><div className="text-xs text-muted-foreground">{historyList.length} encomendas</div></div><div className="relative w-full sm:w-80"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input aria-label="Pesquisar histórico" placeholder="Nº de encomenda ou produto…" value={histSearch} onChange={(e) => setHistSearch(e.target.value)} className="h-10 bg-card pl-9" /></div></div>
          <div className="divide-y overflow-hidden rounded-lg border bg-card">{historyList.map((o) => <div key={o.id} className="flex items-start gap-3 p-4 sm:items-center"><div className="min-w-0 flex-1 sm:grid sm:grid-cols-[120px_minmax(0,1fr)_150px] sm:items-center sm:gap-4"><div className="font-mono text-xs font-semibold">{o.customer_order ?? o.order_number}{o.customer_order && <div className="mt-1 text-[10px] font-normal text-muted-foreground">{o.order_number}</div>}</div><div className="my-2 break-words text-sm font-medium sm:my-0">{o.product_description}<div className="mt-1 text-xs font-normal text-muted-foreground">{[o.model_name, o.measure, o.fabric_type].filter(Boolean).join(" · ")}</div></div><div><Badge variant="success">Em armazém</Badge><div className="mt-1 text-xs text-muted-foreground">{formatDatePT(o.picked_at ?? o.completed_at)}</div></div></div>{actions(o, true)}</div>)}{(historyLoading || historyError || historyList.length === 0) && <div className="py-14 text-center text-sm text-muted-foreground">{historyLoading ? "A carregar histórico…" : historyError ? "Não foi possível carregar o histórico." : "Sem encomendas no histórico"}</div>}</div>
        </TabsContent>
      </Tabs>
      <Dialog open={Boolean(detail)} onOpenChange={(open) => { if (!open) setDetail(null); }}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Encomenda {detail?.order_number}</DialogTitle></DialogHeader>{detail && <div className="space-y-5"><p className="break-words font-semibold">{detail.product_description}</p><OrderStateBadge order={detail} /><dl className="grid grid-cols-2 gap-4 text-sm">{[["Encomenda cliente", detail.customer_order], ["Modelo", detail.model_name], ["Medida", detail.measure], ["Tecido", detail.fabric_type], ["Entrada", formatDatePT(detail.entry_date)], ["Saída prevista", formatDatePT(detail.due_date)], ["Etapa", STAGE_LABELS[detail.current_stage]], ["Código", detail.gc_code], ["Embalagem concluída", formatDatePT(detail.completed_at)], ["Picagem concluída", formatDatePT(detail.picked_at)]].map(([label, value]) => <div key={label}><dt className="mb-1 text-xs text-muted-foreground">{label}</dt><dd className="break-all">{value || "—"}</dd></div>)}</dl></div>}</DialogContent></Dialog>
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

function OrderStateBadge({ order }: { order: { status: string; picking_state: "aguarda_picagem" | "em_picagem" | "pronta_armazem" | null } }) {
  if (order.picking_state === "aguarda_picagem") return <Badge variant="warning">A aguardar picagem</Badge>;
  if (order.picking_state === "em_picagem") return <Badge variant="secondary">Em picagem</Badge>;
  if (order.picking_state === "pronta_armazem") return <Badge>Pronta para armazém</Badge>;
  return <Badge variant={order.status === "em_producao" ? "info" : order.status === "cancelada" ? "danger" : "secondary"}>{ORDER_STATUS_LABELS[order.status] ?? order.status}</Badge>;
}