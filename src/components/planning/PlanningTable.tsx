import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listPlanningOrders,
  setOrdersPriority,
  deactivateOrders,
  updateOrder,
  type PlanningOrder,
} from "@/lib/orders.functions";
import { EditOrderDialog } from "@/components/orders/EditOrderDialog";
import { OrderActions } from "@/components/orders/OrderActions";
import { useServerFn } from "@tanstack/react-start";
import { activateOrders } from "@/lib/planning.functions";
import { getExpectedForOrders } from "@/lib/sla.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PriorityBadge, priorityRank } from "./PriorityBadge";
import { PrioritySelect } from "./PrioritySelect";
import { STAGE_LABELS, formatDatePT, ORDER_STATUS_LABELS } from "@/lib/format";
import { Search, Zap, Power, PowerOff, SlidersHorizontal, X } from "lucide-react";

type StatusFilter = "all" | "planned" | "pending";

export function PlanningTable({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const fetchPlanning = useServerFn(listPlanningOrders);
  const setPriorityFn = useServerFn(setOrdersPriority);
  const deactivateFn = useServerFn(deactivateOrders);
  const activateFn = useServerFn(activateOrders);
  const updateOrderFn = useServerFn(updateOrder);
  const fetchExpected = useServerFn(getExpectedForOrders);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPriority, setBulkPriority] = useState<number>(2);

  const {
    data: orders,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["planning-orders"],
    queryFn: () => fetchPlanning(),
    refetchInterval: 30_000,
  });

  // Tempo de estofagem por encomenda (tempo do modelo) para o planeamento.
  const orderIds = useMemo(() => (orders ?? []).map((o: PlanningOrder) => o.id), [orders]);
  const { data: expected } = useQuery({
    queryKey: ["planning-estofo-minutes", orderIds],
    queryFn: () =>
      fetchExpected({
        data: { orders: orderIds.map((id) => ({ order_id: id, stage: "estofagem" as const })) },
      }),
    enabled: orderIds.length > 0,
  });
  const estofoMinutes = (id: string) => (expected?.[id]?.estofagem ?? null) as number | null;

  const todayStr = new Date().toLocaleDateString("sv-SE");

  const filtered = useMemo(() => {
    let list = (orders ?? []) as PlanningOrder[];
    if (search.trim()) {
      const s = search.toLowerCase().trim();
      list = list.filter(
        (o) =>
          o.order_number.toLowerCase().includes(s) ||
          (o.customer_order ?? "").toLowerCase().includes(s) ||
          o.product_description.toLowerCase().includes(s),
      );
    }
    if (statusFilter === "planned") list = list.filter((o) => o.is_planned);
    if (statusFilter === "pending") list = list.filter((o) => !o.is_planned);
    if (priorityFilter !== "all") {
      list = list.filter((o) => String(priorityRank(o.priority)) === priorityFilter);
    }
    if (dateFilter === "today") list = list.filter((o) => o.due_date === todayStr);
    if (dateFilter === "overdue")
      list = list.filter((o) => o.due_date !== null && o.due_date < todayStr);
    if (dateFilter === "none") list = list.filter((o) => !o.due_date);
    return list;
  }, [orders, search, statusFilter, priorityFilter, dateFilter, todayStr]);

  const allIds = filtered.map((o) => o.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds));
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["planning-orders"] });
    qc.invalidateQueries({ queryKey: ["orders"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["production"] });
    qc.invalidateQueries({ queryKey: ["urgent-active"] });
    qc.invalidateQueries({ queryKey: ["week-capload"] });
    qc.invalidateQueries({ queryKey: ["day-stage-orders"] });
    VISIBLE_STAGES_FOR_INV.forEach((s) => qc.invalidateQueries({ queryKey: ["stage-queue", s] }));
  }

  const activateMut = useMutation({
    mutationFn: (ids: string[]) => activateFn({ data: { order_ids: ids } }),
    onSuccess: (res: any) => {
      const n = res.activated?.length ?? 0;
      toast.success(`Planeamento: ${n} encomenda(s) ativa(s)`);
      if (res.skipped?.length) toast.warning(`${res.skipped.length} já estavam ativas`);
      if (res.failed?.length) toast.error(`${res.failed.length} falharam`);
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deactivateMut = useMutation({
    mutationFn: (ids: string[]) => deactivateFn({ data: { order_ids: ids } }),
    onSuccess: (res: any) => {
      toast.success(`${res.deactivated} encomenda(s) tirada(s) do planeamento`);
      setSelected(new Set());
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const priorityMut = useMutation({
    mutationFn: (vars: { ids: string[]; priority: number }) =>
      setPriorityFn({ data: { order_ids: vars.ids, priority: vars.priority } }),
    onSuccess: (res: any) => {
      toast.success(`Prioridade atualizada (${res.updated} encomenda(s))`);
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const datesMut = useMutation({
    mutationFn: (vars: { id: string; entry_date?: string; due_date?: string }) =>
      updateOrderFn({ data: vars }),
    onSuccess: () => {
      toast.success("Data atualizada");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const selectedIds = Array.from(selected).filter((id) => allIds.includes(id));

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Plano de produção</h2>
          <p className="text-xs text-muted-foreground">
            {filtered.length} encomendas · {(orders ?? []).filter((o) => o.is_planned).length}{" "}
            planeadas
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {(
            [
              { value: "all", label: "Todas" },
              { value: "planned", label: "Planeadas" },
              { value: "pending", label: "Por planear" },
            ] as const
          ).map((item) => (
            <Button
              key={item.value}
              size="sm"
              variant={statusFilter === item.value ? "secondary" : "ghost"}
              onClick={() => setStatusFilter(item.value)}
              aria-pressed={statusFilter === item.value}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 border-y py-4 sm:grid-cols-3">
        {[
          { label: "No plano", value: (orders ?? []).filter((o) => o.is_planned).length },
          {
            label: "Saídas em atraso",
            value: (orders ?? []).filter((o) => o.due_date && o.due_date < todayStr).length,
          },
          { label: "Sem data de saída", value: (orders ?? []).filter((o) => !o.due_date).length },
        ].map((item) => (
          <div key={item.label}>
            <div className="text-xs text-muted-foreground">{item.label}</div>
            <strong className="mt-1 block text-2xl tabular-nums">
              {isLoading ? "—" : item.value}
            </strong>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-0 basis-60">
          <Search className="absolute left-2.5 top-3 size-4 text-muted-foreground" />
          <Input
            aria-label="Pesquisar plano"
            placeholder="Nº de encomenda ou produto…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-10 bg-card"
          />
        </div>
        <Button
          variant={
            showFilters || priorityFilter !== "all" || dateFilter !== "all"
              ? "secondary"
              : "outline"
          }
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          className="gap-2"
        >
          <SlidersHorizontal className="size-4" /> Filtros
          {Number(priorityFilter !== "all") + Number(dateFilter !== "all") > 0 && (
            <Badge variant="secondary">
              {Number(priorityFilter !== "all") + Number(dateFilter !== "all")}
            </Badge>
          )}
        </Button>
        {(search || priorityFilter !== "all" || dateFilter !== "all") && (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Limpar filtros do plano"
            onClick={() => {
              setSearch("");
              setPriorityFilter("all");
              setDateFilter("all");
            }}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
      {showFilters && (
        <div className="grid gap-3 border-y py-4 sm:grid-cols-2">
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-full" aria-label="Prioridade do plano">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as prioridades</SelectItem>
              <SelectItem value="3">Urgente</SelectItem>
              <SelectItem value="2">Média</SelectItem>
              <SelectItem value="1">Baixa</SelectItem>
            </SelectContent>
          </Select>
          <Select value={dateFilter} onValueChange={setDateFilter}>
            <SelectTrigger className="w-full" aria-label="Saída prevista do plano">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as datas</SelectItem>
              <SelectItem value="today">Saída hoje</SelectItem>
              <SelectItem value="overdue">Saída em atraso</SelectItem>
              <SelectItem value="none">Sem data de saída</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {isError && (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar as encomendas do plano.
        </p>
      )}
      {/* Ações em lote */}
      {canEdit && selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
          <span className="text-xs font-semibold text-muted-foreground">
            {selectedIds.length} selecionada(s):
          </span>
          <Button
            size="sm"
            className="gap-1 h-8"
            disabled={activateMut.isPending}
            onClick={() => activateMut.mutate(selectedIds)}
          >
            <Power className="size-3.5" /> Planear / Ativar
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1 h-8"
            disabled={deactivateMut.isPending}
            onClick={() => deactivateMut.mutate(selectedIds)}
          >
            <PowerOff className="size-3.5" /> Tirar do planeamento
          </Button>
          <span className="text-xs text-muted-foreground mx-1">|</span>
          <span className="text-xs text-muted-foreground">Prioridade lote:</span>
          <PrioritySelect value={bulkPriority} onChange={setBulkPriority} />
          <Button
            size="sm"
            variant="secondary"
            className="gap-1 h-8"
            disabled={priorityMut.isPending}
            onClick={() => priorityMut.mutate({ ids: selectedIds, priority: bulkPriority })}
          >
            <Zap className="size-3.5" /> Aplicar
          </Button>
        </div>
      )}

      {/* Tabela */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <Table className="operation-table planning-table">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  {canEdit && (
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Selecionar tudo"
                    />
                  )}
                </TableHead>
                <TableHead>Nº</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead>Prioridade</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Saída</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((o) => (
                <PlanningRow
                  key={o.id}
                  order={o}
                  estofoMinutes={estofoMinutes(o.id)}
                  canEdit={canEdit}
                  selected={selected.has(o.id)}
                  onToggle={() => toggle(o.id)}
                  onPriorityChange={(p) => priorityMut.mutate({ ids: [o.id], priority: p })}
                  onActivate={() => activateMut.mutate([o.id])}
                  onDeactivate={() => deactivateMut.mutate([o.id])}
                  onDateChange={(field, value) => datesMut.mutate({ id: o.id, [field]: value })}
                  savingDates={datesMut.isPending}
                  pending={
                    priorityMut.isPending || activateMut.isPending || deactivateMut.isPending
                  }
                />
              ))}
              {filtered.length === 0 && !isError && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    {isLoading ? "A carregar o plano…" : "Sem encomendas com estes filtros"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

const VISIBLE_STAGES_FOR_INV = [
  "estrutura",
  "corte",
  "costura",
  "branco",
  "estofagem",
  "qualidade",
  "embalagem",
] as const;

function PlanningRow({
  order,
  estofoMinutes,
  canEdit,
  selected,
  onToggle,
  onPriorityChange,
  onActivate,
  onDeactivate,
  onDateChange,
  savingDates,
  pending,
}: {
  order: PlanningOrder;
  estofoMinutes: number | null;
  canEdit: boolean;
  selected: boolean;
  onToggle: () => void;
  onPriorityChange: (p: number) => void;
  onActivate: () => void;
  onDeactivate: () => void;
  onDateChange: (field: "entry_date" | "due_date", value: string) => void;
  savingDates: boolean;
  pending: boolean;
}) {
  const todayStr = new Date().toLocaleDateString("sv-SE");
  const isOverdue = order.due_date && order.due_date < todayStr && order.is_planned;
  const isToday = order.due_date === todayStr;

  return (
    <TableRow data-state={selected ? "selected" : undefined} className="text-xs">
      <TableCell data-label="Selecionar">
        {canEdit && (
          <Checkbox
            checked={selected}
            onCheckedChange={onToggle}
            aria-label={`Selecionar ${order.order_number}`}
          />
        )}
      </TableCell>
      <TableCell data-label="Encomenda" className="font-mono">
        {order.customer_order ? (
          <div>
            <div className="font-bold">{order.customer_order}</div>
            <div className="text-[10px] text-muted-foreground">{order.order_number}</div>
          </div>
        ) : (
          order.order_number
        )}
      </TableCell>
      <TableCell data-label="Produto" className="min-w-52 max-w-md">
        <div className="whitespace-normal break-words text-sm font-medium">
          {order.product_description}
        </div>
        {(order.measure || order.fabric_type) && (
          <div className="text-[10px] text-muted-foreground">
            {[order.measure, order.fabric_type].filter(Boolean).join(" · ")}
          </div>
        )}
      </TableCell>
      <TableCell data-label="Prioridade">
        {canEdit ? (
          <PrioritySelect value={order.priority} onChange={onPriorityChange} disabled={pending} />
        ) : (
          <PriorityBadge priority={order.priority} />
        )}
      </TableCell>
      <TableCell data-label="Estado">
        {order.is_planned ? (
          <Badge variant={order.has_started ? "secondary" : "success"} className="text-[10px]">
            {order.has_started ? "Em produção" : "Planeado"}
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-[10px]">
            Pendente
          </Badge>
        )}
      </TableCell>
      <TableCell data-label="Saída prevista">
        {canEdit ? (
          <Input
            type="date"
            aria-label={`Saída prevista de ${order.order_number}`}
            className={`h-8 w-36 text-xs ${isOverdue ? "border-destructive text-destructive font-semibold" : isToday ? "border-warning text-warning-foreground font-semibold" : ""}`}
            defaultValue={order.due_date ?? ""}
            disabled={savingDates}
            onChange={(e) => {
              if (e.target.value !== (order.due_date ?? ""))
                onDateChange("due_date", e.target.value);
            }}
          />
        ) : order.due_date ? (
          <span
            className={
              isOverdue
                ? "text-destructive font-semibold"
                : isToday
                  ? "text-warning-foreground font-semibold"
                  : ""
            }
          >
            {formatDatePT(order.due_date)}
          </span>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell data-label="Ações">
        {canEdit && (
          <OrderActions number={order.order_number}>
            <EditOrderDialog orderId={order.id} orderNumber={order.order_number} />
            {!order.is_planned && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-xs text-success hover:bg-success/10"
                onClick={onActivate}
                disabled={pending}
              >
                <Power className="size-3" /> Planear
              </Button>
            )}
            {order.is_planned && !order.has_started && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-xs text-destructive hover:bg-destructive/10"
                onClick={onDeactivate}
                disabled={pending}
              >
                <PowerOff className="size-3" /> Desativar
              </Button>
            )}
            <div className="border-t px-2 py-2 text-xs text-muted-foreground">
              {order.has_started ? "Produção iniciada" : "Sem etapas iniciadas"}
              <div className="mt-1">
                Estofo: {estofoMinutes == null ? "sem tempo definido" : `${estofoMinutes} min`}
              </div>
            </div>
            <div className="border-t px-2 pt-3">
              <div className="mb-1.5 text-xs text-muted-foreground">Data de entrada</div>
              {canEdit ? (
                <Input
                  type="date"
                  className="h-7 w-32 text-xs"
                  defaultValue={order.entry_date ?? ""}
                  disabled={savingDates}
                  onChange={(e) => {
                    if (e.target.value !== (order.entry_date ?? ""))
                      onDateChange("entry_date", e.target.value);
                  }}
                />
              ) : order.entry_date ? (
                formatDatePT(order.entry_date)
              ) : (
                "—"
              )}
            </div>
          </OrderActions>
        )}
      </TableCell>
    </TableRow>
  );
}
