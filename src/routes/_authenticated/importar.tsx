import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listModels, bulkCreateOrders, getImportMapping, saveImportMapping, checkExistingOrderNumbers, type ExistingOrderInfo } from "@/lib/orders.functions";
import { SYSTEM_FIELDS, autoGuessMapping, applyMapping, type MappedRow } from "@/lib/import-helpers";
import { bulkUpsertProductSla } from "@/lib/sla.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, FileSpreadsheet, Check, X, ArrowRight, ArrowLeft, Download } from "lucide-react";
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
    onSuccess: async (res: any) => {
      // A seguir à criação das encomendas, escrever os overrides de SLA por
      // produto vindos do Excel (só para linhas com códigos completos).
      const slaRows = mapped
        .filter((r, i) => r.errors.length === 0 && selected.has(i))
        .flatMap((r) => {
          if (!r.category_code || !r.model_code || !r.structure_code || !r.measure_code) return [];
          return Object.entries(r.sla).map(([stage, minutes]) => ({
            category_code: r.category_code!,
            model_code: r.model_code!,
            structure_code: r.structure_code!,
            measure_code: r.measure_code!,
            stage: stage as any,
            expected_minutes: minutes!,
          }));
        });
      if (slaRows.length > 0) {
        try {
          await bulkUpsertProductSla({ data: { rows: slaRows } });
          toast.success(`${slaRows.length} tempo(s) previsto(s) por produto guardado(s)`);
        } catch (e: any) {
          toast.error("Encomendas importadas, mas falhou gravar SLA: " + (e?.message ?? ""));
        }
      }
      toast.success(`${res.inserted} encomenda(s) importadas. ${res.skipped.length} ignoradas.`);
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      reset();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao importar"),
  });

  function downloadTemplate() {
    const headers = [
      "Nº Encomenda", "Descrição", "Modelo (nome)", "Modelo (código)", "Estrutura (código)",
      "Medida (código)", "Categoria (código)", "Medida", "Tipo de tecido", "Ref. tecido", "Cor",
      "Tipo de estrutura", "Data de entrada", "Data saída prevista", "Prioridade",
      "SLA Estrutura (min)", "SLA Corte (min)", "SLA Costura (min)", "SLA Branco (min)",
      "SLA Estofagem (min)", "SLA Qualidade (min)", "SLA Embalagem (min)", "SLA Picagem (min)",
    ];
    const ex1 = ["2026-0099","Cama Lisa 160","Lisa","LISA","MAD","160","CAM","160x200","Pano","REF-001","Bege","Madeira","2026-01-10","2026-01-20",5, 30,45,60,20,90,10,15,5];
    const ex2 = ["2026-0100","Sofá Conforto 3L","Conforto","CONFORTO","MAD","3L","SOF","3 lugares","Pano","REF-002","Cinza","Madeira","2026-01-11","2026-01-25",3, 40,50,80,25,120,15,20,5];
    const ws = XLSX.utils.aoa_to_sheet([headers, ex1, ex2]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Encomendas");
    XLSX.writeFile(wb, "modelo-importacao-up-producao.xlsx");
  }

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
      <div>
        <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-2">
          <Download className="size-4" /> Descarregar modelo Excel
        </Button>
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
  selected: Set<number>;
  setSelected: (s: Set<number>) => void;
  existing: Map<string, ExistingOrderInfo>;
  fileGroups: Map<string, number[]>;
  checkingDb: boolean;
  validCount: number;
  existsCount: number;
  repeatedGroups: number;
  onBack: () => void;
  onImport: () => void;
  pending: boolean;
}) {
  const { mapped, setMapped, selected, setSelected, existing, fileGroups, checkingDb,
    validCount, existsCount, repeatedGroups, onBack, onImport, pending } = props;
  const errorCount = mapped.filter((r) => r.errors.length).length;

  function toggleSelected(i: number) {
    const n = new Set(selected);
    n.has(i) ? n.delete(i) : n.add(i);
    setSelected(n);
  }

  function selectAll(check: boolean) {
    if (!check) { setSelected(new Set()); return; }
    const n = new Set<number>();
    mapped.forEach((r, i) => { if (r.errors.length === 0) n.add(i); });
    setSelected(n);
  }

  function deselectExisting() {
    const n = new Set(selected);
    mapped.forEach((r, i) => { if (existing.has(r.order_number)) n.delete(i); });
    setSelected(n);
  }

  function editCell(i: number, k: "order_number" | "product_description", v: string) {
    const next = [...mapped];
    next[i] = { ...next[i], [k]: v };
    next[i].errors = next[i].errors.filter((e) => e !== "Nº encomenda em falta");
    if (k === "order_number" && !v.trim()) next[i].errors.push("Nº encomenda em falta");
    setMapped(next);
    // ensure rows with errors are not selected
    if (next[i].errors.length > 0 && selected.has(i)) {
      const s = new Set(selected); s.delete(i); setSelected(s);
    }
  }

  const allSelectable = mapped.filter((r) => r.errors.length === 0).length;
  const allChecked = allSelectable > 0 && selected.size >= allSelectable;

  // assign a group index to colour rows that share an order_number in the file
  const groupIndex = useMemo(() => {
    const m = new Map<string, number>();
    let idx = 0;
    for (const [num, arr] of fileGroups) {
      if (arr.length > 1) { m.set(num, idx); idx++; }
    }
    return m;
  }, [fileGroups]);
  const groupBg = ["bg-blue-500/5", "bg-amber-500/5", "bg-emerald-500/5", "bg-violet-500/5", "bg-rose-500/5"];

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div><span className="text-2xl font-bold">{mapped.length}</span> <span className="text-sm text-muted-foreground">linhas no ficheiro</span></div>
        <div><span className="text-2xl font-bold text-success">{validCount}</span> <span className="text-sm text-muted-foreground">selecionadas para importar</span></div>
        <div><span className="text-2xl font-bold text-amber-600">{existsCount}</span> <span className="text-sm text-muted-foreground">já existem na BD {checkingDb && "(a verificar…)"}</span></div>
        <div><span className="text-2xl font-bold text-primary">{repeatedGroups}</span> <span className="text-sm text-muted-foreground">grupos com nº repetido</span></div>
        <div><span className="text-2xl font-bold text-destructive">{errorCount}</span> <span className="text-sm text-muted-foreground">com erro</span></div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={deselectExisting} disabled={existsCount === 0}>
            Desselecionar as que já existem na BD
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <TooltipProvider>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox checked={allChecked} onCheckedChange={(v) => selectAll(Boolean(v))} aria-label="Selecionar tudo" />
                </TableHead>
                <TableHead>Nº</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead>Entrada</TableHead>
                <TableHead>Saída</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mapped.map((r, i) => {
                const hasError = r.errors.length > 0;
                const isSel = selected.has(i);
                const exists = existing.get(r.order_number);
                const groupSize = fileGroups.get(r.order_number)?.length ?? 1;
                const gIdx = groupIndex.get(r.order_number);
                const rowBg = gIdx != null ? groupBg[gIdx % groupBg.length] : "";
                return (
                  <TableRow key={i} className={`${rowBg} ${!isSel && !hasError ? "opacity-60" : ""}`}>
                    <TableCell>
                      <Checkbox
                        checked={isSel}
                        disabled={hasError}
                        onCheckedChange={() => toggleSelected(i)}
                        aria-label="Selecionar linha"
                      />
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
                    <TableCell className="text-xs">
                      <div className="flex flex-wrap gap-1">
                        {hasError && (
                          <Badge variant="destructive" title={r.errors.join("; ")}>Erro: {r.errors.join("; ")}</Badge>
                        )}
                        {!hasError && !exists && groupSize === 1 && (
                          <Badge className="bg-success text-success-foreground">OK</Badge>
                        )}
                        {exists && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge className="bg-amber-500 text-white cursor-help">
                                Já existe na BD ({exists.count} cama{exists.count > 1 ? "s" : ""})
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <div className="text-xs">
                                <div className="font-semibold mb-1">Nº {exists.order_number} na base de dados:</div>
                                <ul className="list-disc pl-4">
                                  {exists.products.map((p, k) => <li key={k}>{p}</li>)}
                                </ul>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {groupSize > 1 && (
                          <Badge variant="outline" className="border-primary text-primary">
                            Repetido no ficheiro (grupo de {groupSize})
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </TooltipProvider>
        </div>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} className="gap-2"><ArrowLeft className="size-4" /> Voltar</Button>
        <Button onClick={onImport} disabled={pending || validCount === 0} size="lg">
          {pending ? "A importar…" : `Importar ${validCount} selecionada(s)`}
        </Button>
      </div>
    </div>
  );
}