import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Ruler, PackageOpen, TrendingDown } from "lucide-react";
import { listFabricAvailability, moveFabricStock, type FabricAvailability } from "@/lib/stock.functions";
import { StatusDot, STATUS_LABEL, matchFabric } from "@/components/fabric/fabricUi";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/stock/tecidos")({
  head: () => ({
    meta: [
      { title: "Stock de tecidos — UP Fábrica" },
      { name: "description", content: "Metros em stock por tecido completo." },
    ],
  }),
  component: TecidosPage,
});

const ALL = "__all__";

function TecidosPage() {
  const { session } = useAuth() as any;
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["fabric-availability"],
    queryFn: () => listFabricAvailability(),
    enabled: Boolean(session),
  });
  const [q, setQ] = useState("");
  const [type, setType] = useState(ALL);
  const [collection, setCollection] = useState(ALL);
  const [priceClass, setPriceClass] = useState(ALL);
  const [showAll, setShowAll] = useState(false);

  const opts = useMemo(() => {
    const uniq = (k: keyof FabricAvailability) =>
      [...new Set(rows.map((r) => r[k]).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "pt"));
    return { types: uniq("fabric_type"), collections: uniq("collection"), classes: uniq("price_class") };
  }, [rows]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (showAll || r.meters > 0) &&
          (type === ALL || r.fabric_type === type) &&
          (collection === ALL || r.collection === collection) &&
          (priceClass === ALL || r.price_class === priceClass) &&
          matchFabric(r.name, q),
      ),
    [rows, showAll, type, collection, priceClass, q],
  );

  const stats = useMemo(() => {
    const withStock = rows.filter((r) => r.meters > 0);
    return {
      total: rows.reduce((s, r) => s + r.meters, 0),
      withStock: withStock.length,
      low: rows.filter((r) => r.status === "POUCO").length,
      out: rows.filter((r) => r.status === "SEM STOCK").length,
    };
  }, [rows]);

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Stock de tecidos</h1>
        <p className="text-sm text-muted-foreground">Um código por tecido completo. Metros consumidos no Corte.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Ruler} label="Total em stock" value={`${stats.total.toFixed(1)} m`} />
        <StatCard icon={PackageOpen} label="Tecidos com stock" value={stats.withStock} sub={`de ${rows.length}`} />
        <StatCard icon={TrendingDown} label="Pouco stock" value={stats.low} highlight={stats.low > 0} />
        <StatCard icon={AlertTriangle} label="Sem stock" value={stats.out} highlight={stats.out > 0} danger />
      </div>

      <Card className="p-3 flex flex-wrap gap-3 items-end">
        <div className="space-y-1.5 flex-1 min-w-56">
          <Label className="text-xs">Pesquisar</Label>
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="h-11" placeholder="ex: bass bege, célia light" />
        </div>
        <FilterSelect label="Tipo" value={type} onChange={setType} items={opts.types} />
        <FilterSelect label="Coleção" value={collection} onChange={setCollection} items={opts.collections} />
        <FilterSelect label="Classe" value={priceClass} onChange={setPriceClass} items={opts.classes} width="w-28" />
        <label className="flex items-center gap-2 pb-3 text-sm">
          <Switch checked={showAll} onCheckedChange={setShowAll} />
          Mostrar todos os {rows.length}
        </label>
        <div className="text-xs text-muted-foreground pb-3">{filtered.length} tecido(s)</div>
      </Card>

      <Card className="p-2 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Tecido</TableHead>
              <TableHead>Classe</TableHead>
              <TableHead className="text-right">Metros</TableHead>
              <TableHead>Localização</TableHead>
              <TableHead className="text-right">Movimentos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">A carregar…</TableCell></TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Sem tecidos para estes filtros</TableCell></TableRow>
            )}
            {filtered.map((r) => (
              <TableRow key={r.ref_tec}>
                <TableCell><StatusDot status={r.status} /></TableCell>
                <TableCell>
                  <div className="font-medium flex items-center gap-1.5">
                    {r.name}
                    {r.needs_review && (
                      <TooltipProvider><Tooltip>
                        <TooltipTrigger asChild><AlertTriangle className="size-3.5 text-warning" /></TooltipTrigger>
                        <TooltipContent>A rever: {r.needs_review}</TooltipContent>
                      </Tooltip></TooltipProvider>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono">{r.ref_tec} · {STATUS_LABEL[r.status]}</div>
                </TableCell>
                <TableCell className="text-xs">{r.price_class ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <div className="font-semibold tabular-nums">{r.meters.toFixed(1)} m</div>
                  <div className="text-[11px] text-muted-foreground">mín. {r.min_meters.toFixed(1)} m</div>
                </TableCell>
                <TableCell className="text-xs">{r.location ?? "—"}</TableCell>
                <TableCell className="text-right whitespace-nowrap space-x-1">
                  <MoveDialog fabric={r} direction="entrada" />
                  <MoveDialog fabric={r} direction="saida" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function FilterSelect({ label, value, onChange, items, width = "w-44" }: { label: string; value: string; onChange: (v: string) => void; items: string[]; width?: string }) {
  return (
    <div className={`space-y-1.5 ${width}`}>
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos</SelectItem>
          {items.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function MoveDialog({ fabric, direction }: { fabric: FabricAvailability; direction: "entrada" | "saida" }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [meters, setMeters] = useState("");
  const [reason, setReason] = useState("");
  const isIn = direction === "entrada";
  const mut = useMutation({
    mutationFn: () => moveFabricStock({ data: { ref_tec: fabric.ref_tec, meters: Number(meters), direction, reason } }),
    onSuccess: (res: any) => {
      if (!res?.ok) { toast.error(res?.message ?? "Não foi possível registar"); return; }
      toast.success(`${fabric.name}: agora ${Number(res.meters).toFixed(1)} m`);
      setOpen(false); setMeters(""); setReason("");
      qc.invalidateQueries({ queryKey: ["fabric-availability"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          {isIn ? <ArrowDownToLine className="size-3.5" /> : <ArrowUpFromLine className="size-3.5" />}
          {isIn ? "Entrada" : "Saída"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{isIn ? "Entrada" : "Saída"} de tecido — {fabric.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">Em stock: {fabric.meters.toFixed(1)} m</div>
          <div className="space-y-1.5">
            <Label className="text-xs">Metros</Label>
            <Input type="number" min={0} step="0.1" value={meters} onChange={(e) => setMeters(e.target.value)} className="h-11" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Motivo (opcional)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} className="h-11" placeholder={isIn ? "ex: receção fornecedor" : "ex: amostra, defeito"} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button disabled={!(Number(meters) > 0) || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "A registar…" : "Registar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ icon: Icon, label, value, sub, highlight, danger }: any) {
  return (
    <Card className={`p-4 ${highlight ? (danger ? "border-destructive/40 bg-destructive/5" : "border-warning bg-warning/5") : ""}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className={`size-4 ${highlight ? (danger ? "text-destructive" : "text-warning") : ""}`} /> {label}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}
