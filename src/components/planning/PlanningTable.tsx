import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listPlanningOrders,
  setOrdersPriority,
  deactivateOrders,
  type PlanningOrder,
} from "@/lib/orders.functions";
import { useServerFn } from "@tanstack/react-start";
import { activateOrders } from "@/lib/planning.functions";
import { Card } from "@/components/ui/card";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PriorityBadge, priorityRank } from "./PriorityBadge";
import { PrioritySelect } from "./PrioritySelect";
import { STAGE_LABELS, formatDatePT, ORDER_STATUS_LABELS } from "@/lib/format";
import { Search, Zap, Power, PowerOff } from "lucide-react";

type StatusFilter = "all" | "planned" | "pending";

export function PlanningTable({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const fetchPlanning = useServerFn(listPlanningOrders);
  const setPriorityFn = useServerFn(setOrdersPriority);
  const deactivateFn = useServerFn(deactivateOrders);
  const activateFn = useServerFn(activateOrders);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [todayOnly, setTodayOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPriority, setBulkPriority] = useState<number>(2);

  const { data: orders, isLoading } = useQuery({
    queryKey: ["planning-orders"],
    queryFn: () => fetchPlanning(),
  });

  const todayStr = new Date().toISOString().slice(0, 10);

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
    if (todayOnly) {
      list = list.filter((o) => o.due_date === todayStr);
    }
    return list;
  }, [orders, search, statusFilter, priorityFilter, todayOnly, todayStr]);

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
    VISIBLE_STAGES_FOR_INV.forEach((s) =>
      qc.invalidateQueries({ queryKey: ["stage-queue", s] }),
    );
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

  const selectedIds = Array.from(selected).filter((id) =>
    allIds.includes(id),
  );

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Procurar encomenda, nota ou produto…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="h-9 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="planned">Planeados (ativos)</SelectItem>
            <SelectItem value="pending">Pendentes</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="h-9 w-32 text-xs">
            <SelectValue placeholder="Prioridade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toda prioridade</SelectItem>
            <SelectItem value="3">Urgente</SelectItem>
            <SelectItem value="2">Média</SelectItem>
            <SelectItem value="1">Baixa</SelectItem>
          </SelectContent>
        </Select>
        <button
          onClick={() => setTodayOnly((v) => !v)}
          className={`text-xs font-medium px-2.5 py-1.5 rounded-md border transition ${
            todayOnly ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"
          }`}
        >
          {todayOnly ? "✓ " : ""}Hoje (saída)
        </button>
      </div>

      {/* Ações em lote */}
      {canEdit && selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
          <span className="text-xs font-semibold text-muted-foreground">
            {selectedIds.length} selecionada(s):
          </span>
          <Button
            size="sm"
            className="gap-1 h-8 bg-emerald-600 hover:bg-emerald-700"
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
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  {canEdit && (
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Selecionar tudo" />
                  )}
                </TableHead>
                <TableHead>Nº</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead>Prioridade</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Saída</TableHead>
                <TableHead>Etapa atual</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((o) => (
                <PlanningRow
                  key={o.id}
                  order={o}
                  canEdit={canEdit}
                  selected={selected.has(o.id)}
                  onToggle={() => toggle(o.id)}
                  onPriorityChange={(p) => priorityMut.mutate({ ids: [o.id], priority: p })}
                  onActivate={() => activateMut.mutate([o.id])}
                  onDeactivate={() => deactivateMut.mutate([o.id])}
                  pending={priorityMut.isPending || activateMut.isPending || deactivateMut.isPending}
                />
              ))}
              {filtered.length === 0 && !isLoading && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    Sem encomendas com estes filtros
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

const VISIBLE_STAGES_FOR_INV = [
  "estrutura", "corte", "costura", "branco", "estofagem", "qualidade", "embalagem",
] as const;

function PlanningRow({
  order,
  canEdit,
  selected,
  onToggle,
  onPriorityChange,
  onActivate,
  onDeactivate,
  pending,
}: {
  order: PlanningOrder;
  canEdit: boolean;
  selected: boolean;
  onToggle: () => void;
  onPriorityChange: (p: number) => void;
  onActivate: () => void;
  onDeactivate: () => void;
  pending: boolean;
}) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const isOverdue = order.due_date && order.due_date < todayStr && order.is_planned;
  const isToday = order.due_date === todayStr;

  return (
    <TableRow data-state={selected ? "selected" : undefined} className="text-xs">
      <TableCell>
        {canEdit && (
          <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={`Selecionar ${order.order_number}`} />
        )}
      </TableCell>
      <TableCell className="font-mono">
        {order.customer_order ? (
          <div>
            <div className="font-bold">{order.customer_order}</div>
            <div className="text-[10px] text-muted-foreground">{order.order_number}</div>
          </div>
        ) : (
          order.order_number
        )}
      </TableCell>
      <TableCell className="max-w-40">
        <div className="truncate">{order.product_description}</div>
        {(order.measure || order.fabric_type) && (
          <div className="text-[10px] text-muted-foreground">
            {[order.measure, order.fabric_type].filter(Boolean).join(" · ")}
          </div>
        )}
      </TableCell>
      <TableCell>
        {canEdit ? (
          <PrioritySelect
            value={order.priority}
            onChange={onPriorityChange}
            disabled={pending}
          />
        ) : (
          <PriorityBadge priority={order.priority} />
        )}
      </TableCell>
      <TableCell>
        {order.is_planned ? (
          <Badge className="bg-emerald-600 text-white text-[10px]">Planeado</Badge>
        ) : (
          <Badge variant="secondary" className="text-[10px]">Pendente</Badge>
        )}
      </TableCell>
      <TableCell>
        {order.due_date ? (
          <span className={isOverdue ? "text-red-600 font-semibold" : isToday ? "text-amber-600 font-semibold" : ""}>
            {formatDatePT(order.due_date)}
          </span>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell>
        <span className="text-[10px] text-muted-foreground">
          {order.has_started ? "Produção iniciada" : "Sem etapas iniciadas"}
        </span>
      </TableCell>
      <TableCell>
        {canEdit && (
          <div className="flex gap-1">
            {!order.is_planned && (
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs bg-emerald-50 hover:bg-emerald-100" onClick={onActivate} disabled={pending}>
                <Power className="size-3" /> Planear
              </Button>
            )}
            {order.is_planned && !order.has_started && (
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-destructive hover:bg-destructive/10" onClick={onDeactivate} disabled={pending}>
                <PowerOff className="size-3" /> Desativar
              </Button>
            )}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
