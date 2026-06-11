import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listModels, bulkCreateOrders, getImportMapping, saveImportMapping, checkExistingOrderNumbers, type ExistingOrderInfo } from "@/lib/orders.functions";
import { SYSTEM_FIELDS, autoGuessMapping, applyMapping, type MappedRow } from "@/lib/import-helpers";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, FileSpreadsheet, Check, X, ArrowRight, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/importar")({
  component: ImportarPage,
});

function ImportarPage() {
  const qc = useQueryClient();
  const { data: models } = useQuery({ queryKey: ["models"], queryFn: () => listModels() });
  const { data: savedMapping } = useQuery({ queryKey: ["import-mapping"], queryFn: () => getImportMapping() });

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mapped, setMapped] = useState<MappedRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [existing, setExisting] = useState<Map<string, ExistingOrderInfo>>(new Map());
  const [checkingDb, setCheckingDb] = useState(false);

  const save = useMutation({
    mutationFn: (m: Record<string, string>) => saveImportMapping({ data: { mapping: m } }),
  });

  const bulk = useMutation({
    mutationFn: (payload: any) => bulkCreateOrders({ data: payload }),
    onSuccess: (res: any) => {
      toast.success(`${res.inserted} encomenda(s) importadas. ${res.skipped.length} ignoradas.`);
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      reset();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao importar"),
  });

  function reset() {
    setStep(1);
    setRows([]);
    setHeaders([]);
    setMapped([]);
    setSelected(new Set());
    setExisting(new Map());
    setFileName("");
  }

  async function onFile(f: File) {
    setFileName(f.name);
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "", raw: false });
    if (!json.length) {
      toast.error("Ficheiro vazio ou sem dados reconhecidos");
      return;
    }
    const hdrs = Object.keys(json[0]);
    setHeaders(hdrs);
    setRows(json);
    const guess = autoGuessMapping(hdrs);
    setMapping({ ...guess, ...(savedMapping ?? {}) });
    setStep(2);
  }

  async function goValidate() {
    if (!mapping.order_number) {
      toast.error("Mapeia pelo menos o Nº Encomenda");
      return;
    }
    const out = applyMapping(rows, mapping, models ?? []);
    setMapped(out);
    // select all valid by default
    const sel = new Set<number>();
    out.forEach((r, i) => { if (r.errors.length === 0) sel.add(i); });
    setSelected(sel);
    save.mutate(mapping);
    setStep(3);
    // background BD check
    const nums = Array.from(new Set(out.map((r) => r.order_number).filter(Boolean)));
    if (nums.length) {
      setCheckingDb(true);
      try {
        const res = await checkExistingOrderNumbers({ data: { numbers: nums } });
        const m = new Map<string, ExistingOrderInfo>();
        for (const e of res) m.set(e.order_number, e);
        setExisting(m);
      } catch (e: any) {
        toast.error("Falha a verificar números na base de dados: " + (e?.message ?? ""));
      } finally {
        setCheckingDb(false);
      }
    }
  }

  // file-level duplicate groups (same order_number repeated in file)
  const fileGroups = useMemo(() => {
    const m = new Map<string, number[]>();
    mapped.forEach((r, i) => {
      if (!r.order_number) return;
      const arr = m.get(r.order_number) ?? [];
      arr.push(i);
      m.set(r.order_number, arr);
    });
    return m;
  }, [mapped]);

  const validCount = selected.size;
  const existsCount = useMemo(
    () => mapped.filter((r) => existing.has(r.order_number)).length,
    [mapped, existing],
  );
  const repeatedGroups = useMemo(
    () => Array.from(fileGroups.values()).filter((arr) => arr.length > 1).length,
    [fileGroups],
  );

  function doImport() {
    const payload = mapped
      .map((r, i) => ({ r, i }))
      .filter(({ r, i }) => r.errors.length === 0 && selected.has(i))
      .map(({ r }) => ({
        order_number: r.order_number,
        product_description: r.product_description,
        model_id: r.model_id ?? undefined,
        measure: r.measure,
        fabric_type: r.fabric_type,
        fabric_ref: r.fabric_ref,
        color: r.color,
        structure_type: r.structure_type,
        entry_date: r.entry_date ?? undefined,
        due_date: r.due_date ?? undefined,
        priority: r.priority,
        notes: r.notes,
      }));
    if (!payload.length) {
      toast.error("Nenhuma linha selecionada para importar");
      return;
    }
    bulk.mutate({ rows: payload });
  }

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Importar encomendas</h1>
        <p className="text-sm text-muted-foreground">Carregar lista de produção em Excel ou CSV</p>
      </div>

      <Stepper step={step} />

      {step === 1 && <StepUpload onFile={onFile} />}
      {step === 2 && (
        <StepMapping
          fileName={fileName}
          headers={headers}
          rows={rows}
          mapping={mapping}
          setMapping={setMapping}
          onBack={reset}
          onNext={goValidate}
        />
      )}
      {step === 3 && (
        <StepValidate
          mapped={mapped}
          setMapped={setMapped}
          selected={selected}
          setSelected={setSelected}
          existing={existing}
          fileGroups={fileGroups}
          checkingDb={checkingDb}
          validCount={validCount}
          existsCount={existsCount}
          repeatedGroups={repeatedGroups}
          onBack={() => setStep(2)}
          onImport={doImport}
          pending={bulk.isPending}
        />
      )}
    </div>
  );
}

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const labels = ["Upload", "Mapeamento", "Validação"];
  return (
    <div className="flex items-center gap-2 text-xs">
      {labels.map((l, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const active = step === n;
        const done = step > n;
        return (
          <div key={l} className="flex items-center gap-2">
            <div className={`size-6 rounded-full grid place-items-center font-bold ${done ? "bg-success text-success-foreground" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {done ? <Check className="size-3" /> : n}
            </div>
            <span className={active ? "font-medium" : "text-muted-foreground"}>{l}</span>
            {i < 2 && <ArrowRight className="size-3 text-muted-foreground mx-1" />}
          </div>
        );
      })}
    </div>
  );
}

function StepUpload({ onFile }: { onFile: (f: File) => void }) {
  const [drag, setDrag] = useState(false);
  return (
    <Card
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      className={`p-12 border-2 border-dashed transition ${drag ? "border-primary bg-primary/5" : ""}`}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <FileSpreadsheet className="size-12 text-muted-foreground" />
        <div>
          <div className="font-medium">Arrasta o ficheiro Excel/CSV aqui</div>
          <div className="text-sm text-muted-foreground">ou clica no botão abaixo</div>
        </div>
        <label>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
          />
          <Button asChild><span className="gap-2 inline-flex items-center"><Upload className="size-4" /> Escolher ficheiro</span></Button>
        </label>
      </div>
    </Card>
  );
}

function StepMapping(props: {
  fileName: string;
  headers: string[];
  rows: Record<string, any>[];
  mapping: Record<string, string>;
  setMapping: (m: Record<string, string>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { fileName, headers, rows, mapping, setMapping, onBack, onNext } = props;
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="text-sm font-medium mb-1">{fileName}</div>
        <div className="text-xs text-muted-foreground mb-3">{rows.length} linha(s) detetada(s) · pré-visualização das primeiras 5</div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>{headers.map((h) => <TableHead key={h} className="whitespace-nowrap">{h}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, 5).map((r, i) => (
                <TableRow key={i}>{headers.map((h) => <TableCell key={h} className="text-xs whitespace-nowrap">{String(r[h] ?? "")}</TableCell>)}</TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="font-medium">Mapeamento de colunas</div>
        <div className="text-xs text-muted-foreground">Confirma a correspondência entre as colunas do Excel e os campos do sistema. Vamos guardar este mapeamento para a próxima vez.</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {SYSTEM_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-xs">{f.label}{f.required && <span className="text-destructive"> *</span>}</Label>
              <Select
                value={mapping[f.key] ?? "__none"}
                onValueChange={(v) => {
                  const next = { ...mapping };
                  if (v === "__none") delete next[f.key]; else next[f.key] = v;
                  setMapping(next);
                }}
              >
                <SelectTrigger className="h-11"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— Não importar —</SelectItem>
                  {headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} className="gap-2"><ArrowLeft className="size-4" /> Voltar</Button>
        <Button onClick={onNext} className="gap-2">Validar <ArrowRight className="size-4" /></Button>
      </div>
    </div>
  );
}

function StepValidate(props: {
  mapped: MappedRow[];
  setMapped: (m: MappedRow[]) => void;
  excluded: Set<number>;
  setExcluded: (s: Set<number>) => void;
  validCount: number;
  onBack: () => void;
  onImport: () => void;
  pending: boolean;
}) {
  const { mapped, setMapped, excluded, setExcluded, validCount, onBack, onImport, pending } = props;
  const errorCount = mapped.filter((r) => r.errors.length).length;

  function toggleExclude(i: number) {
    const n = new Set(excluded);
    n.has(i) ? n.delete(i) : n.add(i);
    setExcluded(n);
  }

  function editCell(i: number, k: "order_number" | "product_description", v: string) {
    const next = [...mapped];
    next[i] = { ...next[i], [k]: v };
    // recompute order_number error
    next[i].errors = next[i].errors.filter((e) => e !== "Nº encomenda em falta");
    if (k === "order_number" && !v.trim()) next[i].errors.push("Nº encomenda em falta");
    setMapped(next);
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-center gap-4">
        <div><span className="text-2xl font-bold text-success">{validCount}</span> <span className="text-sm text-muted-foreground">válidas</span></div>
        <div><span className="text-2xl font-bold text-destructive">{errorCount}</span> <span className="text-sm text-muted-foreground">com erro</span></div>
        <div><span className="text-2xl font-bold text-muted-foreground">{excluded.size}</span> <span className="text-sm text-muted-foreground">excluídas</span></div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead></TableHead>
                <TableHead>Nº</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead>Entrada</TableHead>
                <TableHead>Saída</TableHead>
                <TableHead>Erros</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mapped.map((r, i) => {
                const isExcl = excluded.has(i);
                const ok = r.errors.length === 0 && !isExcl;
                return (
                  <TableRow key={i} className={isExcl ? "opacity-40" : ""}>
                    <TableCell>
                      {isExcl ? <Badge variant="outline">excl.</Badge>
                        : ok ? <Badge className="bg-success text-success-foreground">OK</Badge>
                        : <Badge variant="destructive">erro</Badge>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <Input value={r.order_number} onChange={(e) => editCell(i, "order_number", e.target.value)} className="h-8 w-32 text-xs" />
                    </TableCell>
                    <TableCell>
                      <Input value={r.product_description} onChange={(e) => editCell(i, "product_description", e.target.value)} className="h-8 text-xs min-w-[200px]" />
                    </TableCell>
                    <TableCell className="text-xs">{r.model_name_raw ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.entry_date ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.due_date ?? "—"}</TableCell>
                    <TableCell className="text-xs text-destructive">{r.errors.join("; ")}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => toggleExclude(i)} className="gap-1 text-xs">
                        {isExcl ? "incluir" : <><X className="size-3" /> excluir</>}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} className="gap-2"><ArrowLeft className="size-4" /> Voltar</Button>
        <Button onClick={onImport} disabled={pending || validCount === 0} size="lg">
          {pending ? "A importar…" : `Importar ${validCount} encomenda(s)`}
        </Button>
      </div>
    </div>
  );
}