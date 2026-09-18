import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Upload, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { getParseCatalog, confirmProductImport } from "@/lib/productImport.functions";
import { parseProductRow, type ParsedRow, type ParseCatalog } from "@/lib/productParse";
import {
  buildBedCode,
  buildSofaCode,
  buildSommierCode,
  bedProductName,
  sofaProductName,
  sommierProductName,
  fabricLabel,
  SOFA_VARIANTS,
  BED_VARIANTS,
  ODF_LABEL,
  type BedVariant,
  type SofaVariant,
} from "@/lib/productCodes";

export const Route = createFileRoute("/_authenticated/encomendas/importar-produtos")({
  component: ImportarProdutosPage,
});

type Draft = ParsedRow & {
  order_number: string;
  quantity: number;
  due_date: string;
  observation: string;
};

const HEADER_HINTS = {
  product: ["produto", "descri", "artigo", "nome"],
  quantity: ["quant", "qtd", "qtde", "unidades"],
  order: ["encomenda", "nº", "numero", "número", "order"],
  due: ["entrega", "saida", "saída", "data"],
};

function guess(headers: string[], hints: string[]): string {
  const h = headers.find((x) => hints.some((k) => x.toLowerCase().includes(k)));
  return h ?? "";
}

function excelDate(v: any): string {
  if (v == null || v === "") return "";
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function ImportarProdutosPage() {
  const { data: catalog } = useQuery({ queryKey: ["parse-catalog"], queryFn: () => getParseCatalog() });
  const [rawRows, setRawRows] = useState<any[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [map, setMap] = useState({ product: "", quantity: "", order: "", due: "" });
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [report, setReport] = useState<any>(null);
  const [intentId] = useState(() => `prod-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  async function onFile(file: File) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: "" });
    if (rows.length === 0) {
      toast.error("A folha está vazia");
      return;
    }
    const hs = Object.keys(rows[0]);
    setHeaders(hs);
    setRawRows(rows);
    setDrafts(null);
    setReport(null);
    setMap({
      product: guess(hs, HEADER_HINTS.product),
      quantity: guess(hs, HEADER_HINTS.quantity),
      order: guess(hs, HEADER_HINTS.order),
      due: guess(hs, HEADER_HINTS.due),
    });
    toast.success(`${rows.length} linhas lidas`);
  }

  function buildPreview() {
    if (!catalog) {
      toast.error("Catálogo ainda a carregar");
      return;
    }
    if (!map.product) {
      toast.error("Indica a coluna do produto");
      return;
    }
    const list: Draft[] = rawRows
      .map((r) => String(r[map.product] ?? "").trim())
      .map((text, i) => {
        const parsed = parseProductRow(text, catalog);
        const src = rawRows[i];
        return {
          ...parsed,
          order_number: map.order ? String(src[map.order] ?? "").trim() : "",
          quantity: Math.max(1, Math.min(200, Number(map.quantity ? src[map.quantity] : 1) || 1)),
          due_date: map.due ? excelDate(src[map.due]) : "",
          observation: "",
        };
      })
      .filter((d) => d.raw.length > 0);
    setDrafts(list);
  }

  const counts = useMemo(() => {
    const c = { reconhecida: 0, duvida: 0, nao_reconhecida: 0 };
    for (const d of drafts ?? []) c[d.status] += 1;
    return c;
  }, [drafts]);

  /** Recalcula código e nome depois de uma correção manual. */
  function recompute(d: Draft, cat: ParseCatalog): Draft {
    const model = cat.models.find((m) => m.id === d.model_id) ?? null;
    const next: Draft = { ...d };
    if (model) {
      next.model_code = model.code;
      next.model_name = model.name;
      next.category_code = model.category_code;
      next.structure_code = model.structure_code ?? null;
      next.sofa_family_code = model.sofa_family_code ?? null;
      next.structure_name = cat.structures.find((s) => s.code === model.structure_code)?.name ?? null;
      next.sofa_family_name = cat.sofa_families.find((f) => f.code === model.sofa_family_code)?.name ?? null;
    }
    const fab = cat.fabrics.find((f) => f.ref_tec === next.ref_tec) ?? null;
    if (fab) {
      next.collection_code = fab.fabric_ref_code;
      next.fabric_label = fabricLabel({
        supplierRef: fab.supplier_ref,
        collectionName: cat.collections.find((c) => c.code === fab.fabric_ref_code)?.name ?? null,
        colorName: cat.colors.find((c) => c.code === fab.color_code)?.name ?? null,
      });
    }
    const measure = cat.measures.find((m) => m.code === next.measure_code) ?? null;
    if (measure) {
      next.measure_label = measure.name;
      next.measure_new = null;
    }
    if (next.category_code === "SOF") {
      next.product_code = buildSofaCode({
        modelCode: next.model_code,
        familyCode: next.sofa_family_code,
        widthCm: next.width_cm,
        refTec: next.ref_tec,
        variant: (next.variant as SofaVariant) ?? "N",
      });
      next.product_name = sofaProductName({
        modelName: next.model_name,
        familyCode: next.sofa_family_code,
        familyName: next.sofa_family_name,
        variant: (next.variant as SofaVariant) ?? "N",
        widthCm: next.width_cm,
        fabricLabel: next.fabric_label,
      });
    } else if (next.category_code === "SOM") {
      next.product_code = buildSommierCode({
        modelCode: next.model_code,
        elevatorio: next.elevatorio,
        fundos: next.fundos,
        measureCode: next.measure_code,
        refTec: next.ref_tec,
      });
      next.product_name = sommierProductName({
        modelName: next.model_name,
        elevatorio: next.elevatorio,
        fundos: next.fundos,
        measureName: next.measure_label,
        fabricLabel: next.fabric_label,
      });
    } else {
      next.product_code = buildBedCode({
        modelCode: next.model_code,
        structureCode: next.structure_code,
        measureCode: next.measure_code,
        refTec: next.ref_tec,
        variant: (next.variant as BedVariant) ?? "N",
      });
      next.product_name = bedProductName({
        modelName: next.model_name,
        structureName: next.structure_name,
        variant: (next.variant as BedVariant) ?? "N",
        measureName: next.measure_label,
        fabricLabel: next.fabric_label,
      });
    }
    const missing: string[] = [];
    if (!next.model_id) missing.push("Modelo não reconhecido.");
    if (!next.ref_tec) missing.push("Tecido sem referência TEC.");
    if (next.category_code === "SOF" && !next.width_cm) missing.push("Largura do sofá não reconhecida.");
    if (next.category_code !== "SOF" && !next.measure_code && !next.measure_new) missing.push("Medida não reconhecida.");
    if (next.measure_new) missing.push(`Medida atípica ${next.measure_new} — será criada na gama 5xx.`);
    next.issues = missing;
    next.status = !next.model_id
      ? "nao_reconhecida"
      : missing.length > 0 || !next.product_code
        ? "duvida"
        : "reconhecida";
    return next;
  }

  function update(index: number, patch: Partial<Draft>) {
    if (!catalog) return;
    setDrafts((list) =>
      (list ?? []).map((d, i) => (i === index ? recompute({ ...d, ...patch }, catalog) : d)),
    );
  }

  const importable = (drafts ?? []).filter((d) => d.status !== "nao_reconhecida" && d.product_code);

  const confirm = useMutation({
    mutationFn: () =>
      confirmProductImport({
        data: {
          intent_id: intentId,
          rows: importable.map((d) => ({
            order_number: d.order_number || null,
            product_description: d.product_name || d.raw,
            product_code: d.product_code,
            model_id: d.model_id,
            measure_code: d.measure_code,
            measure_new: d.measure_new,
            width_cm: d.width_cm,
            ref_tec: d.ref_tec,
            structure_name: d.category_code === "SOF" ? d.sofa_family_name : d.structure_name,
            fabric_type: catalog?.collections.find((c) => c.code === d.collection_code)?.fabric_type_code ?? null,
            fabric_ref: catalog?.collections.find((c) => c.code === d.collection_code)?.name ?? null,
            color: d.fabric_label,
            finishing: d.category_code === "CAM" ? ((d.variant as BedVariant) ?? "N") : null,
            customization: d.customizations.join(", ") || null,
            quantity: d.quantity,
            due_date: d.due_date || null,
            observation: d.observation || null,
          })),
        },
      }),
    onSuccess: (res: any) => {
      setReport(res);
      toast.success(`${res.created} encomendas criadas`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível importar"),
  });

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      <Button asChild variant="ghost" size="sm" className="gap-1">
        <Link to="/encomendas"><ArrowLeft className="size-4" /> Voltar</Link>
      </Button>
      <div>
        <h1 className="text-2xl font-bold">Importar produtos por Excel</h1>
        <p className="text-sm text-muted-foreground">
          O sistema lê o nome do produto em texto livre e reconhece modelo, medida, tecido e variante.
          Nada é importado sem passares pela pré-visualização.
        </p>
      </div>

      {/* 1. Ficheiro */}
      <Card className="p-4 space-y-3">
        <div className="font-semibold">1. Carregar ficheiro</div>
        <Input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
        {headers.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <MapPick label="Produto (texto)" value={map.product} headers={headers} onChange={(v) => setMap((m) => ({ ...m, product: v }))} />
            <MapPick label="Quantidade" value={map.quantity} headers={headers} onChange={(v) => setMap((m) => ({ ...m, quantity: v }))} />
            <MapPick label="Nº encomenda" value={map.order} headers={headers} onChange={(v) => setMap((m) => ({ ...m, order: v }))} />
            <MapPick label="Data de entrega" value={map.due} headers={headers} onChange={(v) => setMap((m) => ({ ...m, due: v }))} />
          </div>
        )}
        {rawRows.length > 0 && (
          <Button onClick={buildPreview} className="gap-2"><Upload className="size-4" /> Pré-visualizar {rawRows.length} linhas</Button>
        )}
      </Card>

      {/* 2. Pré-visualização */}
      {drafts && !report && catalog && (
        <Card className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="font-semibold">2. Pré-visualização e correções</div>
            <div className="flex gap-2 text-xs">
              <Badge className="gap-1"><CheckCircle2 className="size-3" /> {counts.reconhecida} reconhecidas</Badge>
              <Badge variant="outline" className="gap-1 border-warning text-warning"><AlertTriangle className="size-3" /> {counts.duvida} em dúvida</Badge>
              <Badge variant="outline" className="gap-1 border-destructive text-destructive"><XCircle className="size-3" /> {counts.nao_reconhecida} não reconhecidas</Badge>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px]">Texto original</TableHead>
                  <TableHead className="min-w-[180px]">Modelo</TableHead>
                  <TableHead>Estrutura / Família</TableHead>
                  <TableHead className="min-w-[150px]">Medida / Largura</TableHead>
                  <TableHead className="min-w-[200px]">Tecido</TableHead>
                  <TableHead className="min-w-[150px]">Variante</TableHead>
                  <TableHead>Personalizações</TableHead>
                  <TableHead className="min-w-[180px]">Código gerado</TableHead>
                  <TableHead>Qtd</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drafts.map((d, i) => {
                  const isSofa = d.category_code === "SOF";
                  const models = catalog.models.filter(
                    (m) => !d.category_code || m.category_code === d.category_code,
                  );
                  const fabricsForCollection = catalog.fabrics.filter(
                    (f) => !d.collection_code || f.fabric_ref_code === d.collection_code,
                  );
                  return (
                    <TableRow key={i} className={d.status === "nao_reconhecida" ? "bg-destructive/5" : d.status === "duvida" ? "bg-warning/5" : ""}>
                      <TableCell className="text-xs">{d.raw}</TableCell>
                      <TableCell>
                        <Select value={d.model_id ?? ""} onValueChange={(v) => update(i, { model_id: v })}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Escolher…" /></SelectTrigger>
                          <SelectContent>
                            {(models.length ? models : catalog.models).map((m) => (
                              <SelectItem key={m.id} value={m.id}>{m.category_code} {m.code} — {m.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {isSofa ? d.sofa_family_name ?? "—" : d.structure_name ?? "—"}
                      </TableCell>
                      <TableCell>
                        {isSofa ? (
                          <Input
                            type="number"
                            className="h-9 w-24"
                            value={d.width_cm ?? ""}
                            onChange={(e) => update(i, { width_cm: Number(e.target.value) || null })}
                          />
                        ) : (
                          <Select
                            value={d.measure_code ?? ""}
                            onValueChange={(v) => update(i, { measure_code: v })}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder={d.measure_new ? `${d.measure_new} (nova)` : "Escolher…"} />
                            </SelectTrigger>
                            <SelectContent>
                              {catalog.measures.map((m) => (
                                <SelectItem key={m.code} value={m.code}>{m.code} — {m.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell className="space-y-1">
                        <Select
                          value={d.collection_code ?? ""}
                          onValueChange={(v) => update(i, { collection_code: v, ref_tec: null })}
                        >
                          <SelectTrigger className="h-9"><SelectValue placeholder="Coleção…" /></SelectTrigger>
                          <SelectContent>
                            {catalog.collections.map((c) => (
                              <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={d.ref_tec ?? ""} onValueChange={(v) => update(i, { ref_tec: v })}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Ref. tecido…" /></SelectTrigger>
                          <SelectContent>
                            {fabricsForCollection.map((f) => (
                              <SelectItem key={f.ref_tec} value={f.ref_tec}>{f.supplier_ref} · {f.ref_tec}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={(d.variant as string) ?? "N"}
                          onValueChange={(v) => update(i, { variant: v as any })}
                        >
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(isSofa ? SOFA_VARIANTS : BED_VARIANTS).map((v: any) => (
                              <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {isSofa && <div className="text-[10px] text-muted-foreground mt-1">{ODF_LABEL}</div>}
                      </TableCell>
                      <TableCell className="text-xs">{d.customizations.join(", ") || "—"}</TableCell>
                      <TableCell>
                        <div className="font-mono text-xs">{d.product_code ?? "—"}</div>
                        <div className="text-[10px] text-muted-foreground">{d.product_name}</div>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={1}
                          max={200}
                          className="h-9 w-16"
                          value={d.quantity}
                          onChange={(e) =>
                            update(i, { quantity: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={d.status} />
                        {d.issues.length > 0 && (
                          <div className="text-[10px] text-muted-foreground mt-1 max-w-[180px]">{d.issues.join(" ")}</div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs text-muted-foreground">
              {importable.length} linhas prontas a importar · {(drafts.length - importable.length)} ficam de fora
            </div>
            <Button disabled={importable.length === 0 || confirm.isPending} onClick={() => confirm.mutate()}>
              {confirm.isPending ? "A importar…" : `3. Confirmar importação (${importable.length})`}
            </Button>
          </div>
        </Card>
      )}

      {/* 4. Relatório */}
      {report && (
        <Card className="p-4 space-y-2">
          <div className="font-semibold">Relatório final</div>
          <div className="text-sm">{report.created} encomendas criadas{report.reused ? " (importação já tinha sido feita)" : ""}.</div>
          {report.created_measures?.length > 0 && (
            <div className="text-sm">
              Medidas sob-medida criadas: {report.created_measures.map((m: any) => `${m.code} (${m.name})`).join(", ")}
            </div>
          )}
          {report.skipped?.length > 0 && (
            <div className="text-sm text-warning">
              {report.skipped.length} linhas ignoradas: {report.skipped.slice(0, 10).map((s: any) => `${s.order_number} — ${s.reason}`).join("; ")}
            </div>
          )}
          <div className="pt-2">
            <Button asChild><Link to="/encomendas">Ver encomendas</Link></Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ParsedRow["status"] }) {
  if (status === "reconhecida") return <Badge className="gap-1"><CheckCircle2 className="size-3" /> Reconhecida</Badge>;
  if (status === "duvida")
    return <Badge variant="outline" className="gap-1 border-warning text-warning"><AlertTriangle className="size-3" /> Dúvida</Badge>;
  return <Badge variant="outline" className="gap-1 border-destructive text-destructive"><XCircle className="size-3" /> Não reconhecida</Badge>;
}

function MapPick({
  label,
  value,
  headers,
  onChange,
}: {
  label: string;
  value: string;
  headers: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-10"><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>
          {headers.map((h) => (
            <SelectItem key={h} value={h}>{h}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
