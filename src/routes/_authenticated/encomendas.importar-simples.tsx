import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { bulkImportSimpleOrders } from "@/lib/orders.functions";
import { getCatalogs } from "@/lib/catalog.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, FileSpreadsheet, Download, AlertCircle, CheckCircle2, ArrowLeft, ArrowRight, Zap } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/encomendas/importar-simples")({
  component: ImportarSimplesPage,
});

// Segments (idênticos ao formulário de Nova Encomenda)
const SEGMENTS = [
  { key: "category", len: 3 },
  { key: "model", len: 3 },
  { key: "structure", len: 2 },
  { key: "measure", len: 3 },
  { key: "fabric_type", len: 2 },
  { key: "fabric_ref", len: 2 },
  { key: "color", len: 2 },
  { key: "finishing", len: 1 },
] as const;
const EXPECTED_LEN = SEGMENTS.reduce((a, s) => a + s.len, 0);

const DEFAULT_FIELDS = {
  code: ["código", "codigo", "code"],
  qty: ["quantidade", "qtd", "qty", "qtde"],
  customer_order: ["nº encomenda", "no encomenda", "n encomenda", "encomenda", "nº", "no"],
  due_date: ["prazo", "prazo de entrega", "data entrega", "entrega"],
};

function normalize(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function guessHeader(headers: string[], cands: string[]): string | undefined {
  const norm = headers.map((h) => [h, normalize(String(h))] as const);
  for (const c of cands) {
    const found = norm.find(([, n]) => n === c || n.includes(c));
    if (found) return found[0];
  }
  return undefined;
}

function parseDateMaybe(v: any): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yy] = m;
    if (yy.length === 2) yy = "20" + yy;
    const iso = `${yy.padStart(4, "0")}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    return isNaN(new Date(iso).getTime()) ? null : iso;
  }
  const m2 = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m2 ? m2[0] : null;
}

function splitCode(raw: string) {
  const code = (raw || "").replace(/\s+/g, "").toUpperCase();
  const segs: Record<string, string> = {};
  let i = 0;
  for (const s of SEGMENTS) {
    segs[s.key] = code.slice(i, i + s.len);
    i += s.len;
  }
  return { code, segs };
}

type DecodedRow = {
  excel_row: number; // 1-based incl. header
  raw: { code: string; qty: any; customer_order: string; due_date: any };
  ok: boolean;
  errors: string[];
  // resolved fields:
  customer_order: string;
  quantity: number;
  due_date: string | null;
  product_description: string;
  model_id: string | null;
  measure: string | null;
  fabric_type: string | null;
  fabric_ref: string | null;
  color: string | null;
  structure_type: string | null;
  finishing: "F" | "N" | null;
  barcode_base: string;
};

function ImportarSimplesPage() {
  const qc = useQueryClient();
  const { data: cat } = useQuery({ queryKey: ["catalogs"], queryFn: () => getCatalogs() });

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [mapping, setMapping] = useState<{ code?: string; qty?: string; customer_order?: string; due_date?: string }>({});
  const [decoded, setDecoded] = useState<DecodedRow[]>([]);
  const [lastHints, setLastHints] = useState<Array<{ kind: string; label: string; count: number }>>([]);

  const bulk = useMutation({
    mutationFn: (payload: any) => bulkImportSimpleOrders({ data: payload }),
    onSuccess: (res: any) => {
      toast.success(`${res.created} encomenda(s) criadas em ${res.notes} nota(s) — backlog (pendentes).`);
      setLastHints(res.batch_hints ?? []);
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["backlog"] });
      qc.invalidateQueries({ queryKey: ["activation-suggestions"] });
      qc.invalidateQueries({ queryKey: ["backlog-batches-summary"] });
      reset();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao importar"),
  });

  function reset() {
    setStep(1); setFileName(""); setHeaders([]); setRows([]); setMapping({}); setDecoded([]);
  }

  function downloadTemplate() {
    const hdrs = ["Código", "Quantidade", "Nº Encomenda", "Prazo de Entrega"];
    const ex1 = ["CAM00101160010102N", 2, "1234", "2026-07-15"];
    const ex2 = ["CAM00101180010102F", 1, "1234", ""];
    const ws = XLSX.utils.aoa_to_sheet([hdrs, ex1, ex2]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Encomendas");
    XLSX.writeFile(wb, "modelo-importacao-simples.xlsx");
  }

  function downloadErrors() {
    const bad = decoded.filter((r) => !r.ok);
    if (!bad.length) return;
    const hdrs = ["Código", "Quantidade", "Nº Encomenda", "Prazo de Entrega", "Motivo"];
    const aoa = [hdrs, ...bad.map((b) => [b.raw.code, b.raw.qty, b.raw.customer_order, b.raw.due_date ?? "", b.errors.join(" · ")])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "A corrigir");
    XLSX.writeFile(wb, "linhas-com-erro.xlsx");
  }

  async function onFile(f: File) {
    setFileName(f.name);
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "", raw: false });
    if (!json.length) { toast.error("Ficheiro vazio"); return; }
    const hdrs = Object.keys(json[0]);
    setHeaders(hdrs);
    setRows(json);
    setMapping({
      code: guessHeader(hdrs, DEFAULT_FIELDS.code),
      qty: guessHeader(hdrs, DEFAULT_FIELDS.qty),
      customer_order: guessHeader(hdrs, DEFAULT_FIELDS.customer_order),
      due_date: guessHeader(hdrs, DEFAULT_FIELDS.due_date),
    });
    setStep(2);
  }

  function decodeRow(r: Record<string, any>, idx: number): DecodedRow {
    const errs: string[] = [];
    const raw = {
      code: String(r[mapping.code ?? ""] ?? "").trim(),
      qty: r[mapping.qty ?? ""],
      customer_order: String(r[mapping.customer_order ?? ""] ?? "").trim(),
      due_date: r[mapping.due_date ?? ""] ?? null,
    };
    if (!raw.customer_order) errs.push("Nº Encomenda em falta");
    const qty = Number(String(raw.qty ?? "").replace(",", "."));
    if (!Number.isFinite(qty) || qty < 1 || !Number.isInteger(qty)) errs.push("Quantidade inválida");
    const { code, segs } = splitCode(raw.code);
    if (!code) errs.push("Código em falta");
    else if (code.length !== EXPECTED_LEN) errs.push(`Código tem ${code.length} caracteres (esperados ${EXPECTED_LEN})`);

    const category = cat?.categories.find((x: any) => x.code === segs.category);
    if (code.length === EXPECTED_LEN && !category) errs.push(`Categoria '${segs.category}' não existe`);
    let model = (cat?.models ?? []).find((m: any) => m.code === segs.model && (!category || m.category_id === category.id));
    if (!model) model = (cat?.models ?? []).find((m: any) => m.code === segs.model);
    if (code.length === EXPECTED_LEN && !model) errs.push(`Modelo '${segs.model}' não existe`);
    const structure = cat?.structures.find((x: any) => x.code === segs.structure);
    if (code.length === EXPECTED_LEN && !structure) errs.push(`Estrutura '${segs.structure}' não existe`);
    const measure = cat?.measures.find((x: any) => x.code === segs.measure);
    if (code.length === EXPECTED_LEN && !measure) errs.push(`Medida '${segs.measure}' não existe`);
    const fabric_type = cat?.fabric_types.find((x: any) => x.code === segs.fabric_type);
    if (code.length === EXPECTED_LEN && !fabric_type) errs.push(`Tipo de tecido '${segs.fabric_type}' não existe`);
    const fabric_ref = cat?.fabric_refs.find((x: any) => x.code === segs.fabric_ref);
    if (code.length === EXPECTED_LEN && !fabric_ref) errs.push(`Ref. tecido '${segs.fabric_ref}' não existe`);
    const color = cat?.colors.find((x: any) => x.code === segs.color);
    if (code.length === EXPECTED_LEN && !color) errs.push(`Cor '${segs.color}' não existe`);
    const finishing: "F" | "N" | null = segs.finishing === "F" || segs.finishing === "N" ? (segs.finishing as any) : null;
    if (code.length === EXPECTED_LEN && !finishing) errs.push(`Acabamento '${segs.finishing}' inválido (esperado F ou N)`);

    const due_date = parseDateMaybe(raw.due_date);
    if (raw.due_date && !due_date) errs.push("Prazo de Entrega com formato inválido");

    const description = [
      category?.name, model?.name, structure?.name, measure?.name,
      fabric_ref?.name, color?.name,
      finishing === "F" ? "Flutuante" : finishing === "N" ? "Normal" : "",
    ].filter(Boolean).join(" ");

    return {
      excel_row: idx + 2,
      raw,
      ok: errs.length === 0,
      errors: errs,
      customer_order: raw.customer_order,
      quantity: Number.isFinite(qty) ? qty : 0,
      due_date,
      product_description: description || code,
      model_id: model?.id ?? null,
      measure: measure?.name ?? null,
      fabric_type: fabric_type?.name ?? null,
      fabric_ref: fabric_ref?.name ?? null,
      color: color?.name ?? null,
      structure_type: structure?.name ?? null,
      finishing,
      barcode_base: code,
    };
  }

  function validate() {
    if (!cat) { toast.error("Catálogo a carregar"); return; }
    if (!mapping.code || !mapping.qty || !mapping.customer_order) {
      toast.error("Mapeia pelo menos Código, Quantidade e Nº Encomenda");
      return;
    }
    setDecoded(rows.map((r, i) => decodeRow(r, i)));
    setStep(3);
  }

  function doImport() {
    const valid = decoded.filter((r) => r.ok);
    if (!valid.length) { toast.error("Sem linhas válidas para importar"); return; }
    bulk.mutate({
      rows: valid.map((r) => ({
        customer_order: r.customer_order,
        quantity: r.quantity,
        due_date: r.due_date,
        product_description: r.product_description,
        model_id: r.model_id,
        measure: r.measure,
        fabric_type: r.fabric_type,
        fabric_ref: r.fabric_ref,
        color: r.color,
        structure_type: r.structure_type,
        finishing: r.finishing,
        barcode_base: r.barcode_base,
      })),
    });
  }

  const validCount = decoded.filter((r) => r.ok).length;
  const errorCount = decoded.length - validCount;
  const totalUnits = useMemo(() => decoded.filter((r) => r.ok).reduce((a, r) => a + r.quantity, 0), [decoded]);

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Importar encomendas (Excel simples)</h1>
        <p className="text-sm text-muted-foreground">
          4 colunas: Código (18), Quantidade, Nº Encomenda do cliente, Prazo de Entrega (opcional).
          As encomendas entram como <b>backlog (pendentes)</b> — o planeamento decide quando iniciar.
        </p>
      </div>
      <div>
        <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-2">
          <Download className="size-4" /> Descarregar modelo Excel
        </Button>
      </div>

      {step === 1 && (
        <Card className="p-12 border-2 border-dashed">
          <div className="flex flex-col items-center gap-3 text-center">
            <FileSpreadsheet className="size-12 text-muted-foreground" />
            <div>Carrega o ficheiro Excel/CSV</div>
            <label>
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
              <Button asChild><span className="gap-2 inline-flex items-center"><Upload className="size-4" /> Escolher ficheiro</span></Button>
            </label>
          </div>
        </Card>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="text-sm font-medium mb-1">{fileName}</div>
            <div className="text-xs text-muted-foreground mb-3">{rows.length} linha(s) — confirma o mapeamento das colunas</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {([
                ["code", "Código *"],
                ["qty", "Quantidade *"],
                ["customer_order", "Nº Encomenda *"],
                ["due_date", "Prazo de Entrega (opcional)"],
              ] as const).map(([k, label]) => (
                <div key={k} className="space-y-1.5">
                  <Label className="text-xs">{label}</Label>
                  <Select value={(mapping as any)[k] ?? "__none"} onValueChange={(v) => setMapping((m) => ({ ...m, [k]: v === "__none" ? undefined : v }))}>
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
            <Button variant="outline" onClick={reset} className="gap-2"><ArrowLeft className="size-4" /> Voltar</Button>
            <Button onClick={validate} className="gap-2">Validar <ArrowRight className="size-4" /></Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <Card className="p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
            <div><span className="text-2xl font-bold">{decoded.length}</span> <span className="text-sm text-muted-foreground">linhas</span></div>
            <div><span className="text-2xl font-bold text-success">{validCount}</span> <span className="text-sm text-muted-foreground">válidas → {totalUnits} unidade(s)</span></div>
            <div><span className="text-2xl font-bold text-destructive">{errorCount}</span> <span className="text-sm text-muted-foreground">com erro</span></div>
            <div className="ml-auto flex gap-2">
              {errorCount > 0 && (
                <Button size="sm" variant="outline" onClick={downloadErrors} className="gap-2">
                  <Download className="size-4" /> Descarregar erros
                </Button>
              )}
              <Button variant="outline" onClick={() => setStep(2)} className="gap-2"><ArrowLeft className="size-4" /> Voltar</Button>
              <Button onClick={doImport} disabled={!validCount || bulk.isPending} className="gap-2">
                Importar {validCount} linha(s) <ArrowRight className="size-4" />
              </Button>
            </div>
          </Card>

          <Card className="p-2 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead></TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Qtd</TableHead>
                  <TableHead>Nº Encomenda</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Descrição / Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {decoded.map((r) => (
                  <TableRow key={r.excel_row} className={r.ok ? "bg-green-500/5" : "bg-red-500/5"}>
                    <TableCell className="text-xs text-muted-foreground">L{r.excel_row}</TableCell>
                    <TableCell>
                      {r.ok ? <CheckCircle2 className="size-4 text-success" /> : <AlertCircle className="size-4 text-destructive" />}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.raw.code}</TableCell>
                    <TableCell>{r.raw.qty as any}</TableCell>
                    <TableCell>{r.raw.customer_order}</TableCell>
                    <TableCell className="text-xs">{r.due_date ?? <span className="text-muted-foreground italic">auto (hoje+15)</span>}</TableCell>
                    <TableCell className="text-xs">
                      {r.ok ? r.product_description : <span className="text-destructive">{r.errors.join(" · ")}</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}