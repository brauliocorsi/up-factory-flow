import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation, useQueries } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Lock, Play, Pause, Check, RotateCcw, Clock, UserCircle2, AlertTriangle, Boxes, Wrench, Search, ClipboardCheck, CheckCircle2, XCircle } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { STAGE_LABELS } from "@/lib/format";
import {
  getProductionData, recordStageEvent, getAppSettings,
  listOperatorsWithStages, STAGES, VISIBLE_STAGES, type ProductionStageOrder, type Stage,
} from "@/lib/production.functions";
import { ConvergenceStatus } from "@/components/kanban/ConvergenceStatus";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";
import { ReworkDialog } from "@/components/rework/ReworkDialog";
import { QualityCheckDialog } from "@/components/quality/QualityCheckDialog";
import { PrintLabelButton } from "@/components/labels/PrintLabelButton";
import { listQualityChecks } from "@/lib/quality.functions";
import { getExpectedForOrders } from "@/lib/sla.functions";
import {
  getColisByStage, recordColiStageEvent, type ColiStageItem,
} from "@/lib/colis.functions";
import { useMySession } from "@/hooks/useMySession";

export const Route = createFileRoute("/_authenticated/producao/")({
  component: ProducaoPage,
  errorComponent: ({ error, reset }) => (
    <div className="max-w-2xl mx-auto p-6 text-center space-y-3">
      <AlertTriangle className="size-8 text-orange-600 mx-auto" />
      <h2 className="text-lg font-semibold">Algo correu mal a atualizar</h2>
      <p className="text-sm text-muted-foreground">
        {error?.message ?? "Erro inesperado a carregar a produção."}
      </p>
      <Button onClick={() => reset()}>Recarregar</Button>
    </div>
  ),
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
  const { operator: sessionOperator } = useMySession();

  const { data } = useQuery({ queryKey: ["production"], queryFn: () => fetchData(), refetchInterval: 30000 });
  const { data: settings } = useQuery({ queryKey: ["app-settings"], queryFn: () => fetchSettings() });
  const { data: operators } = useQuery({ queryKey: ["operators-stages"], queryFn: () => fetchOps() });
  const fetchExpected = useServerFn(getExpectedForOrders);
  const fetchColis = useServerFn(getColisByStage);
  const recordColiFn = useServerFn(recordColiStageEvent);

  const colisQueries = useQueries({
    queries: VISIBLE_STAGES.map((stage) => ({
      queryKey: ["production-colis", stage],
      queryFn: () => fetchColis({ data: { stage } }),
      refetchInterval: 30000,
    })),
  });
  const colisByStageMap = Object.fromEntries(
    VISIBLE_STAGES.map((stage, index) => [stage, colisQueries[index]?.data]),
  ) as Partial<Record<Stage, { byOrder: Record<string, ColiStageItem[]>; multiColiOrderIds: string[] }>>;

  // Lista de (order_id, stage) visíveis em todas as etapas para resolver SLA em lote
  const visibleItemsByStage = useMemo(() => {
    const out = Object.fromEntries(VISIBLE_STAGES.map((s) => [s, []])) as unknown as Record<Stage, ProductionStageOrder[]>;
    if (!data) return out;
    for (const s of VISIBLE_STAGES) {
      const activeColiOrderIds = new Set(Object.keys(colisByStageMap[s]?.byOrder ?? {}));
      for (const it of data.byStage[s] ?? []) {
        if ((it.coli_count ?? 0) > 1 && !activeColiOrderIds.has(it.order_id)) continue;
        out[s].push(it);
      }
    }
    return out;
  }, [data, colisByStageMap]);

  const orderStagePairs = useMemo(() => {
    const out: { order_id: string; stage: Stage }[] = [];
    for (const s of VISIBLE_STAGES) {
      for (const it of visibleItemsByStage[s] ?? []) {
        out.push({ order_id: it.order_id, stage: it.stage });
      }
    }
    return out;
  }, [visibleItemsByStage]);

  const { data: expectedMap } = useQuery({
    queryKey: ["production-sla", orderStagePairs.length, orderStagePairs.map((p) => `${p.order_id}|${p.stage}`).join(",")],
    queryFn: () => fetchExpected({ data: { orders: orderStagePairs } }),
    enabled: orderStagePairs.length > 0,
  });

  useRealtimeOrders([["production"], ...VISIBLE_STAGES.map((s) => ["production-colis", s])]);

  const [activeStage, setActiveStage] = useState<Stage>("estofagem");
  const colisByStage = colisByStageMap[activeStage];

  const coliMutation = useMutation({
    mutationFn: (vars: { order_coli_stage_id: string; event: "iniciar"|"pausar"|"retomar"|"finalizar" }) => {
      const code = operatorCodeRef.current.trim();
      if (!code) throw new Error("Indica o teu código primeiro");
      return recordColiFn({ data: { ...vars, operator_code: code } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production"] });
      VISIBLE_STAGES.forEach((stage) => qc.invalidateQueries({ queryKey: ["production-colis", stage] }));
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao registar"),
  });

  const [onlyReady, setOnlyReady] = useState<boolean>(true);
  const [onlyMine, setOnlyMine] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [operatorCode, setOperatorCode] = useState<string>(() =>
    (typeof window !== "undefined" && sessionStorage.getItem("op_code")) || ""
  );
  // Reconhecimento automático: se o utilizador autenticado é um operador
  // ligado, usa o seu código automaticamente (sobrepõe sessionStorage).
  useEffect(() => {
    if (sessionOperator?.code) {
      setOperatorCode(sessionOperator.code);
    }
  }, [sessionOperator?.code]);
  const operatorCodeRef = useRef<string>(operatorCode);
  useEffect(() => { operatorCodeRef.current = operatorCode; }, [operatorCode]);
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

  const isReadyToStart = (it: ProductionStageOrder) => {
    // Qualidade não tem iniciar/pausar/finalizar — está sempre "pronta"
    // para receber o formulário enquanto não estiver concluída.
    if (it.stage === "qualidade") return it.status !== "concluida";
    if ((it.coli_count ?? 0) > 1) {
      const activeColis = colisByStageMap[it.stage]?.byOrder?.[it.order_id] ?? [];
      return activeColis.some((c) => c.status !== "em_curso");
    }
    if (it.status === "bloqueada") return false;
    if (it.status === "em_curso") return false;
    if (it.stage === "estofagem" && it.lines) {
      return !!(it.lines.tecido?.ready && it.lines.estrutura?.ready);
    }
    return true;
  };
  const allItems = visibleItemsByStage[activeStage] ?? [];
  const items = allItems.filter((it) => {
    if (searchQuery.trim() && !it.order_number.toLowerCase().includes(searchQuery.toLowerCase().trim())) return false;
    if (onlyMine && !canActOnStage(it.stage)) return false;
    if (onlyReady && !isReadyToStart(it)) return false;
    return true;
  });
  const hiddenCount = allItems.length - items.length;

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">Produção</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            to="/producao/cascos"
            className="inline-flex items-center gap-1 rounded-md border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            <Boxes className="size-4" /> Cascos em massa
          </Link>
          {currentOp ? (
          <div className="flex items-center gap-2 bg-primary/10 text-primary rounded-md px-3 py-1.5">
            <UserCircle2 className="size-4" />
            <span className="text-sm font-medium">{currentOp.name} ({currentOp.code})</span>
            {!sessionOperator && (
              <Button variant="ghost" size="sm" onClick={clearCode}>Trocar</Button>
            )}
          </div>
          ) : null}
        </div>
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
          {VISIBLE_STAGES.map((s) => {
            const count = visibleItemsByStage[s]?.length ?? 0;
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

      {/* Filtros e Pesquisa */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-3 rounded-lg border">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setOnlyReady((v) => !v)}
            className={`text-xs font-medium px-2.5 py-1.5 rounded-md border transition ${
              onlyReady ? "bg-emerald-600 text-white border-emerald-600" : "bg-card hover:bg-accent"
            }`}
          >
            {onlyReady ? "✓ " : ""}Só prontas para iniciar
          </button>
          <button
            onClick={() => setOnlyMine((v) => !v)}
            className={`text-xs font-medium px-2.5 py-1.5 rounded-md border transition ${
              onlyMine ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"
            }`}
          >
            {onlyMine ? "✓ " : ""}Só as minhas etapas
          </button>
          {hiddenCount > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {hiddenCount} ocultas pelos filtros
            </span>
          )}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Procurar nº encomenda..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 text-sm h-9"
          />
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
            operatorCode={operatorCode.trim()}
            expectedMinutes={expectedMap?.[it.order_id]?.[it.stage] ?? null}
            colis={colisByStage?.byOrder?.[it.order_id] ?? []}
            isMultiColiOrder={(colisByStage?.multiColiOrderIds ?? []).includes(it.order_id)}
            onColiAction={(coli_stage_id, event) =>
              coliMutation.mutate({ order_coli_stage_id: coli_stage_id, event })
            }
            coliPending={coliMutation.isPending}
          />
        ))}
      </div>
    </div>
  );
}

function StageCard({ item, canAct, onAction, pending, operatorCode, expectedMinutes, colis, isMultiColiOrder, onColiAction, coliPending }: {
  item: ProductionStageOrder;
  canAct: boolean;
  onAction: (event: "iniciar"|"pausar"|"retomar"|"finalizar") => void;
  pending: boolean;
  operatorCode: string;
  expectedMinutes: number | null;
  colis: ColiStageItem[];
  isMultiColiOrder: boolean;
  onColiAction: (coli_stage_id: string, event: "iniciar"|"pausar"|"retomar"|"finalizar") => void;
  coliPending: boolean;
}) {
  // Contador "live": usa como âncora o instante em que o segmento ativo
  // começou (último `iniciar`/`retomar`, vindo do servidor). Assim o tempo
  // mantém-se contínuo entre montagens do componente (ex.: trocar de aba
  // de etapa e voltar) — não reinicia com base em Date.now() do mount.
  const running = item.status === "em_curso" && !item.is_paused;
  const segmentStartMs = item.current_segment_started_at
    ? new Date(item.current_segment_started_at).getTime()
    : null;
  const liveSeconds = running && segmentStartMs
    ? item.productive_seconds + Math.max(0, Math.floor((Date.now() - segmentStartMs) / 1000))
    : item.productive_seconds;

  // Notificações de SLA (perto do limite / excedido). Cada limiar dispara
  // uma única vez por instância de etapa; reinicia quando muda a etapa.
  const notifiedRef = useRef<{ id: string; warn: boolean; exceeded: boolean }>({
    id: item.id, warn: false, exceeded: false,
  });
  useEffect(() => {
    if (notifiedRef.current.id !== item.id) {
      notifiedRef.current = { id: item.id, warn: false, exceeded: false };
    }
    if (!running || !expectedMinutes || expectedMinutes <= 0) return;
    const expectedSec = expectedMinutes * 60;
    const ratio = liveSeconds / expectedSec;
    if (ratio >= 1 && !notifiedRef.current.exceeded) {
      notifiedRef.current.exceeded = true;
      notifiedRef.current.warn = true;
      toast.error(`Tempo excedido — ${item.order_number}`, {
        description: `Etapa ${item.stage}: previsto ${expectedMinutes}m, já vai em ${fmtTime(liveSeconds)}.`,
        duration: 8000,
      });
    } else if (ratio >= 0.8 && !notifiedRef.current.warn && !notifiedRef.current.exceeded) {
      notifiedRef.current.warn = true;
      toast.warning(`Perto do limite (80%) — ${item.order_number}`, {
        description: `Etapa ${item.stage}: previsto ${expectedMinutes}m, decorrido ${fmtTime(liveSeconds)}.`,
        duration: 6000,
      });
    }
  }, [liveSeconds, running, expectedMinutes, item.id, item.order_number, item.stage]);

  const slaRatio = expectedMinutes && expectedMinutes > 0
    ? liveSeconds / (expectedMinutes * 60) : 0;
  const slaExceeded = expectedMinutes != null && expectedMinutes > 0 && slaRatio >= 1;
  const slaWarn = !slaExceeded && slaRatio >= 0.8;

  const blocked = item.status === "bloqueada";
  const paused = item.is_paused;
  const isUpholstery = item.stage === "estofagem";
  const isQuality = item.stage === "qualidade";
  const isPacking = item.stage === "embalagem";
  // A decisão de "vista por coli" depende do TOTAL de order_colis da
  // encomenda (rota multi-coli), NÃO do número de colis presentes nesta
  // etapa — caso contrário, ao finalizar todos menos um, o cartão
  // colapsaria para a vista antiga ao nível da encomenda.
  // Encomendas de 1 coli ("Produto completo") continuam na vista antiga.
  const operateByColis = isMultiColiOrder;
  const convergenceReady = item.lines
    ? !!(item.lines.tecido?.ready && item.lines.estrutura?.ready)
    : true;
  const showConvergence = item.lines && (
    !operateByColis && (isUpholstery || ["corte","costura","estrutura","branco"].includes(item.stage))
  );

  return (
    <Card className={`p-4 border-l-4 ${
      item.is_rework ? "border-l-orange-500 bg-orange-50/40" :
      blocked ? "border-l-destructive bg-destructive/5"
      : paused ? "border-l-warning bg-warning/5"
      : running ? "border-l-emerald-500"
      : "border-l-primary"
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-bold">{item.order_number}</span>
            {item.is_rework && (
              <Badge className="bg-orange-600 text-white gap-1">
                <Wrench className="size-3" /> RETRABALHO
              </Badge>
            )}
            {paused && <Badge className="bg-warning text-warning-foreground">EM PAUSA</Badge>}
            {running && <Badge className="bg-emerald-600 text-white">A PRODUZIR</Badge>}
            {blocked && <Badge variant="destructive">BLOQUEADA</Badge>}
            {item.operator_code && <Badge variant="secondary">Op {item.operator_code}</Badge>}
            {slaExceeded && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="size-3" /> Tempo excedido
              </Badge>
            )}
            {slaWarn && (
              <Badge className="bg-amber-500 text-white gap-1">
                <AlertTriangle className="size-3" /> Perto do limite
              </Badge>
            )}
            {(item.rework_count ?? 0) > 0 && (
              <span className="text-[10px] text-orange-700 font-medium">×{item.rework_count} retrabalhos</span>
            )}
          </div>
          <div className="text-sm font-medium mt-1">{item.product_description}</div>
          {item.observation && (
            <div className="mt-1 text-xs font-semibold bg-warning/15 text-warning-foreground border border-warning/40 rounded px-2 py-1 inline-flex items-center gap-1">
              <AlertTriangle className="size-3 text-warning" />
              {item.observation}
            </div>
          )}
          {showConvergence && item.lines && (
            <div className="mt-2">
              <ConvergenceStatus
                lines={item.lines}
                variant={isUpholstery ? "full" : "compact"}
                highlightWhenReady={isUpholstery}
              />
            </div>
          )}
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
            {isQuality ? (
              <span className="inline-flex items-center gap-1">
                <ClipboardCheck className="size-3" /> Conferência sem cronómetro
              </span>
            ) : (
              <>
                <span className="inline-flex items-center gap-1"><Clock className="size-3" />Produtivo: <strong className="text-foreground">{fmtTime(liveSeconds)}</strong></span>
                {item.paused_seconds > 0 && <span>Pausa: {fmtTime(item.paused_seconds)}</span>}
                {(item.rework_seconds ?? 0) > 0 && <span className="text-orange-700">Retrabalho: {fmtTime(item.rework_seconds ?? 0)}</span>}
              </>
            )}
          </div>
          {!isQuality && expectedMinutes != null && expectedMinutes > 0 && (
            <SlaBar productiveSeconds={liveSeconds} expectedMinutes={expectedMinutes} />
          )}
          {isPacking && (
            <LastQualityCheckSummary orderId={item.order_id} />
          )}
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
            {!isQuality && !operateByColis && item.status !== "em_curso" && !blocked && (!isUpholstery || convergenceReady) && (
              <Button size="lg" disabled={pending} onClick={() => onAction("iniciar")} className="gap-2">
                <Play className="size-4" /> Iniciar
              </Button>
            )}
            {!isQuality && !operateByColis && isUpholstery && !convergenceReady && item.status !== "em_curso" && (
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Lock className="size-3" /> Aguarda {!item.lines?.tecido?.ready ? "Costura" : ""}
                {!item.lines?.tecido?.ready && !item.lines?.estrutura?.ready ? " + " : ""}
                {!item.lines?.estrutura?.ready ? "Branco" : ""}
              </div>
            )}
            {!isQuality && !operateByColis && running && (
              <Button size="lg" variant="outline" disabled={pending} onClick={() => onAction("pausar")} className="gap-2">
                <Pause className="size-4" /> Pausar
              </Button>
            )}
            {!isQuality && !operateByColis && paused && (
              <Button size="lg" variant="outline" disabled={pending} onClick={() => onAction("retomar")} className="gap-2">
                <RotateCcw className="size-4" /> Retomar
              </Button>
            )}
            {!isQuality && !operateByColis && item.status === "em_curso" && (
              <Button size="lg" variant="default" disabled={pending} onClick={() => onAction("finalizar")} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                <Check className="size-4" /> Finalizar
              </Button>
            )}
            {!isQuality && !operateByColis && blocked && (
              <div className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="size-3" /> Aguarda etapas anteriores
              </div>
            )}
            {item.stage !== "estrutura" && (
              <ReworkDialog
                orderId={item.order_id}
                orderNumber={item.order_number}
                detectedStage={item.stage}
                operatorCode={operatorCode}
              />
            )}
            {(isQuality || isPacking) && (
              <QualityCheckDialog
                orderId={item.order_id}
                orderStageId={isQuality ? item.id : ""}
                orderNumber={item.order_number}
                productDescription={item.product_description}
                operatorCode={operatorCode}
              />
            )}
            {isPacking && (
              <PrintLabelButton orderId={item.order_id} label="Etiquetar" />
            )}
          </>
        )}
      </div>

      {/* Lista de colis (quando há mais do que um) */}
      {operateByColis && (
        <div className="mt-3 border-t pt-3 space-y-2">
          <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
            <Boxes className="size-3" /> Colis nesta etapa ({colis.length})
          </div>
          {colis.map((c) => (
            <ColiRow
              key={c.id}
              coli={c}
              canAct={canAct}
              pending={coliPending}
              onAction={(ev) => onColiAction(c.id, ev)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function ColiRow({ coli, canAct, pending, onAction }: {
  coli: ColiStageItem;
  canAct: boolean;
  pending: boolean;
  onAction: (event: "iniciar"|"pausar"|"retomar"|"finalizar") => void;
}) {
  const running = coli.status === "em_curso" && !coli.is_paused;
  const paused = coli.is_paused;
  const segStart = coli.last_resume_at ? new Date(coli.last_resume_at).getTime() : null;
  const live = running && segStart
    ? coli.productive_seconds + Math.max(0, Math.floor((Date.now() - segStart) / 1000))
    : coli.productive_seconds;

  return (
    <div className={`rounded-md border p-2 flex items-center justify-between gap-2 flex-wrap ${
      running ? "border-emerald-500/40 bg-emerald-50/40"
      : paused ? "border-amber-500/40 bg-amber-50/40"
      : "bg-card"
    }`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono bg-muted rounded px-1.5 py-0.5">#{coli.coli_number}</span>
          <span className="text-sm font-medium">{coli.coli_name}</span>
          {running && <Badge className="bg-emerald-600 text-white text-[10px]">A PRODUZIR</Badge>}
          {paused && <Badge className="bg-warning text-warning-foreground text-[10px]">EM PAUSA</Badge>}
          {coli.operator_code && <Badge variant="secondary" className="text-[10px]">Op {coli.operator_code}</Badge>}
          <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
            <Clock className="size-3" /> {fmtTime(live)}
            {coli.paused_seconds > 0 && <> · pausa {fmtTime(coli.paused_seconds)}</>}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {!canAct ? (
          <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
            <Lock className="size-3" /> Sem permissão
          </span>
        ) : (
          <>
            {coli.status !== "em_curso" && (
              <Button size="sm" disabled={pending} onClick={() => onAction("iniciar")} className="h-8 gap-1">
                <Play className="size-3" /> Iniciar
              </Button>
            )}
            {running && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => onAction("pausar")} className="h-8 gap-1">
                <Pause className="size-3" /> Pausar
              </Button>
            )}
            {paused && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => onAction("retomar")} className="h-8 gap-1">
                <RotateCcw className="size-3" /> Retomar
              </Button>
            )}
            {coli.status === "em_curso" && (
              <Button size="sm" disabled={pending} onClick={() => onAction("finalizar")}
                className="h-8 gap-1 bg-emerald-600 hover:bg-emerald-700">
                <Check className="size-3" /> Finalizar
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SlaBar({ productiveSeconds, expectedMinutes }: { productiveSeconds: number; expectedMinutes: number }) {
  const expectedSec = expectedMinutes * 60;
  const ratio = expectedSec > 0 ? productiveSeconds / expectedSec : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const exceeded = productiveSeconds > expectedSec;
  const warn = !exceeded && ratio >= 0.8;
  const color = exceeded ? "bg-destructive" : warn ? "bg-amber-500" : "bg-primary";
  const overSec = productiveSeconds - expectedSec;
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-muted-foreground">
          Previsto: <strong className="text-foreground">{expectedMinutes}m</strong>
          {" · "}
          Realizado: <strong className="text-foreground">{fmtTime(productiveSeconds)}</strong>
        </span>
        {exceeded && (
          <span className="inline-flex items-center gap-1 text-destructive font-semibold">
            <AlertTriangle className="size-3" /> Excedido +{fmtTime(overSec)}
          </span>
        )}
      </div>
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${exceeded ? 100 : pct}%` }} />
      </div>
    </div>
  );
}