import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { listRolls, upsertRoll, deleteRoll } from "@/lib/stock.functions";
import { getCatalogs } from "@/lib/catalog.functions";
import { AdjustDialog } from "./stock.cascos";

export const Route = createFileRoute("/_authenticated/stock/tecidos")({
  component: TecidosPage,
});

function TecidosPage() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ["rolls"], queryFn: () => listRolls() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["rolls"] });
  const del = useMutation({
    mutationFn: (id: string) => deleteRoll({ data: { id } }),
    onSuccess: () => { toast.success("Removido"); refresh(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Rolos de tecido</h1>
          <p className="text-sm text-muted-foreground">Matéria-prima em metros (consumida no Corte).</p>
        </div>
        <UpsertRoll onDone={refresh} />
      </div>
      <Card className="p-2 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ref.</TableHead>
              <TableHead>Cor</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead className="text-right">Metros</TableHead>
              <TableHead className="text-right">Mínimo</TableHead>
              <TableHead>Localização</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">A carregar…</TableCell></TableRow>}
            {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Sem rolos</TableCell></TableRow>}
            {rows.map((r: any) => {
              const low = Number(r.meters) <= Number(r.min_meters ?? 0);
              return (
                <TableRow key={r.id} className={low ? "bg-destructive/5" : ""}>
                  <TableCell className="font-mono text-xs">{r.fabric_ref_code ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.color_code ?? "—"}</TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className={`text-right font-semibold ${low ? "text-destructive" : ""}`}>{Number(r.meters).toFixed(1)} m</TableCell>
                  <TableCell className="text-right text-muted-foreground">{Number(r.min_meters).toFixed(1)} m</TableCell>
                  <TableCell className="text-xs">{r.location ?? "—"}</TableCell>
                  <TableCell className="text-right space-x-1 whitespace-nowrap">
                    <AdjustDialog itemType="fabric" itemId={r.id} label={r.name} onDone={refresh} />
                    <UpsertRoll editing={r} onDone={refresh} />
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm(`Apagar ${r.name}?`)) del.mutate(r.id); }}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function UpsertRoll({ editing, onDone }: { editing?: any; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const { data: cat } = useQuery({ queryKey: ["catalogs"], queryFn: () => getCatalogs(), enabled: open });
  const [f, setF] = useState<any>({
    name: editing?.name ?? "",
    fabric_ref_code: editing?.fabric_ref_code ?? "",
    color_code: editing?.color_code ?? "",
    meters: editing?.meters ?? 0,
    min_meters: editing?.min_meters ?? 0,
    location: editing?.location ?? "",
  });
  const mut = useMutation({
    mutationFn: () => upsertRoll({ data: { id: editing?.id, ...f, meters: Number(f.meters), min_meters: Number(f.min_meters) } }),
    onSuccess: () => { toast.success(editing ? "Atualizado" : "Adicionado"); setOpen(false); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? <Button variant="ghost" size="sm">Editar</Button> : <Button className="gap-2"><Plus className="size-4" /> Novo rolo</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"} rolo</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Fld label="Ref. Tecido">
            <Select value={f.fabric_ref_code || undefined} onValueChange={(v) => setF({ ...f, fabric_ref_code: v })}>
              <SelectTrigger className="h-11"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{(cat?.fabric_refs ?? []).map((m: any) => <SelectItem key={m.id} value={m.code}><span className="font-mono text-xs mr-2">{m.code}</span>{m.name}</SelectItem>)}</SelectContent>
            </Select>
          </Fld>
          <Fld label="Cor">
            <Select value={f.color_code || undefined} onValueChange={(v) => setF({ ...f, color_code: v })}>
              <SelectTrigger className="h-11"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{(cat?.colors ?? []).map((m: any) => <SelectItem key={m.id} value={m.code}><span className="font-mono text-xs mr-2">{m.code}</span>{m.name}</SelectItem>)}</SelectContent>
            </Select>
          </Fld>
          <Fld label="Nome" cls="col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="h-11" placeholder="Opera Bege" /></Fld>
          <Fld label="Metros"><Input type="number" min={0} step="0.1" value={f.meters} onChange={(e) => setF({ ...f, meters: Number(e.target.value) })} className="h-11" /></Fld>
          <Fld label="Mínimo (m)"><Input type="number" min={0} step="0.1" value={f.min_meters} onChange={(e) => setF({ ...f, min_meters: Number(e.target.value) })} className="h-11" /></Fld>
          <Fld label="Localização" cls="col-span-2"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} className="h-11" /></Fld>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !f.name}>{mut.isPending ? "A guardar…" : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Fld({ label, children, cls }: { label: React.ReactNode; children: React.ReactNode; cls?: string }) {
  return <div className={`space-y-1.5 ${cls ?? ""}`}><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}