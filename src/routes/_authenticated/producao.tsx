import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Lock, Play, Pause, Check, RotateCcw, Clock, UserCircle2, AlertTriangle } from "lucide-react";
import { STAGE_LABELS } from "@/lib/format";
import {
  getProductionData, recordStageEvent, getAppSettings,
  listOperatorsWithStages, STAGES, type ProductionStageOrder, type Stage,
} from "@/lib/production.functions";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";

export const Route = createFileRoute("/_authenticated/producao")({
  component: ProducaoPage,
});

function fmtTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2,"0")}m`;
  if (m > 0) return `${m}m ${r.toString().padStart(2,"0")}s`;
  return `${r}s`;
}

function ProducaoPage() {
  const qc = useQueryClient();
  const fetchData = useServerFn(getProductionData);
  const fetchSettings = useServerFn(getAppSettings);
  const fetchOps = useServerFn(listOperatorsWithStages);
  const recordFn = useServerFn(recordStageEvent);

  const { data } = useQuery({ queryKey: ["production"], queryFn: () => fetchData(), refetchInterval: 30000 });
  const { data: settings } = useQuery({ queryKey: ["app-settings"], queryFn: () => fetchSettings() });
  const { data: operators } = useQuery({ queryKey: ["operators-stages"], queryFn: () => fetchOps() });

  useRealtimeOrders([["production"]]);

  const [activeStage, setActiveStage] = useState<Stage>("estofagem");
  const [operatorCode, setOperatorCode] = useState<string>(() =>
    (typeof window !== "undefined" && sessionStorage.getItem("op_code")) || ""
  );
  // Tick para atualizar contadores em tempo real
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const mode = settings?.identification_mode ?? "codigo";
  const currentOp = useMemo(
    () => (operators ?? []).find((o) => o.code === operatorCode.trim()),
    [operators, operatorCode]
  );
  const canActOnStage = (stage: Stage) => {
    if (!currentOp) return false;
    return currentOp.stages.includes(stage);
  };

  const mutation = useMutation({
    mutationFn: (vars: { order_stage_id: string; event: "iniciar"|"pausar"|"retomar"|"finalizar" }) => {
      const code = operatorCode.trim();
      if (!code) throw new Error("Indica o teu código primeiro");
      return recordFn({ data: { ...vars, operator_code: code } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["production"] }),
    onError: (e: any) => toast.error(e?.message ?? "Erro ao registar"),
  });

  const codeInputRef = useRef<HTMLInputElement>(null);
  function saveCode() {
    if (operatorCode.trim()) {
      sessionStorage.setItem("op_code", operatorCode.trim());
      toast.success(`Operador ${currentOp?.name ?? operatorCode}`);
    }
  }
  function clearCode() {
    sessionStorage.removeItem("op_code");
    setOperatorCode("");
    setTimeout(() => codeInputRef.current?.focus(), 50);
  }

  const items = data?.byStage[activeStage] ?? [];

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">Produção</h1>
        {currentOp ? (
          <div className="flex items-center gap-2 bg-primary/10 text-primary rounded-md px-3 py-1.5">
            <UserCircle2 className="size-4" />
            <span className="text-sm font-medium">{currentOp.name} ({currentOp.code})</span>
            <Button variant="ghost" size="sm" onClick={clearCode}>Trocar</Button>
          </div>
        ) : null}
      </div>

      {/* Identificação */}
      {!currentOp && (
        <Card className="p-4">
          <Label className="text-sm font-medium">
            {mode === "sessao" ? "Confirma o teu código de operador" : "O teu código de operador"}
          </Label>
          <p className="text-xs text-muted-foreground mb-2">
            {mode === "codigo"
              ? "Modo comunitário: este código será usado nas tuas ações até trocares de operador."
              : "Modo sessão: indica o teu código uma vez."}
          </p>
          <div className="flex gap-2">
            <Input
              ref={codeInputRef}
              autoFocus
              value={operatorCode}
              onChange={(e) => setOperatorCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveCode(); }}
              placeholder="Ex: 01"
              className="text-2xl h-14 font-mono uppercase tracking-widest"
            />
            <Button size="lg" onClick={saveCode} className="h-14 px-6">Entrar</Button>
          </div>
          {operatorCode && !currentOp && (
            <p className="text-xs text-destructive mt-2 flex items-center gap-1">
              <AlertTriangle className="size-3" /> Código não encontrado
            </p>
          )}
        </Card>
      )}

      {/* Tabs de etapas */}
      <div className="overflow-x-auto -mx-4 px-4">
        <div className="flex gap-1 min-w-max">
          {STAGES.map((s) => {
            const count = data?.byStage[s]?.length ?? 0;
            const linked = canActOnStage(s);
            const isActive = s === activeStage;
            return (
              <button
                key={s}
                onClick={() => setActiveStage(s)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border transition ${
                  isActive ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"
                }`}
              >
                {!linked && <Lock className="size-3 opacity-60" />}
                {STAGE_LABELS[s]}
                <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${isActive ? "bg-primary-foreground/20" : "bg-muted"}`}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Lista */}
      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="text-center text-muted-foreground py-12 border border-dashed rounded-md">
            Sem encomendas em {STAGE_LABELS[activeStage].toLowerCase()}
          </div>
        ) : items.map((it) => (
          <StageCard
            key={it.id}
            item={it}
            canAct={canActOnStage(activeStage) && !!currentOp}
            onAction={(event) => mutation.mutate({ order_stage_id: it.id, event })}
            pending={mutation.isPending}
          />
        ))}
      </div>
    </div>
  );
}

function StageCard({ item, canAct, onAction, pending }: {
  item: ProductionStageOrder;
  canAct: boolean;
  onAction: (event: "iniciar"|"pausar"|"retomar"|"finalizar") => void;
  pending: boolean;
}) {
  // Calcular tempo decorrido em vivo se estiver em curso
  const liveSeconds = useMemo(() => {
    if (item.status !== "em_curso" || item.is_paused || !item.started_at) return item.productive_seconds;
    // aproximação: started_at é o início da etapa, não da última retoma
    // o servidor recalcula com precisão a partir dos logs
    return item.productive_seconds;
  }, [item]);

  const blocked = item.status === "bloqueada";
  const running = item.status === "em_curso" && !item.is_paused;
  const paused = item.is_paused;

  return (
    <Card className={`p-4 border-l-4 ${
      blocked ? "border-l-destructive bg-destructive/5"
      : paused ? "border-l-warning bg-warning/5"
      : running ? "border-l-emerald-500"
      : "border-l-primary"
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-bold">{item.order_number}</span>
            {paused && <Badge className="bg-warning text-warning-foreground">EM PAUSA</Badge>}
            {running && <Badge className="bg-emerald-600 text-white">A PRODUZIR</Badge>}
            {blocked && <Badge variant="destructive">BLOQUEADA</Badge>}
            {item.operator_code && <Badge variant="secondary">Op {item.operator_code}</Badge>}
          </div>
          <div className="text-sm font-medium mt-1">{item.product_description}</div>
          {item.observation && (
            <div className="mt-1 text-xs font-semibold bg-warning/15 text-warning-foreground border border-warning/40 rounded px-2 py-1 inline-flex items-center gap-1">
              <AlertTriangle className="size-3 text-warning" />
              {item.observation}
            </div>
          )}
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
            <span className="inline-flex items-center gap-1"><Clock className="size-3" />Produtivo: <strong className="text-foreground">{fmtTime(liveSeconds)}</strong></span>
            {item.paused_seconds > 0 && <span>Pausa: {fmtTime(item.paused_seconds)}</span>}
          </div>
        </div>
      </div>

      {/* Ações */}
      <div className="flex gap-2 mt-3 flex-wrap">
        {!canAct ? (
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Lock className="size-3" /> Não atribuído a esta etapa
          </div>
        ) : (
          <>
            {item.status !== "em_curso" && !blocked && (
              <Button size="lg" disabled={pending} onClick={() => onAction("iniciar")} className="gap-2">
                <Play className="size-4" /> Iniciar
              </Button>
            )}
            {running && (
              <Button size="lg" variant="outline" disabled={pending} onClick={() => onAction("pausar")} className="gap-2">
                <Pause className="size-4" /> Pausar
              </Button>
            )}
            {paused && (
              <Button size="lg" variant="outline" disabled={pending} onClick={() => onAction("retomar")} className="gap-2">
                <RotateCcw className="size-4" /> Retomar
              </Button>
            )}
            {item.status === "em_curso" && (
              <Button size="lg" variant="default" disabled={pending} onClick={() => onAction("finalizar")} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                <Check className="size-4" /> Finalizar
              </Button>
            )}
            {blocked && (
              <div className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="size-3" /> Aguarda etapas anteriores
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}