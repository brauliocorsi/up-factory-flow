import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Lock } from "lucide-react";
import { listFabrics, upsertFabric, setFabricActive, listRef, type FabricRow } from "@/lib/catalog.functions";

/**
 * Referências de tecido (TEC + tipo + coleção + sequência).
 * O tipo de tecido nunca é escolhido aqui: vem sempre da coleção.
 */
export function FabricsTable() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<FabricRow | null>(null);
  const [open, setOpen] = useState(false);

  const { data: fabrics = [], isLoading } = useQuery({ queryKey: ["fabrics"], queryFn: () => listFabrics() });
  const { data: collections = [] } = useQuery({
    queryKey: ["ref", "fabric_refs"],
    queryFn: () => listRef({ data: { kind: "fabric_refs" } }),
  });
  const { data: types = [] } = useQuery({
    queryKey: ["ref", "fabric_types"],
    queryFn: () => listRef({ data: { kind: "fabric_types" } }),
  });
  const { data: colors = [] } = useQuery({
    queryKey: ["ref", "colors"],
    queryFn: () => listRef({ data: { kind: "colors" } }),
  });

  const toggle = useMutation({
    mutationFn: (v: { ref_tec: string; active: boolean }) => setFabricActive({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fabrics"] });
      qc.invalidateQueries({ queryKey: ["catalogs"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível alterar"),
  });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return fabrics;
    return fabrics.filter((f) =>
      [f.ref_tec, f.supplier_ref, f.fabric_ref_code, f.color_code ?? ""].join(" ").toLowerCase().includes(s),
    );
  }, [fabrics, search]);

  const collName = (code: string) => collections.find((c) => c.code === code)?.name ?? code;
  const typeName = (code: string) => types.find((t) => t.code === code)?.name ?? code;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-2 justify-between">
        <div>
          <h2 className="font-semibold">Referências de tecido</h2>
          <p className="text-xs text-muted-foreground">
            Código gerado: TEC + tipo (2) + coleção (2) + sequência (2). O tipo vem sempre da coleção.
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar referência, coleção…"
            className="h-9 w-56"
          />
          <Dialog
            open={open}
            onOpenChange={(v) => {
              setOpen(v);
              if (!v) setEditing(null);
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5"><Plus className="size-4" /> Nova referência</Button>
            </DialogTrigger>
            <FabricDialog
              key={editing?.ref_tec ?? "nova"}
              editing={editing}
              collections={collections}
              types={types}
              colors={colors}
              onDone={() => {
                setOpen(false);
                setEditing(null);
              }}
            />
          </Dialog>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ref. TEC</TableHead>
            <TableHead>Coleção</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Ref. fornecedor</TableHead>
            <TableHead>Cor</TableHead>
            <TableHead className="text-right">Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow><TableCell colSpan={6} className="text-muted-foreground">A carregar…</TableCell></TableRow>
          )}
          {!isLoading && rows.length === 0 && (
            <TableRow><TableCell colSpan={6} className="text-muted-foreground">Sem referências de tecido.</TableCell></TableRow>
          )}
          {rows.map((f) => (
            <TableRow key={f.ref_tec} className={f.active ? "" : "opacity-60"}>
              <TableCell className="font-mono">{f.ref_tec}</TableCell>
              <TableCell>{collName(f.fabric_ref_code)}</TableCell>
              <TableCell>{typeName(f.fabric_type_code)}</TableCell>
              <TableCell>{f.supplier_ref}</TableCell>
              <TableCell>{f.color_code ?? "—"}</TableCell>
              <TableCell className="text-right space-x-2">
                <Badge variant={f.active ? "default" : "outline"}>{f.active ? "Ativa" : "Inativa"}</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(f);
                    setOpen(true);
                  }}
                >
                  Editar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => toggle.mutate({ ref_tec: f.ref_tec, active: !f.active })}
                >
                  {f.active ? "Desativar" : "Ativar"}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function FabricDialog({
  editing,
  collections,
  types,
  colors,
  onDone,
}: {
  editing: FabricRow | null;
  collections: any[];
  types: any[];
  colors: any[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [collectionCode, setCollectionCode] = useState(editing?.fabric_ref_code ?? "");
  const [supplierRef, setSupplierRef] = useState(editing?.supplier_ref ?? "");
  const [colorCode, setColorCode] = useState(editing?.color_code ?? "");

  const collection = collections.find((c) => c.code === collectionCode);
  const type = types.find((t) => t.code === (collection?.fabric_type_code ?? ""));

  const save = useMutation({
    mutationFn: () =>
      upsertFabric({
        data: {
          ref_tec: editing?.ref_tec ?? null,
          fabric_ref_code: collectionCode,
          supplier_ref: supplierRef,
          color_code: colorCode || null,
        },
      }),
    onSuccess: (r: any) => {
      toast.success(`Referência ${r.ref_tec} guardada`);
      qc.invalidateQueries({ queryKey: ["fabrics"] });
      qc.invalidateQueries({ queryKey: ["catalogs"] });
      onDone();
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível guardar"),
  });

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{editing ? `Editar ${editing.ref_tec}` : "Nova referência de tecido"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Coleção</Label>
          <Select value={collectionCode} onValueChange={setCollectionCode}>
            <SelectTrigger className="h-11"><SelectValue placeholder="Escolher…" /></SelectTrigger>
            <SelectContent>
              {collections
                .filter((c) => c.active)
                .map((c) => (
                  <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Tipo de tecido (da coleção)</Label>
          <div className="h-11 flex items-center gap-2 rounded-md border bg-muted/50 px-3 text-sm">
            <Lock className="size-3.5 text-muted-foreground" />
            {type ? `${type.code} — ${type.name}` : <span className="text-muted-foreground">Escolhe a coleção</span>}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Referência do fornecedor</Label>
          <Input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} className="h-11" placeholder="ex: Kenya Camel / 15" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Cor (opcional)</Label>
          <Select value={colorCode} onValueChange={setColorCode}>
            <SelectTrigger className="h-11"><SelectValue placeholder="Sem cor" /></SelectTrigger>
            <SelectContent>
              {colors
                .filter((c) => c.active)
                .map((c) => (
                  <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button
          disabled={!collectionCode || !supplierRef.trim() || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "A guardar…" : "Guardar"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
