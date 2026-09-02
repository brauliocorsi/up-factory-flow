import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Play, Pause, Check, ChevronDown, ChevronUp, Boxes, Clock, UserCircle2, Filter } from "lucide-react";
import {
  listShellNeeds, listActiveBatches,
  startShellBatch, recordShellBatchEvent, finalizeShellBatch,
  type ShellNeed, type ActiveBatch,
} from "@/lib/shellBatches.functions";
import { listOperatorsWithStages, getAppSettings } from "@/lib/production.functions";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";

export const Route = createFileRoute("/_authenticated/producao/cascos")({
  component: CascosBulkPage,
});

function fmtTime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2,"0")}m`;
  if (m > 0) return `${m}m ${String(r).padStart(2,"0")}s`;
  return `${r}s`;
}

function CascosBulkPage() {
  const qc = useQueryClient();
  const fetchNeeds = useServerFn(listShellNeeds);
  const fetchBatches = useServerFn(listActiveBatches);
  const fetchOps = useServerFn(listOperatorsWithStages);
  const fetchSettings = useServerFn(getAppSettings);
  const startFn = useServerFn(startShellBatch);
  const eventFn = useServerFn(recordShellBatchEvent);
  const finalizeFn = useServerFn(finalizeShellBatch);

  const { data: needs = [] } = useQuery({ queryKey: ["shell-needs"], queryFn: () => fetchNeeds(), refetchInterval: 30000 });
  const { data: batches = [] } = useQuery({ queryKey: ["shell-batches-active"], queryFn: () => fetchBatches(), refetchInterval: 5000 });
  const { data: operators } = useQuery({ queryKey: ["operators-stages"], queryFn: () => fetchOps() });
  const { data: settings } = useQuery({ queryKey: ["app-settings"], queryFn: () => fetchSettings() });

  useRealtimeOrders([["shell-needs"], ["shell-batches-active"], ["production"], ["dashboard"]], {
    tables: ["shell_batches", "shell_batch_logs", "shells", "production_orders", "order_stages"],
  });

  const [operatorCode, setOperatorCode] = useState<string>(() =>
    (typeof window !== "undefined" && sessionStorage.getItem("op_code")) || ""
  );
  useEffect(() => { if (operatorCode) sessionStorage.setItem("op_code", operatorCode); }, [operatorCode]);

  const [filterCode, setFilterCode] = useState("");
  const [sortBy, setSortBy] = useState<"need" | "urgency">("need");
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 1000); return () => clearInterval(t); }, []);

  const currentOp = useMemo(
    () => (operators ?? []).find(o => o.code === operatorCode.trim()),
    [operators, operatorCode]
  );
  const canProduceShells = !!currentOp && (currentOp.stages.includes("estrutura") || currentOp.stages.includes("branco"));

  const filtered = useMemo(() => {
    let list = needs.filter(n => n.net_need > 0);
    if (filterCode.trim()) {
      const q = filterCode.trim().toLowerCase();
      list = list.filter(n => n.shell_code.toLowerCase().includes(q) || n.shell_name.toLowerCase().includes(q));
    }
    if (sortBy === "urgency") {
      list = [...list].sort((a, b) => {
        const ad = a.waiting_orders.find(o => o.exit_date)?.exit_date ?? "9999";
        const bd = b.waiting_orders.find(o => o.exit_date)?.exit_date ?? "9999";
        return ad.localeCompare(bd);
      });
    } else {
      list = [...list].sort((a, b) => b.net_need - a.net_need);
    }
    return list;
  }, [needs, filterCode, sortBy]);

  return (
    <div className="p-3 sm:p-4 max-w-6xl mx-auto space-y-4">
      <header className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Boxes className="size-5 text-primary" /> Produção de cascos (em massa)
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Agrupado por código de casco. Atribui primeiro às encomendas à espera, o excedente vai para stock.</p>
        </div>
      </header>

      {/* Identificação operador */}
      <Card className="p-3 flex items-end gap-2 flex-wrap">
        <div className="space-y-1 flex-1 min-w-[180px]">
          <Label className="text-xs flex items-center gap-1"><UserCircle2 className="size-3.5" /> Código do operador</Label>
          <Input
            value={operatorCode}
            onChange={(e) => setOperatorCode(e.target.value)}
            placeholder={settings?.identification_mode === "sessao" ? "Sessão" : "ex: 01"}
            className="h-10 font-mono"
            autoComplete="off"
          />
        </div>
        <div className="text-xs text-muted-foreground self-center">
          {currentOp ? (
            <span><b>{currentOp.name}</b> · etapas: {currentOp.stages.join(", ") || "—"}</span>
          ) : operatorCode ? (
            <span className="text-destructive">Operador não encontrado</span>
          ) : (
            <span>Indica o teu código para produzir.</span>
          )}
        </div>
      </Card>

      {/* Lotes em curso */}
      {batches.length > 0 && (
        <Card className="p-3 space-y-2">
          <div className="text-sm font-semibold">Lotes em curso ({batches.length})</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {batches.map(b => (
              <ActiveBatchCard
                key={b.id}
                batch={b}
                disabled={!operatorCode.trim()}
                onPause={() => eventFn({ data: { batch_id: b.id, operator_code: operatorCode.trim(), event: "pausar" } })
                  .then(() => qc.invalidateQueries({ queryKey: ["shell-batches-active"] }))
                  .catch((e: any) => toast.error(e?.message ?? "Erro"))}
                onResume={() => eventFn({ data: { batch_id: b.id, operator_code: operatorCode.trim(), event: "retomar" } })
                  .then(() => qc.invalidateQueries({ queryKey: ["shell-batches-active"] }))
                  .catch((e: any) => toast.error(e?.message ?? "Erro"))}
                onFinalize={() => finalizeFn({ data: { batch_id: b.id, operator_code: operatorCode.trim() } })
                  .then((r: any) => {
                    toast.success(`Lote concluído · ${r.assigned_to_orders} atribuídos · ${r.added_to_stock} p/ stock`);
                    qc.invalidateQueries({ queryKey: ["shell-batches-active"] });
                    qc.invalidateQueries({ queryKey: ["shell-needs"] });
                    qc.invalidateQueries({ queryKey: ["production"] });
                    qc.invalidateQueries({ queryKey: ["dashboard"] });
                    qc.invalidateQueries({ queryKey: ["shells"] });
                  })
                  .catch((e: any) => toast.error(e?.message ?? "Erro"))}
              />
            ))}
          </div>
        </Card>
      )}

      {/* Filtros */}
      <Card className="p-3 flex items-end gap-2 flex-wrap">
        <div className="space-y-1 flex-1 min-w-[180px]">
          <Label className="text-xs flex items-center gap-1"><Filter className="size-3.5" /> Filtrar por código/nome</Label>
          <Input value={filterCode} onChange={(e) => setFilterCode(e.target.value)} placeholder="ex: ES001" className="h-10" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Ordenar</Label>
          <div className="flex gap-1">
            <Button size="sm" variant={sortBy === "need" ? "default" : "outline"} onClick={() => setSortBy("need")}>Maior necessidade</Button>
            <Button size="sm" variant={sortBy === "urgency" ? "default" : "outline"} onClick={() => setSortBy("urgency")}>Urgência</Button>
          </div>
        </div>
      </Card>

      {/* Lista agrupada */}
      {filtered.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Sem necessidade de produção de cascos no momento.
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {filtered.map(n => (
            <ShellNeedCard
              key={n.shell_id}
              need={n}
              canProduce={canProduceShells}
              onStart={(qty) => startFn({ data: { shell_id: n.shell_id, operator_code: operatorCode.trim(), quantity: qty } })
                .then(() => {
                  toast.success(`Lote iniciado · ${qty} cascos`);
                  qc.invalidateQueries({ queryKey: ["shell-batches-active"] });
                })
                .catch((e: any) => toast.error(e?.message ?? "Erro"))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ActiveBatchCard({ batch, disabled, onPause, onResume, onFinalize }: {
  batch: ActiveBatch; disabled: boolean;
  onPause: () => void; onResume: () => void; onFinalize: () => void;
}) {
  // Tempo ao vivo: produtivo + delta desde último update
  const liveProd = batch.is_paused ? batch.productive_seconds
    : batch.productive_seconds + Math.max(0, Math.floor((Date.now() - new Date(batch.started_at ?? Date.now()).getTime()) / 1000) - batch.productive_seconds - batch.paused_seconds);
  return (
    <div className="border rounded-md p-3 bg-card">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-bold truncate">{batch.shell_code} · {batch.shell_name}</div>
          <div className="text-xs text-muted-foreground">Lote {batch.quantity} un · op {batch.operator_code ?? "—"}</div>
        </div>
        <Badge variant={batch.is_paused ? "secondary" : "default"} className="shrink-0">
          {batch.is_paused ? "Em pausa" : "Em curso"}
        </Badge>
      </div>
      <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="size-3.5" /> Produtivo {fmtTime(liveProd)} · pausa {fmtTime(batch.paused_seconds)}
      </div>
      <div className="mt-2 flex gap-1 flex-wrap">
        {batch.is_paused ? (
          <Button size="sm" onClick={onResume} disabled={disabled} className="gap-1"><Play className="size-3.5" /> Retomar</Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={onPause} disabled={disabled} className="gap-1"><Pause className="size-3.5" /> Pausar</Button>
        )}
        <Button size="sm" variant="default" onClick={onFinalize} disabled={disabled} className="gap-1 bg-emerald-600 hover:bg-emerald-700">
          <Check className="size-3.5" /> Finalizar
        </Button>
      </div>
    </div>
  );
}

function ShellNeedCard({ need, canProduce, onStart }: {
  need: ShellNeed; canProduce: boolean; onStart: (qty: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<number>(need.net_need);

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-sm">{need.shell_code}</div>
          <div className="text-xs text-muted-foreground truncate">{need.shell_name}</div>
        </div>
        <Badge className="bg-amber-500 hover:bg-amber-500 text-white shrink-0">Faltam {need.net_need}</Badge>
      </div>
      <div className="grid grid-cols-3 gap-1 text-[11px]">
        <Stat label="Necessidade" value={need.gross_need} />
        <Stat label="Disponível" value={need.available} />
        <Stat label="Reservado" value={need.reserved} />
      </div>
      <button
        className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
        onClick={() => setExpanded(v => !v)}
      >
        {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        {need.waiting_orders.length} encomenda(s) à espera
      </button>
      {expanded && (
        <ul className="text-[11px] space-y-0.5 max-h-40 overflow-auto border-t pt-1">
          {need.waiting_orders.map(o => (
            <li key={o.order_id} className="flex justify-between gap-2">
              <span className="font-mono truncate">{o.order_number}</span>
              <span className="text-muted-foreground truncate">{o.product_description}</span>
              <span className="text-muted-foreground shrink-0">{o.exit_date ?? "—"}</span>
            </li>
          ))}
        </ul>
      )}
      <Button
        size="sm"
        className="w-full gap-1"
        disabled={!canProduce}
        onClick={() => { setQty(need.net_need); setOpen(true); }}
      >
        <Play className="size-3.5" /> Produzir em massa
      </Button>
      {!canProduce && (
        <p className="text-[10px] text-muted-foreground text-center">Indica um operador vinculado a estrutura/branco.</p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Produzir em massa — {need.shell_code}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Quantidade a produzir</Label>
            <Input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
              className="h-11"
            />
            <p className="text-xs text-muted-foreground">
              {qty <= need.net_need
                ? `Tudo será atribuído às ${qty} encomenda(s) à espera (por urgência).`
                : `${need.net_need} para encomendas · ${qty - need.net_need} para stock.`}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => { onStart(qty); setOpen(false); }}>Iniciar lote</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border bg-muted/40 px-2 py-1">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
