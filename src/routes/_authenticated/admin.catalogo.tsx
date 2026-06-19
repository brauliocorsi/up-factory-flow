import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Upload, Trash2, Package } from "lucide-react";
import { listRef, upsertRef, deleteRef, bulkImportRef, type RefKind, type RefRow } from "@/lib/catalog.functions";

export const Route = createFileRoute("/_authenticated/admin/catalogo")({
  component: CatalogoPage,
});

const TABS: { kind: RefKind; label: string; segment: string; hasCategory?: boolean }[] = [
  { kind: "categories", label: "Categorias", segment: "Categoria (CAM, SOF…)" },
  { kind: "models", label: "Modelos", segment: "Modelo (001…)", hasCategory: true },
  { kind: "structures", label: "Estruturas", segment: "Estrutura (01, 03…)" },
  { kind: "measures", label: "Medidas", segment: "Medida (140, 160…)" },
  { kind: "fabric_types", label: "Tipos de Tecido", segment: "Tipo Tecido (01…)" },
  { kind: "fabric_refs", label: "Refs. Tecido", segment: "Ref. Tecido (01…)" },
  { kind: "colors", label: "Cores", segment: "Cor (02…)" },
];

function CatalogoPage() {
  const [tab, setTab] = useState<RefKind>("categories");
  const meta = TABS.find((t) => t.kind === tab)!;

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Catálogo</h1>
          <p className="text-sm text-muted-foreground">Tabelas de referência usadas pelo gerador de código.</p>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link to="/admin/colis"><Package className="size-4" /> Gestão de Colis</Link>
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as RefKind)}>
        <TabsList className="flex flex-wrap h-auto">
          {TABS.map((t) => (
            <TabsTrigger key={t.kind} value={t.kind}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((t) => (
          <TabsContent key={t.kind} value={t.kind}>
            <RefTable kind={t.kind} hint={t.segment} hasCategory={!!t.hasCategory} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function RefTable({ kind, hint, hasCategory }: { kind: RefKind; hint: string; hasCategory: boolean }) {
  const qc = useQueryClient();
  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ["ref", kind],
    queryFn: () => listRef({ data: { kind } }),
  });
  const { data: cats = [] } = useQuery({
    queryKey: ["ref", "categories"],
    queryFn: () => listRef({ data: { kind: "categories" } }),
    enabled: hasCategory,
  });
  const catById = useMemo(() => new Map((cats ?? []).map((c) => [c.id, c])), [cats]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["ref", kind] });

  const del = useMutation({
    mutationFn: (id: string) => deleteRef({ data: { kind, id } }),
    onSuccess: () => { toast.success("Removido"); refresh(); },
    onError: (e: any) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: (r: RefRow) => upsertRef({ data: { kind, id: r.id, code: r.code, name: r.name, active: !r.active, category_id: r.category_id ?? null } }),
    onSuccess: refresh,
  });
  const toggleDirectional = useMutation({
    mutationFn: (r: RefRow) =>
      upsertRef({ data: { kind, id: r.id, code: r.code, name: r.name, active: r.active, directional: !r.directional } }),
    onSuccess: refresh,
  });

  const showDirectional = kind === "fabric_types";

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-muted-foreground">{hint}</div>
        <div className="flex gap-2">
          <ImportDialog kind={kind} hasCategory={hasCategory} onDone={refresh} />
          <UpsertDialog kind={kind} hasCategory={hasCategory} cats={cats} onDone={refresh} />
        </div>
      </div>
      <div className="overflow-x-auto">
        {error && (
          <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            Não foi possível carregar o catálogo: {(error as Error).message}
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Código</TableHead>
              <TableHead>Nome</TableHead>
              {hasCategory && <TableHead>Categoria</TableHead>}
              {showDirectional && <TableHead className="w-32">Sentido do veio</TableHead>}
              <TableHead className="w-24">Ativo</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">A carregar…</TableCell></TableRow>}
            {!isLoading && rows.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Sem registos</TableCell></TableRow>
            )}
            {(rows ?? []).map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">{r.code}</TableCell>
                <TableCell>{r.name}</TableCell>
                {hasCategory && (
                  <TableCell>
                    {r.category_id ? (
                      <Badge variant="secondary">{catById.get(r.category_id)?.code ?? "?"}</Badge>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                )}
                {showDirectional && (
                  <TableCell>
                    <Switch
                      checked={!!r.directional}
                      onCheckedChange={() => toggleDirectional.mutate(r)}
                    />
                  </TableCell>
                )}
                <TableCell>
                  <Switch checked={r.active} onCheckedChange={() => toggle.mutate(r)} />
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <UpsertDialog kind={kind} hasCategory={hasCategory} cats={cats} editing={r} onDone={refresh} />
                  <Button variant="ghost" size="icon" onClick={() => { if (confirm(`Apagar ${r.code} — ${r.name}?`)) del.mutate(r.id); }}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function UpsertDialog({ kind, hasCategory, cats, editing, onDone }: { kind: RefKind; hasCategory: boolean; cats: RefRow[]; editing?: RefRow; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(editing?.code ?? "");
  const [name, setName] = useState(editing?.name ?? "");
  const [categoryId, setCategoryId] = useState<string>(editing?.category_id ?? "");

  const mut = useMutation({
    mutationFn: () => upsertRef({ data: { kind, id: editing?.id, code: code.trim(), name: name.trim(), category_id: categoryId || null } }),
    onSuccess: () => { toast.success(editing ? "Atualizado" : "Adicionado"); setOpen(false); onDone(); if (!editing) { setCode(""); setName(""); setCategoryId(""); } },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="ghost" size="sm">Editar</Button>
        ) : (
          <Button size="sm" className="gap-2"><Plus className="size-4" /> Adicionar</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? "Editar" : "Adicionar"} registo</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Código</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} className="h-11 font-mono" placeholder="ex: 001" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-11" placeholder="ex: Armani" />
          </div>
          {hasCategory && (
            <div className="space-y-1.5">
              <Label className="text-xs">Categoria</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="h-11"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} · {c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !code.trim() || !name.trim()}>
            {mut.isPending ? "A guardar…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ kind, hasCategory, onDone }: { kind: RefKind; hasCategory: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [codeCol, setCodeCol] = useState("");
  const [nameCol, setNameCol] = useState("");
  const [catCol, setCatCol] = useState("");

  function autodetect(hs: string[]) {
    const find = (rx: RegExp) => hs.find((h) => rx.test(h.toLowerCase())) ?? "";
    setCodeCol(find(/c(o|ó)d|code/));
    setNameCol(find(/nome|name|desc/));
    setCatCol(find(/categ/));
  }

  async function onFile(f: File) {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
    if (!json.length) { toast.error("Ficheiro vazio"); return; }
    const hs = Object.keys(json[0]);
    setHeaders(hs);
    setRows(json);
    autodetect(hs);
  }

  const mut = useMutation({
    mutationFn: () => {
      const payload = rows
        .map((r) => ({
          code: String(r[codeCol] ?? "").trim(),
          name: String(r[nameCol] ?? "").trim(),
          category_code: hasCategory && catCol ? String(r[catCol] ?? "").trim() || null : null,
        }))
        .filter((r) => r.code && r.name);
      if (!payload.length) throw new Error("Sem linhas válidas para importar");
      return bulkImportRef({ data: { kind, rows: payload } });
    },
    onSuccess: (res) => {
      toast.success(`Importados ${res.inserted} registos`);
      setOpen(false); setRows([]); setHeaders([]);
      onDone();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2"><Upload className="size-4" /> Importar CSV</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Importar CSV / Excel</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} className="h-11" />
          {headers.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">{rows.length} linhas detetadas. Mapeie as colunas:</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <MapPicker label="Coluna Código" value={codeCol} onChange={setCodeCol} headers={headers} />
                <MapPicker label="Coluna Nome" value={nameCol} onChange={setNameCol} headers={headers} />
                {hasCategory && <MapPicker label="Coluna Categoria (código)" value={catCol} onChange={setCatCol} headers={headers} />}
              </div>
              <div className="text-xs text-muted-foreground">Pré-vis. (3 primeiras): {rows.slice(0, 3).map((r, i) => <span key={i} className="font-mono mr-2">{String(r[codeCol] ?? "")}·{String(r[nameCol] ?? "")}</span>)}</div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !codeCol || !nameCol || rows.length === 0}>
            {mut.isPending ? "A importar…" : "Importar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MapPicker({ label, value, onChange, headers }: { label: string; value: string; onChange: (v: string) => void; headers: string[] }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-10"><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>
          {headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}