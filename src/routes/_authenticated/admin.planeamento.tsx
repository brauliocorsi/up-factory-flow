import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertTriangle, BarChart3, Save } from "lucide-react";
import { STAGE_LABELS } from "@/lib/format";
import {
  STAGES, listLeadOffsets, upsertLeadOffset,
  getDailyMinutes, setDailyMinutes,
  listOperatorsByStage, setDayPresence,
  getGlobalCapacityLoad, type GlobalLoadCell,
  countBacklogBatches,
  type Stage,
} from "@/lib/planning.functions";
import { BacklogTable } from "@/components/planning/BacklogTable";
import { ActivationSuggestions } from "@/components/planning/ActivationSuggestions";
import { LoadCell } from "@/components/planning/LoadCell";
import { formatDatePT } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin/planeamento")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase
      .from("user_roles").select("role").eq("user_id", data.user.id);
    const list = (roles ?? []).map((r: any) => r.role as string);
    if (!list.includes("admin") && !list.includes("escritorio")) {
      throw redirect({ to: "/producao" });
    }
  },
  component: PlaneamentoAdminPage,
  errorComponent: ({ error, reset }) => (
    <div className="max-w-xl mx-auto p-6 text-center space-y-3">
      <AlertTriangle className="size-8 text-orange-600 mx-auto" />
      <h2 className="text-lg font-semibold">Erro a carregar planeamento</h2>
      <p className="text-sm text-muted-foreground">{error?.message}</p>
      <Button onClick={() => reset()}>Tentar novamente</Button>
    </div>
  ),
});

function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

