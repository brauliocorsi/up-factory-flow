import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { STAGE_LABELS, STAGES_ORDER } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/tempos")({
  head: () => ({
    meta: [
      { title: "Tempos por etapa — UP Fábrica" },
      { name: "description", content: "Medianas dos tempos declarados por modelo e etapa." },
      { property: "og:title", content: "Tempos por etapa — UP Fábrica" },
      { property: "og:description", content: "Medianas dos tempos declarados por modelo e etapa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TemposAdmin,
});

type Sum = { model_id: string; stage: string; n_declaracoes: number; mediana: number | null; minimo: number | null; maximo: number | null; divergencia_pct: number | null; sla_atual: number | null };
const fmt = (n: number | null | undefined) => n == null ? "—" : Number(n).toLocaleString("pt-PT", { maximumFractionDigits: 1 });

function useMatrix() {
  return useQuery({
    queryKey: ["tempos-admin"],
    queryFn: async () => {
      const { data: cat } = await supabase.from("ref_categories").select("id").eq("code", "CAM").maybeSingle();
      const [{ data: models }, { data: sums }, { data: decls }] = await Promise.all([
        cat ? supabase.from("models").select("id, code, name").eq("active", true).eq("category_id", cat.id).order("code") : Promise.resolve({ data: [] as any[] }),
        supabase.from("v_stage_time_summary").select("*").eq("category_code", "CAM"),
        supabase.from("stage_time_declarations").select("model_id, stage, operator_id"),
      ]);
      return { models: (models ?? []) as { id: string; code: string; name: string }[], sums: (sums ?? []) as Sum[], decls: decls ?? [] };
    },
  });
}

function cellColor(s?: Sum) {
  if (!s || !s.n_declaracoes) return "bg-muted text-muted-foreground";
  if (s.n_declaracoes === 1) return "bg-yellow-200/70 dark:bg-yellow-900/50";
  return (s.divergencia_pct ?? 0) <= 25 ? "bg-green-200/70 dark:bg-green-900/50" : "bg-red-200/70 dark:bg-red-900/50";
}

function TemposAdmin() {
  const { data, isLoading } = useMatrix();
  const qc = useQueryClient();
  const [cell, setCell] = useState<{ model_id: string; stage: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const sumMap = useMemo(() => new Map((data?.sums ?? []).map((s) => [`${s.model_id}|${s.stage}`, s])), [data]);
  const ids = useMemo(() => new Set((data?.models ?? []).map((m) => m.id)), [data]);

  async function promote(args: { p_model_id?: string; p_stage?: any; p_category?: string }, label: string) {
    setBusy(true);
    const { data: n, error } = await supabase.rpc("promote_stage_times", args);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`${label}: ${n} linha(s) gravada(s) no SLA.`);
    qc.invalidateQueries({ queryKey: ["tempos-admin"] });
    qc.invalidateQueries({ queryKey: ["tempos-cell"] });
  }

  function promoteAll() {
    const n = (data?.sums ?? []).filter((s) => s.n_declaracoes > 0 && s.mediana != null).length;
    if (!confirm(`Vão ser escritas ${n} linhas no SLA (todas as etapas de todos os modelos CAM). Continuar?`)) return;
    promote({ p_category: "CAM" }, "Promover tudo");
  }

  function exportCsv() {
    if (!data) return;
    const head = ["Código", "Modelo", ...STAGES_ORDER.map((s) => STAGE_LABELS[s]), "Total minutos"];
    const rows = data.models.map((m) => {
      const vals = STAGES_ORDER.map((s) => sumMap.get(`${m.id}|${s}`)?.mediana ?? null);
      const total = vals.reduce<number>((a, v) => a + (v ?? 0), 0);
      return [m.code, m.name, ...vals.map((v) => v == null ? "" : String(v).replace(".", ",")), String(total).replace(".", ",")];
    });
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = "tempos-por-etapa-CAM.csv";
    a.click();
  }

  if (isLoading || !data) return <div className="p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold mr-auto">Tempos por etapa</h1>
        <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-1" />Exportar CSV</Button>
        <Button onClick={promoteAll} disabled={busy}>Promover tudo</Button>
      </div>

      <Tabs defaultValue="matriz">
        <TabsList><TabsTrigger value="matriz">Matriz</TabsTrigger><TabsTrigger value="campanha">Campanha</TabsTrigger></TabsList>
        <TabsContent value="matriz" className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {STAGES_ORDER.map((s) => {
              const withDecl = data.models.filter((m) => (sumMap.get(`${m.id}|${s}`)?.n_declaracoes ?? 0) > 0).length;
              const ops = new Set(data.decls.filter((d: any) => d.stage === s && ids.has(d.model_id)).map((d: any) => d.operator_id)).size;
              return (
                <div key={s} className="rounded-lg border bg-card p-2 text-sm">
                  <div className="font-medium">{STAGE_LABELS[s]}</div>
                  <div>{withDecl}/{data.models.length} modelos</div>
                  <div className="text-xs text-muted-foreground">{ops} colaborador(es)</div>
                  <Button size="sm" variant="ghost" className="h-7 px-2 mt-1 text-xs" disabled={busy}
                    onClick={() => promote({ p_stage: s, p_category: "CAM" }, `Promover ${STAGE_LABELS[s]}`)}>Promover esta etapa</Button>
                </div>
              );
            })}
          </div>
          <div className="overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2 sticky left-0 bg-muted">Modelo</th>
                  {STAGES_ORDER.map((s) => <th key={s} className="p-2">{STAGE_LABELS[s]}</th>)}
                  <th className="p-2">Total minutos</th>
                </tr>
              </thead>
              <tbody>
                {data.models.map((m) => {
                  let total = 0;
                  return (
                    <tr key={m.id} className="border-t">
                      <td className="p-2 sticky left-0 bg-background"><div className="text-xs text-muted-foreground">{m.code}</div>{m.name}</td>
                      {STAGES_ORDER.map((s) => {
                        const x = sumMap.get(`${m.id}|${s}`);
                        total += Number(x?.mediana ?? 0);
                        return (
                          <td key={s} className="p-1">
                            <button onClick={() => setCell({ model_id: m.id, stage: s })}
                              className={`w-full rounded-md p-2 text-center ${cellColor(x)}`}>
                              <div className="font-medium">{fmt(x?.mediana)}</div>
                              <div className="text-[10px] opacity-70">{x?.n_declaracoes ?? 0} decl.</div>
                            </button>
                          </td>
                        );
                      })}
                      <td className="p-2 text-center font-semibold">{fmt(total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>
        <TabsContent value="campanha"><Campaign /></TabsContent>
      </Tabs>

      <Sheet open={!!cell} onOpenChange={(o) => !o && setCell(null)}>
        <SheetContent className="overflow-y-auto">
          {cell && <CellDetail cell={cell} sum={sumMap.get(`${cell.model_id}|${cell.stage}`)}
            model={data.models.find((m) => m.id === cell.model_id)} busy={busy}
            onPromote={() => promote({ p_model_id: cell.model_id, p_stage: cell.stage as any }, "Promover célula")} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CellDetail({ cell, sum, model, busy, onPromote }: any) {
  const { data: rows = [] } = useQuery({
    queryKey: ["tempos-cell", cell.model_id, cell.stage],
    queryFn: async () => {
      const [{ data: d }, { data: sla }] = await Promise.all([
        supabase.from("stage_time_declarations").select("id, minutes, note, updated_at, operators(name)")
          .eq("model_id", cell.model_id).eq("stage", cell.stage).order("minutes"),
        supabase.from("stage_sla_model").select("expected_minutes").eq("category_code", "CAM")
          .eq("model_code", model?.code ?? "").eq("stage", cell.stage).maybeSingle(),
      ]);
      return [{ sla: sla?.expected_minutes ?? null }, ...(d ?? [])] as any[];
    },
  });
  const sla = rows[0]?.sla ?? sum?.sla_atual ?? null;
  return (
    <div className="space-y-4">
      <SheetHeader><SheetTitle>{model?.name} — {STAGE_LABELS[cell.stage]}</SheetTitle></SheetHeader>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>Mediana: <b>{fmt(sum?.mediana)}</b></div>
        <div>Mínimo: <b>{fmt(sum?.minimo)}</b></div>
        <div>Máximo: <b>{fmt(sum?.maximo)}</b></div>
        <div>SLA atual: <b>{fmt(sla)}</b></div>
      </div>
      <Button onClick={onPromote} disabled={busy || !sum?.n_declaracoes}>Promover esta célula</Button>
      <ul className="divide-y border rounded-md">
        {rows.slice(1).length === 0 && <li className="p-3 text-sm text-muted-foreground">Sem declarações.</li>}
        {rows.slice(1).map((r: any) => (
          <li key={r.id} className="p-3 text-sm">
            <div className="flex justify-between"><span className="font-medium">{r.operators?.name ?? "—"}</span><b>{fmt(r.minutes)} min</b></div>
            {r.note && <div className="text-muted-foreground">{r.note}</div>}
            <div className="text-xs text-muted-foreground">{new Date(r.updated_at).toLocaleString("pt-PT")}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Campaign() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["tempos-campanha"],
    queryFn: async () => (await supabase.from("stage_time_campaign").select("id, category_code, stage, open").order("category_code")).data ?? [],
  });
  const cats = [...new Set(data.map((d) => d.category_code))];
  async function toggle(id: string, open: boolean) {
    const { error } = await supabase.from("stage_time_campaign").update({ open }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["tempos-campanha"] });
  }
  return (
    <div className="space-y-4">
      {cats.map((c) => (
        <div key={c} className="rounded-lg border p-3">
          <div className="font-semibold mb-2">{c}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {STAGES_ORDER.map((s) => {
              const r = data.find((d) => d.category_code === c && d.stage === s);
              if (!r) return null;
              return (
                <label key={s} className="flex items-center justify-between rounded-md border p-2 text-sm">
                  {STAGE_LABELS[s]}<Switch checked={r.open} onCheckedChange={(v) => toggle(r.id, v)} />
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
