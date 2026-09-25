import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, AlertTriangle } from "lucide-react";
import {
  listFabricCatalog,
  upsertFabricCatalog,
  setFabricCatalogActive,
  type FabricCatalogRow,
} from "@/lib/catalog.functions";

const ALL = "__all__";

function statusOf(f: FabricCatalogRow) {
  if (f.meters <= 0) return { label: "Sem stock", dot: "bg-destructive" };
  if (f.meters <= f.min_meters) return { label: "Pouco", dot: "bg-amber-500" };
  return { label: "Disponível", dot: "bg-emerald-500" };
}

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Catálogo de tecidos — a MESMA lista que aparece em Stock > Tecidos (fabric_catalog).
 * Aqui gere-se a ficha do tecido; os metros continuam a ser movidos no Stock.
 */
export function FabricsTable() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [type, setType] = useState(ALL);
  const [collection, setCollection] = useState(ALL);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<FabricCatalogRow | null>(null);
  const [open, setOpen] = useState(false);

  const { data: fabrics = [], isLoading } = useQuery({
    queryKey: ["fabric-catalog"],
    queryFn: () => listFabricCatalog(),
  });

  const toggle = useMutation({
    mutationFn: (v: { ref_tec: string; active: boolean }) => setFabricCatalogActive({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fabric-catalog"] });
      qc.invalidateQueries({ queryKey: ["fabric-availability"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível alterar"),
  });

  const types = useMemo(
    () => Array.from(new Set(fabrics.map((f) => f.fabric_type).filter(Boolean))).sort(),
    [fabrics],
  );
  const collections = useMemo(
    () => Array.from(new Set(fabrics.map((f) => f.collection).filter(Boolean))).sort(),
    [fabrics],
  );

  const rows = useMemo(() => {
    const terms = norm(search).split(/\s+/).filter(Boolean);
    return fabrics.filter((f) => {
      if (!showInactive && !f.active) return false;
      if (type !== ALL && f.fabric_type !== type) return false;
      if (collection !== ALL && f.collection !== collection) return false;
      if (!terms.length) return true;
      const hay = norm(
        [f.name, f.supplier_ref ?? "", f.supplier_number ?? "", f.collection, f.fabric_type, f.ref_tec].join(" "),
      );
      return terms.every((t) => hay.includes(t));
    });
  }, [fabrics, search, type, collection, showInactive]);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-2 justify-between">
        <div>
          <h2 className="font-semibold">Tecidos</h2>
          <p className="text-xs text-muted-foreground">
            É a mesma lista de Stock &gt; Tecidos. Aqui trata-se da ficha do tecido; os metros movem-se no Stock.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar: bass bege, célia 02…"
            className="h-9 w-64"
          />
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos os tipos</SelectItem>
              {types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={collection} onValueChange={setCollection}>
            <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Coleção" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as coleções</SelectItem>
              {collections.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Dialog
            open={open}
            onOpenChange={(v) => {
              setOpen(v);
              if (!v) setEditing(null);
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5"><Plus className="size-4" /> Novo tecido</Button>
            </DialogTrigger>
            <FabricDialog
              key={editing?.ref_tec ?? "novo"}
              editing={editing}
              types={types}
              collections={collections}
              onDone={() => {
                setOpen(false);
                setEditing(null);
              }}
            />
          </Dialog>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {rows.length} de {fabrics.length} tecidos
        </p>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={showInactive} onCheckedChange={setShowInactive} />
          Mostrar também inativos
        </label>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tecido</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Coleção</TableHead>
            <TableHead>Nº forn.</TableHead>
            <TableHead className="text-right">Metros</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow><TableCell colSpan={6} className="text-muted-foreground">A carregar…</TableCell></TableRow>
          )}
          {!isLoading && rows.length === 0 && (
            <TableRow><TableCell colSpan={6} className="text-muted-foreground">Sem tecidos para estes filtros.</TableCell></TableRow>
          )}
          {rows.map((f) => {
            const st = statusOf(f);
            return (
              <TableRow key={f.ref_tec} className={f.active ? "" : "opacity-60"}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${st.dot}`} title={st.label} />
                    <span className="font-medium">{f.name}</span>
                    {f.needs_review && (
                      <AlertTriangle className="size-3.5 text-amber-500" aria-label={f.needs_review} />
                    )}
                    {!f.active && <Badge variant="outline">Inativo</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">{f.ref_tec}</div>
                </TableCell>
                <TableCell>{f.fabric_type}</TableCell>
                <TableCell>{f.collection}</TableCell>
                <TableCell>{f.supplier_number ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{f.meters.toFixed(1)} m</TableCell>
                <TableCell className="text-right space-x-2">
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
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function FabricDialog({
  editing,
  types,
  collections,
  onDone,
}: {
  editing: FabricCatalogRow | null;
  types: string[];
  collections: string[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(editing?.name ?? "");
  const [fabricType, setFabricType] = useState(editing?.fabric_type ?? "");
  const [collection, setCollection] = useState(editing?.collection ?? "");
  const [supplierRef, setSupplierRef] = useState(editing?.supplier_ref ?? "");
  const [supplierNumber, setSupplierNumber] = useState(editing?.supplier_number ?? "");
  const [color, setColor] = useState(editing?.color ?? "");
  const [priceClass, setPriceClass] = useState(editing?.price_class ?? "");
  const [minMeters, setMinMeters] = useState(String(editing?.min_meters ?? 0));
  const [location, setLocation] = useState(editing?.location ?? "");

  const save = useMutation({
    mutationFn: () =>
      upsertFabricCatalog({
        data: {
          ref_tec: editing?.ref_tec ?? null,
          name: name.trim(),
          fabric_type: fabricType.trim(),
          collection: collection.trim(),
          supplier_ref: supplierRef.trim() || null,
          supplier_number: supplierNumber.trim() || null,
          color: color.trim() || null,
          price_class: priceClass.trim() || null,
          min_meters: Number(minMeters) || 0,
          location: location.trim() || null,
        },
      }),
    onSuccess: (r: any) => {
      toast.success(`Tecido ${r.ref_tec} guardado`);
      qc.invalidateQueries({ queryKey: ["fabric-catalog"] });
      qc.invalidateQueries({ queryKey: ["fabric-availability"] });
      onDone();
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível guardar"),
  });

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{editing ? `Editar ${editing.ref_tec}` : "Novo tecido"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Nome completo (como vem do fornecedor)</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-11"
            placeholder="ex: Microfibra Célia 02 Beige"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Tipo</Label>
            <Input
              list="fabric-types"
              value={fabricType}
              onChange={(e) => setFabricType(e.target.value)}
              className="h-11"
              placeholder="ex: Aveludado"
            />
            <datalist id="fabric-types">{types.map((t) => <option key={t} value={t} />)}</datalist>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Coleção</Label>
            <Input
              list="fabric-collections"
              value={collection}
              onChange={(e) => setCollection(e.target.value)}
              className="h-11"
              placeholder="ex: Célia"
            />
            <datalist id="fabric-collections">{collections.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Ref. do fornecedor</Label>
            <Input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} className="h-11" placeholder="Célia 02 Beige" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Nº do fornecedor</Label>
            <Input value={supplierNumber} onChange={(e) => setSupplierNumber(e.target.value)} className="h-11" placeholder="02" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Cor</Label>
            <Input value={color} onChange={(e) => setColor(e.target.value)} className="h-11" placeholder="Beige" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Classe de preço</Label>
            <Input value={priceClass} onChange={(e) => setPriceClass(e.target.value)} className="h-11" placeholder="A / B / C" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Stock mínimo (m)</Label>
            <Input
              type="number"
              min={0}
              value={minMeters}
              onChange={(e) => setMinMeters(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Localização</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} className="h-11" placeholder="ex: Prateleira 3" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Os metros em stock não se alteram aqui — faz-se entrada e saída em Stock &gt; Tecidos.
        </p>
      </div>
      <DialogFooter>
        <Button
          disabled={!name.trim() || !fabricType.trim() || !collection.trim() || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "A guardar…" : "Guardar"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