function PlaneamentoAdminPage() {
  const fetchBatches = useServerFn(countBacklogBatches);
  const { data: batches } = useQuery({
    queryKey: ["backlog-batches-summary"],
    queryFn: () => fetchBatches(),
    refetchInterval: 60_000,
  });
  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Planeamento</h1>
          <p className="text-sm text-muted-foreground">
            Folgas por etapa, jornada padrão e presenças do dia.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {batches && batches.total_groups > 0 && (
            <span
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium ${
                batches.urgent_groups > 0
                  ? "border-red-400 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                  : "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
              }`}
              title={`${batches.total_orders_in_groups} encomenda(s) em ${batches.total_groups} grupo(s)`}
            >
              ⚡ {batches.total_groups} lote(s) potenciais
              {batches.urgent_groups > 0 && <> · {batches.urgent_groups} urgente(s)</>}
            </span>
          )}
          <Link
            to="/admin/planeamento/carga"
            className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            <BarChart3 className="size-4" /> Ver carga vs capacidade
          </Link>
        </div>
      </div>

      <Tabs defaultValue="backlog" className="space-y-4">
        <TabsList>
          <TabsTrigger value="backlog">Backlog</TabsTrigger>
          <TabsTrigger value="carga">Carga global</TabsTrigger>
          <TabsTrigger value="folgas">Folgas</TabsTrigger>
          <TabsTrigger value="jornada">Jornada</TabsTrigger>
          <TabsTrigger value="presencas">Presenças do dia</TabsTrigger>
        </TabsList>

        <TabsContent value="backlog">
          <div className="space-y-3">
            <ActivationSuggestions />
            <BacklogTable />
          </div>
        </TabsContent>
        <TabsContent value="carga">
          <CargaGlobalTab />
        </TabsContent>

        <TabsContent value="folgas">
          <FolgasTab />
        </TabsContent>
        <TabsContent value="jornada">
          <JornadaTab />
        </TabsContent>
        <TabsContent value="presencas">
          <PresencasTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FolgasTab() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listLeadOffsets);
  const upsertFn = useServerFn(upsertLeadOffset);
  const { data: list = [] } = useQuery({ queryKey: ["lead-offsets"], queryFn: () => fetchList() });

  const map = useMemo(() => {
    const m = new Map<Stage, number>();
    for (const r of list) m.set(r.stage, r.days_before_estofo);
    return m;
  }, [list]);

  const mut = useMutation({
    mutationFn: (v: { stage: Stage; days_before_estofo: number }) => upsertFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-offsets"] });
      toast.success("Folga guardada");
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro a guardar"),
  });

  return (
    <Card className="p-4">
      <p className="text-sm text-muted-foreground mb-3">
        Folga em dias úteis antes do <strong>estofo</strong> (data de saída).
        O estofo é o marco 0. As outras etapas devem estar prontas com esta antecedência.
        É um alvo, nunca bloqueia o operador.
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        {STAGES.map((s) => (
          <FolgaRow
            key={s}
            stage={s}
            value={map.get(s) ?? 0}
            onSave={(v) => mut.mutate({ stage: s, days_before_estofo: v })}
          />
        ))}
      </div>
    </Card>
  );
}

function FolgaRow({ stage, value, onSave }: { stage: Stage; value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => { setV(String(value)); }, [value]);
  return (
    <div className="flex items-center gap-2 rounded-md border p-2">
      <div className="flex-1 text-sm font-medium">{STAGE_LABELS[stage]}</div>
      <Input
        type="number" min={0} max={60}
        value={v} onChange={(e) => setV(e.target.value)}
        className="w-20 text-right"
      />
      <span className="text-xs text-muted-foreground">d</span>
      <Button size="sm" variant="outline" onClick={() => onSave(Number(v) || 0)} className="gap-1">
        <Save className="size-3.5" />
      </Button>
    </div>
  );
}

function JornadaTab() {
  const qc = useQueryClient();
  const fetchFn = useServerFn(getDailyMinutes);
  const setFn = useServerFn(setDailyMinutes);
  const { data: current } = useQuery({ queryKey: ["daily-minutes"], queryFn: () => fetchFn() });
  const [v, setV] = useState("450");
  useEffect(() => { if (typeof current === "number") setV(String(current)); }, [current]);

  const mut = useMutation({
    mutationFn: () => setFn({ data: { daily_minutes: Number(v) || 450 } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["daily-minutes"] });
      toast.success("Jornada atualizada");
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro a guardar"),
  });

  return (
    <Card className="p-4 max-w-md">
      <Label className="text-sm font-medium">Minutos de trabalho por dia (por pessoa)</Label>
      <p className="text-xs text-muted-foreground mb-2">
        Base do cálculo de capacidade. Ex.: 450 = 7h30.
      </p>
      <div className="flex gap-2">
        <Input type="number" min={60} max={1440} value={v} onChange={(e) => setV(e.target.value)} />
        <Button onClick={() => mut.mutate()} disabled={mut.isPending}>Guardar</Button>
      </div>
    </Card>
  );
}

function PresencasTab() {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayISO());
  const fetchList = useServerFn(listOperatorsByStage);
  const setFn = useServerFn(setDayPresence);
  const { data = [] } = useQuery({
    queryKey: ["day-assignments", date],
    queryFn: () => fetchList({ data: { work_date: date } }),
  });

  const mut = useMutation({
    mutationFn: (v: { operator_id: string; stage: Stage; present: boolean }) =>
      setFn({ data: { ...v, work_date: date } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["day-assignments", date] }),
    onError: (e: any) => toast.error(e?.message ?? "Erro a guardar"),
  });

  const byStage = useMemo(() => {
    const m = new Map<Stage, typeof data>();
    for (const r of data) {
      const arr = m.get(r.stage as Stage) ?? [];
      arr.push(r);
      m.set(r.stage as Stage, arr);
    }
    return m;
  }, [data]);

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Label className="text-sm">Dia</Label>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
      </div>
      <p className="text-xs text-muted-foreground">
        Desligar uma pessoa reduz a capacidade calculada para essa etapa nesse dia. Por defeito, todos os atribuídos estão presentes.
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        {STAGES.map((s) => {
          const rows = byStage.get(s) ?? [];
          if (rows.length === 0) return null;
          return (
            <Card key={s} className="p-3">
              <div className="text-sm font-semibold mb-2">{STAGE_LABELS[s]}</div>
              <div className="space-y-1">
                {rows.map((r: any) => (
                  <div key={r.operator_id + s} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      <span className="font-mono text-xs text-muted-foreground mr-1.5">{r.operator_code}</span>
                      {r.operator_name}
                    </span>
                    <Switch
                      checked={r.present}
                      onCheckedChange={(checked) =>
                        mut.mutate({ operator_id: r.operator_id, stage: s, present: !!checked })
                      }
                    />
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </Card>
  );
}

// ---------- Carga global (Fase B) ----------

function addBusinessDaysISO(start: Date, n: number): string {
  const d = new Date(start);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

function CargaGlobalTab() {
  const today = new Date();
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(addBusinessDaysISO(today, 10));
  const fetchFn = useServerFn(getGlobalCapacityLoad);
  const { data = [], isLoading } = useQuery({
    queryKey: ["global-load", from, to],
    queryFn: () => fetchFn({ data: { from, to } }),
    refetchInterval: 60_000,
  });

  const { days, byStage, stages, hasUnknown } = useMemo(() => {
    const rows = data as GlobalLoadCell[];
    const daysSet = new Set<string>();
    const stagesSet = new Set<Stage>();
    const map = new Map<string, GlobalLoadCell>();
    let unknown = false;
    for (const r of rows) {
      daysSet.add(r.date);
      stagesSet.add(r.stage as Stage);
      map.set(`${r.stage}|${r.date}`, r);
      if (r.has_unknown) unknown = true;
    }
    const ds = Array.from(daysSet).sort();
    const ordered: Stage[] = STAGES.filter((s) => stagesSet.has(s));
    return { days: ds, byStage: map, stages: ordered, hasUnknown: unknown };
  }, [data]);

  return (
    <div className="space-y-3">
      <Card className="p-3 flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">De</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">Até</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <div className="ml-auto text-xs text-muted-foreground max-w-md">
          <span className="inline-block size-2 rounded bg-emerald-500 mr-1 align-middle" />
          sólido = ativado (stock reservado) ·{" "}
          <span className="inline-block w-3 h-2 mr-1 align-middle" style={{ backgroundImage: "repeating-linear-gradient(135deg, hsl(var(--foreground)/0.45) 0 4px, transparent 4px 8px)" }} />
          tracejado = backlog previsto ·{" "}
          <span className="inline-block w-3 h-2 mr-1 align-middle border border-red-400 border-dashed" />
          contorno = potencial sobrecarga
        </div>
      </Card>

      {hasUnknown && (
        <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 text-sm">
          ⚠ Alguns produtos não têm SLA cadastrado — a carga apresentada está subestimada.
        </div>
      )}

      <Card className="p-0 overflow-x-auto">
        {isLoading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">A calcular…</div>
        ) : days.length === 0 || stages.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Sem dias úteis no intervalo.</div>
        ) : (
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead className="bg-muted/50 text-xs">
              <tr>
                <th className="text-left p-2 sticky left-0 bg-muted/50 z-10">Etapa</th>
                {days.map((d) => (
                  <th key={d} className="p-2 text-center min-w-[110px]">
                    {formatDatePT(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stages.map((s) => (
                <tr key={s} className="border-t">
                  <td className="p-2 font-medium sticky left-0 bg-card border-t">
                    <Link
                      to="/admin/planeamento/carga"
                      search={{ stage: s } as any}
                      className="hover:underline"
                    >
                      {STAGE_LABELS[s]}
                    </Link>
                  </td>
                  {days.map((d) => {
                    const cell = byStage.get(`${s}|${d}`);
                    return (
                      <td key={d} className="p-2 align-top border-t">
                        {cell ? (
                          <LoadCell
                            capacity={cell.capacity_minutes}
                            firm={cell.load_firm_minutes}
                            shadow={cell.load_shadow_minutes}
                            itemsFirm={cell.items_firm}
                            itemsShadow={cell.items_shadow}
                          />
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}