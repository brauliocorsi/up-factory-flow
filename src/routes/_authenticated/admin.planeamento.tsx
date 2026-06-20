import { createFileRoute, Link } from "@tanstack/react-router";
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
  type Stage,
} from "@/lib/planning.functions";
import { BacklogTable } from "@/components/planning/BacklogTable";
import { ActivationSuggestions } from "@/components/planning/ActivationSuggestions";
import { LoadCell } from "@/components/planning/LoadCell";
import { formatDatePT } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin/planeamento")({
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
  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Planeamento</h1>
          <p className="text-sm text-muted-foreground">
            Folgas por etapa, jornada padrão e presenças do dia.
          </p>
        </div>
        <Link
          to="/admin/planeamento/carga"
          className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          <BarChart3 className="size-4" /> Ver carga vs capacidade
        </Link>
      </div>

      <Tabs defaultValue="folgas" className="space-y-4">
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