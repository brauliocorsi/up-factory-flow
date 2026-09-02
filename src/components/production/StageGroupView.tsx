import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle, ChevronDown, ChevronRight, Check, Boxes, Users, Play, Pause, RotateCcw, Clock } from "lucide-react";
import { recordStageEvent } from "@/lib/production.functions";
import {
  getStageGroups,
  finalizeStageGroup,
  type StageGroup,
} from "@/lib/grouping.functions";

function fmtDur(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(r).padStart(2, "0")}s`;
  return `${r}s`;
}

type Props = {
  stage: "corte" | "estrutura";
  canAct: boolean;
  operatorCode: string;
};

export function StageGroupView({ stage, canAct, operatorCode }: Props) {
  const qc = useQueryClient();
  const fetchGroups = useServerFn(getStageGroups);
  const finalizeFn = useServerFn(finalizeStageGroup);
  const eventFn = useServerFn(recordStageEvent);

  const { session } = useAuth();
  const { data: groups = [], isLoading, error } = useQuery({
    queryKey: ["stage-groups", stage],
    queryFn: () => fetchGroups({ data: { stage } }),
    refetchInterval: 30000,
    enabled: Boolean(session),
  });

  const finalizeMut = useMutation({
    mutationFn: (vars: { order_stage_ids: string[] }) => {
      const code = operatorCode.trim();
      if (!code) throw new Error("Indica o teu código primeiro");
      return finalizeFn({ data: { order_stage_ids: vars.order_stage_ids, operator_code: code } });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["stage-groups", stage] });
      qc.invalidateQueries({ queryKey: ["production"] });
      const errCount = res?.errors?.length ?? 0;
      if (errCount > 0) {
        toast.warning(`${res.processed} concluídas, ${res.skipped} ignoradas, ${errCount} com erro`, {
          description: res.errors.slice(0, 3).map((e) => e.error).join(" · "),
        });
      } else {
        toast.success(`${res.processed} concluídas` + (res.skipped ? `, ${res.skipped} já estavam` : ""));
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao concluir grupo"),
  });

  // Iniciar/Pausar/Retomar em grupo: aplica o ciclo normal de cada peça.
  const eventMut = useMutation({
    mutationFn: async (vars: { ids: string[]; event: "iniciar" | "pausar" | "retomar" }) => {
      const code = operatorCode.trim();
      if (!code) throw new Error("Indica o teu código primeiro");
      let ok = 0;
      const problems: string[] = [];
      for (const id of vars.ids) {
        const res = await eventFn({ data: { order_stage_id: id, operator_code: code, event: vars.event } });
        if ((res as any)?.ok === false) problems.push((res as any).message as string);
        else ok += 1;
      }
      return { ok, problems };
    },
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ["stage-groups", stage] });
      qc.invalidateQueries({ queryKey: ["production"] });
      const label = vars.event === "iniciar" ? "iniciadas" : vars.event === "pausar" ? "pausadas" : "retomadas";
      if (res.problems.length > 0) {
        toast.warning(`${res.ok} ${label}, ${res.problems.length} com aviso`, {
          description: res.problems.slice(0, 3).join(" · "),
        });
      } else {
        toast.success(`${res.ok} ${label}`);
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro no grupo"),
  });

  if (isLoading) {
    return <div className="text-center text-muted-foreground py-10">A carregar grupos…</div>;
  }
  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        Erro: {(error as Error).message}
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12 border border-dashed rounded-md">
        Sem peças por {stage === "corte" ? "cortar" : "produzir em estrutura"}.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <GroupCard
          key={g.key}
          group={g}
          canAct={canAct}
          pending={finalizeMut.isPending || eventMut.isPending}
          onFinalize={(ids) => finalizeMut.mutate({ order_stage_ids: ids })}
          onEvent={(ids, event) => eventMut.mutate({ ids, event })}
        />
      ))}
    </div>
  );
}

function GroupCard({
  group,
  canAct,
  pending,
  onFinalize,
  onEvent,
}: {
  group: StageGroup;
  canAct: boolean;
  pending: boolean;
  onFinalize: (ids: string[]) => void;
  onEvent: (ids: string[], event: "iniciar" | "pausar" | "retomar") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasStock = group.stock_count > 0;
  const [includeStock, setIncludeStock] = useState(true);

  const visibleItems = useMemo(
    () => (includeStock ? group.items : group.items.filter((i) => !i.is_stock_production)),
    [group.items, includeStock],
  );
  const visibleCount = visibleItems.length;

  // Cronómetro do grupo: soma dos tempos produtivos das peças, incluindo o
  // segmento a decorrer nas que estão em curso e não pausadas.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const notDone = visibleItems.filter((i) => i.status !== "concluida");
  const runningItems = notDone.filter((i) => i.status === "em_curso" && !i.is_paused);
  const pausedItems = notDone.filter((i) => i.status === "em_curso" && i.is_paused);
  const notStarted = notDone.filter((i) => i.status !== "em_curso");

  const productiveSeconds = visibleItems.reduce((acc, i) => {
    const base = i.productive_seconds ?? 0;
    const anchor = i.current_segment_started_at ?? i.started_at;
    const live =
      i.status === "em_curso" && !i.is_paused && anchor
        ? Math.max(0, Math.floor((nowMs - new Date(anchor).getTime()) / 1000))
        : 0;
    return acc + base + live;
  }, 0);
  const pausedSeconds = visibleItems.reduce((acc, i) => acc + (i.paused_seconds ?? 0), 0);

  const title =
    group.stage === "corte"
      ? `${group.model_name ?? group.model_code ?? "—"} · ${group.measure ?? "—"} · ${group.fabric_type ?? "—"}`
      : `Estrutura ${group.structure_type ?? "—"} · ${group.measure ?? "—"}`;

  const handleFinalize = () => {
    const pending = visibleItems
      .filter((i) => i.status !== "concluida")
      .map((i) => i.order_stage_id);
    if (pending.length === 0) {
      toast.info("Sem etapas pendentes neste grupo");
      return;
    }
    if (!confirm(`Concluir ${pending.length} peça(s) deste grupo?`)) return;
    onFinalize(pending);
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <button
          className="flex items-start gap-2 text-left flex-1 min-w-0"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <ChevronDown className="size-5 shrink-0 mt-0.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-5 shrink-0 mt-0.5 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <div className="text-base font-semibold leading-tight truncate">{title}</div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
              <span className="font-medium text-foreground">
                {visibleCount} {visibleCount === 1 ? "peça" : "peças"}
              </span>
              {group.client_count > 0 && (
                <span className="flex items-center gap-1">
                  <Users className="size-3" /> {group.client_count} encomenda(s)
                </span>
              )}
              {group.stock_count > 0 && (
                <span className="flex items-center gap-1">
                  <Boxes className="size-3" /> {group.stock_count} de stock
                </span>
              )}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {hasStock && (
            <div className="flex items-center gap-1.5 rounded-md border px-2 py-1.5 bg-muted/40">
              <Switch
                id={`stock-${group.key}`}
                checked={includeStock}
                onCheckedChange={setIncludeStock}
              />
              <Label htmlFor={`stock-${group.key}`} className="text-xs cursor-pointer">
                Incluir stock
              </Label>
            </div>
          )}
          {notStarted.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={!canAct || pending}
              onClick={() => onEvent(notStarted.map((i) => i.order_stage_id), "iniciar")}
              className="gap-1"
            >
              <Play className="size-4" /> Iniciar ({notStarted.length})
            </Button>
          )}
          {runningItems.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={!canAct || pending}
              onClick={() => onEvent(runningItems.map((i) => i.order_stage_id), "pausar")}
              className="gap-1"
            >
              <Pause className="size-4" /> Pausar ({runningItems.length})
            </Button>
          )}
          {pausedItems.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={!canAct || pending}
              onClick={() => onEvent(pausedItems.map((i) => i.order_stage_id), "retomar")}
              className="gap-1"
            >
              <RotateCcw className="size-4" /> Retomar ({pausedItems.length})
            </Button>
          )}
          <Button
            size="sm"
            disabled={!canAct || pending || visibleCount === 0}
            onClick={handleFinalize}
            className="gap-1"
          >
            <Check className="size-4" />
            Concluir grupo
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground border-t pt-2">
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3" /> Produtivo do lote:{" "}
          <strong className="text-foreground">{fmtDur(productiveSeconds)}</strong>
        </span>
        {pausedSeconds > 0 && <span>Pausa: {fmtDur(pausedSeconds)}</span>}
        {runningItems.length > 0 && (
          <Badge className="bg-emerald-600 text-white">{runningItems.length} a produzir</Badge>
        )}
        {pausedItems.length > 0 && (
          <Badge className="bg-amber-500 text-white">{pausedItems.length} em pausa</Badge>
        )}
      </div>

      {group.stage === "corte" && group.directional && (
        <div className="flex items-center gap-2 rounded-md border border-warning/50 bg-warning/15 px-3 py-2 text-sm font-medium">
          <AlertTriangle className="size-4 text-warning" />
          <span>Cortar no sentido do veio</span>
        </div>
      )}

      {expanded && (
        <div className="border-t pt-3 space-y-1.5">
          {visibleItems.map((it) => (
            <div
              key={it.order_stage_id}
              className="flex items-center justify-between gap-2 text-sm rounded-md border bg-card px-2.5 py-1.5"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="font-mono text-xs text-muted-foreground shrink-0">
                  {it.order_number}
                </span>
                <span className="truncate">{it.product_description}</span>
                {group.stage === "corte" && it.color && (
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {it.color}
                  </Badge>
                )}
                {group.stage === "estrutura" && it.model_name && (
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {it.model_name}
                  </Badge>
                )}
                {it.is_stock_production && (
                  <Badge className="text-[10px] bg-accent text-accent-foreground shrink-0">
                    STOCK
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Badge variant="outline" className="text-[10px]">
                  {it.status}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canAct || pending || it.status === "concluida"}
                  onClick={() => onFinalize([it.order_stage_id])}
                >
                  Concluir
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}