import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertTriangle, Download, Save, Trash2 } from "lucide-react";
import { STAGE_LABELS } from "@/lib/format";
import { getCatalogs } from "@/lib/catalog.functions";
import {
  STAGES, listCategorySla, upsertCategorySla,
  listProductSla, upsertProductSla, type Stage,
} from "@/lib/sla.functions";

export const Route = createFileRoute("/_authenticated/admin/sla")({
  component: SlaPage,
  errorComponent: ({ error, reset }) => (
    <div className="max-w-xl mx-auto p-6 text-center space-y-3">
      <AlertTriangle className="size-8 text-orange-600 mx-auto" />
      <h2 className="text-lg font-semibold">Erro a carregar SLA</h2>
      <p className="text-sm text-muted-foreground">{error?.message}</p>
      <Button onClick={() => reset()}>Tentar novamente</Button>
    </div>
  ),
});

function SlaPage() {
  const qc = useQueryClient();
  const { data: catalogs } = useQuery({ queryKey: ["catalogs"], queryFn: () => getCatalogs() });
  const { data: catSla = [] } = useQuery({ queryKey: ["sla-cat"], queryFn: () => listCategorySla() });
  const { data: prodSla = [] } = useQuery({ queryKey: ["sla-prod"], queryFn: () => listProductSla() });

  const categories = (catalogs?.categories ?? []) as { code: string; name: string }[];
  const models = (catalogs?.models ?? []) as { code: string; name: string; category_id: string | null }[];
  const structures = (catalogs?.structures ?? []) as { code: string; name: string }[];
  const measures = (catalogs?.measures ?? []) as { code: string; name: string }[];

  const catSlaMutation = useMutation({
    mutationFn: (v: { category_code: string; stage: Stage; expected_minutes: number | null }) =>
      upsertCategorySla({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sla-cat"] });
      toast.success("Padrão guardado");
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro a guardar"),
  });

  const prodSlaMutation = useMutation({
    mutationFn: (v: any) => upsertProductSla({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sla-prod"] });
      toast.success("Override guardado");
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro a guardar"),
  });

  // Mapa rápido categoria+etapa -> minutos
  const catMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of catSla) m.set(`${r.category_code}|${r.stage}`, r.expected_minutes);
    return m;
  }, [catSla]);

  function downloadTemplate() {
    const headers = [
      "Nº Encomenda", "Descrição", "Modelo (código)", "Estrutura (código)",
      "Medida (código)", "Categoria (código)",
      ...STAGES.map((s) => `SLA ${STAGE_LABELS[s]} (min)`),
    ];
    const example1 = ["2026-0099", "Cama Lisa 160", "LISA", "MAD", "160", "CAM", 30, 45, 60, 20, 90, 10, 15, 5];
    const example2 = ["2026-0100", "Sofá Conforto 3L", "CONFORTO", "MAD", "3L", "SOF", 40, 50, 80, 25, 120, 15, 20, 5];
    const ws = XLSX.utils.aoa_to_sheet([headers, example1, example2]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Encomendas");
    XLSX.writeFile(wb, "modelo-importacao-up-producao.xlsx");
  }

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">SLA — Tempos previstos</h1>
          <p className="text-sm text-muted-foreground">
            Tempo previsto por etapa: padrão por categoria, override por produto.
          </p>
        </div>
        <Button variant="outline" onClick={downloadTemplate} className="gap-2">
          <Download className="size-4" /> Descarregar modelo Excel
        </Button>
      </div>

      <Tabs defaultValue="categoria">
        <TabsList>
          <TabsTrigger value="categoria">Padrão por categoria</TabsTrigger>
          <TabsTrigger value="produto">Override por produto</TabsTrigger>
        </TabsList>

        <TabsContent value="categoria" className="space-y-3 mt-3">
          {categories.length === 0 && (
            <Card className="p-4 text-sm text-muted-foreground">Sem categorias no catálogo.</Card>
          )}
          {categories.map((c) => (
            <Card key={c.code} className="p-4 space-y-3">
              <div className="font-semibold">
                {c.name} <Badge variant="secondary" className="ml-2">{c.code}</Badge>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {STAGES.map((s) => {
                  const current = catMap.get(`${c.code}|${s}`);
                  return (
                    <SlaCell
                      key={s}
                      label={STAGE_LABELS[s]}
                      initial={current}
                      onSave={(v) => catSlaMutation.mutate({
                        category_code: c.code, stage: s, expected_minutes: v,
                      })}
                    />
                  );
                })}
              </div>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="produto" className="space-y-3 mt-3">
          <ProductOverrideSection
            categories={categories}
            models={models}
            structures={structures}
            measures={measures}
            catMap={catMap}
            prodSla={prodSla}
            onSave={(v) => prodSlaMutation.mutate(v)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SlaCell({ label, initial, onSave }: { label: string; initial?: number; onSave: (v: number | null) => void }) {
  const [v, setV] = useState<string>(initial != null ? String(initial) : "");
  const dirty = String(initial ?? "") !== v;
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-1">
        <Input
          type="number" min={1} placeholder="—" value={v}
          onChange={(e) => setV(e.target.value)}
          className="h-9"
        />
        <Button
          size="sm" variant={dirty ? "default" : "outline"}
          disabled={!dirty}
          onClick={() => {
            const num = v.trim() === "" ? null : Number(v);
            if (num != null && (!Number.isFinite(num) || num <= 0)) {
              return;
            }
            onSave(num);
          }}
          aria-label="Guardar"
        >
          <Save className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ProductOverrideSection({
  categories, models, structures, measures, catMap, prodSla, onSave,
}: {
  categories: { code: string; name: string }[];
  models: { code: string; name: string; category_id: string | null }[];
  structures: { code: string; name: string }[];
  measures: { code: string; name: string }[];
  catMap: Map<string, number>;
  prodSla: Array<{ category_code: string; model_code: string; structure_code: string; measure_code: string; stage: Stage; expected_minutes: number }>;
  onSave: (v: any) => void;
}) {
  const [cat, setCat] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [struct, setStruct] = useState<string>("");
  const [meas, setMeas] = useState<string>("");

  const overridesMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of prodSla) m.set(`${r.category_code}|${r.model_code}|${r.structure_code}|${r.measure_code}|${r.stage}`, r.expected_minutes);
    return m;
  }, [prodSla]);

  const ready = cat && model && struct && meas;

  return (
    <Card className="p-4 space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <Label className="text-xs">Categoria</Label>
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {categories.map((c) => <SelectItem key={c.code} value={c.code}>{c.name} ({c.code})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Modelo</Label>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {models.map((m) => <SelectItem key={m.code} value={m.code}>{m.name} ({m.code})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Estrutura</Label>
          <Select value={struct} onValueChange={setStruct}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {structures.map((s) => <SelectItem key={s.code} value={s.code}>{s.name} ({s.code})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Medida</Label>
          <Select value={meas} onValueChange={setMeas}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {measures.map((m) => <SelectItem key={m.code} value={m.code}>{m.name} ({m.code})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!ready ? (
        <p className="text-sm text-muted-foreground">Escolhe categoria, modelo, estrutura e medida para definir os tempos.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {STAGES.map((s) => {
            const ov = overridesMap.get(`${cat}|${model}|${struct}|${meas}|${s}`);
            const fallback = catMap.get(`${cat}|${s}`);
            return (
              <div key={s} className="space-y-1">
                <Label className="text-xs flex items-center justify-between">
                  <span>{STAGE_LABELS[s]}</span>
                  {ov != null ? (
                    <Badge variant="default" className="text-[10px]">override</Badge>
                  ) : fallback != null ? (
                    <Badge variant="secondary" className="text-[10px]">padrão {fallback}m</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">sem SLA</Badge>
                  )}
                </Label>
                <OverrideCell
                  initial={ov}
                  fallback={fallback}
                  onSave={(v) => onSave({
                    category_code: cat, model_code: model, structure_code: struct, measure_code: meas,
                    stage: s, expected_minutes: v,
                  })}
                />
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function OverrideCell({ initial, fallback, onSave }: { initial?: number; fallback?: number; onSave: (v: number | null) => void }) {
  const [v, setV] = useState<string>(initial != null ? String(initial) : "");
  const dirty = String(initial ?? "") !== v;
  return (
    <div className="flex gap-1">
      <Input
        type="number" min={1}
        placeholder={fallback != null ? `padrão ${fallback}` : "—"}
        value={v} onChange={(e) => setV(e.target.value)}
        className="h-9"
      />
      <Button
        size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty}
        onClick={() => {
          const num = v.trim() === "" ? null : Number(v);
          if (num != null && (!Number.isFinite(num) || num <= 0)) return;
          onSave(num);
        }}
        aria-label="Guardar"
      >
        <Save className="size-3.5" />
      </Button>
      {initial != null && (
        <Button
          size="sm" variant="ghost"
          onClick={() => { setV(""); onSave(null); }}
          aria-label="Remover"
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
}