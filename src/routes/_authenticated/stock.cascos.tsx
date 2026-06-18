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
import { Plus, Trash2, Factory, ArrowUpDown } from "lucide-react";
import { listShells, upsertShell, deleteShell, adjustStock, createStockProduction } from "@/lib/stock.functions";

export const Route = createFileRoute("/_authenticated/stock/cascos")({
  component: CascosPage,
});

function CascosPage() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ["shells"], queryFn: () => listShells() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["shells"] });

  const del = useMutation({
    mutationFn: (id: string) => deleteShell({ data: { id } }),
    onSuccess: () => { toast.success("Removido"); refresh(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Cascos (ES)</h1>
          <p className="text-sm text-muted-foreground">Estrutura + espuma. Partilhável entre produtos.</p>
        </div>
        <UpsertShell onDone={refresh} />
      </div>
      <Card className="p-2 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Estrutura</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Disponível</TableHead>
              <TableHead className="text-right">Reservado</TableHead>
              <TableHead className="text-right">Mínimo</TableHead>
              <TableHead>Localização</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">A carregar…</TableCell></TableRow>}
            {!isLoading && rows.length === 0 && (
              <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">Sem cascos registados</TableCell></TableRow>
            )}
            {rows.map((r: any) => {
              const available = Number(r.quantity) - Number(r.reserved ?? 0);
              const low = available <= Number(r.min_quantity ?? 0);
              return (
                <TableRow key={r.id} className={low ? "bg-destructive/5" : ""}>
                  <TableCell className="font-mono">{r.code}</TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="font-mono text-xs">{r.structure_code ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.category_code ?? "—"}</TableCell>
                  <TableCell className="text-xs">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${r.state === 'branco' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'}`}>
                      {r.state === 'branco' ? 'Branco' : 'Casco'}
                    </span>
                  </TableCell>
                  <TableCell className={`text-right font-semibold ${low ? "text-destructive" : ""}`}>{available}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{r.reserved}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{r.min_quantity}</TableCell>
                  <TableCell className="text-xs">{r.location ?? "—"}</TableCell>
                  <TableCell className="text-right space-x-1 whitespace-nowrap">
                    <AdjustDialog itemType="shell" itemId={r.id} label={r.code} onDone={refresh} />
                    <ProduceDialog itemType="shell" itemId={r.id} label={`${r.code} · ${r.name}`} onDone={refresh} />
                    <UpsertShell editing={r} onDone={refresh} />
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm(`Apagar casco ${r.code}?`)) del.mutate(r.id); }}>
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

function UpsertShell({ editing, onDone }: { editing?: any; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    code: editing?.code ?? "",
    name: editing?.name ?? "",
    structure_code: editing?.structure_code ?? "",
    category_code: editing?.category_code ?? "CAM",
    quantity: editing?.quantity ?? 0,
    min_quantity: editing?.min_quantity ?? 0,
    location: editing?.location ?? "",
    state: (editing?.state ?? "branco") as "casco" | "branco",
  });
  const mut = useMutation({
    mutationFn: () => upsertShell({ data: { id: editing?.id, ...f, quantity: Number(f.quantity), min_quantity: Number(f.min_quantity) } as any }),
    onSuccess: () => { toast.success(editing ? "Atualizado" : "Adicionado"); setOpen(false); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? <Button variant="ghost" size="sm">Editar</Button> : <Button className="gap-2"><Plus className="size-4" /> Novo casco</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"} casco</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Código"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="ES001" className="font-mono h-11" /></Field>
          <Field label="Estrutura (código)"><Input value={f.structure_code} onChange={(e) => setF({ ...f, structure_code: e.target.value })} placeholder="01" className="font-mono h-11" /></Field>
          <Field label="Nome" cls="col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Casco Simples" className="h-11" /></Field>
          <Field label="Categoria"><Input value={f.category_code} onChange={(e) => setF({ ...f, category_code: e.target.value })} placeholder="CAM / SOF" className="font-mono h-11" /></Field>
          <Field label="Localização"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="A1-03" className="h-11" /></Field>
          <Field label="Quantidade"><Input type="number" min={0} value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} className="h-11" /></Field>
          <Field label="Mínimo"><Input type="number" min={0} value={f.min_quantity} onChange={(e) => setF({ ...f, min_quantity: Number(e.target.value) })} className="h-11" /></Field>
          <Field label="Estado" cls="col-span-2">
            <select
              value={f.state}
              onChange={(e) => setF({ ...f, state: e.target.value as "casco" | "branco" })}
              className="w-full h-11 border rounded-md px-3 bg-background"
            >
              <option value="branco">Branco (estrutura + branco prontos — salta Estrutura e Branco)</option>
              <option value="casco">Casco (só estrutura nua — salta só Estrutura)</option>
            </select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>{mut.isPending ? "A guardar…" : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdjustDialog({ itemType, itemId, label, onDone }: { itemType: "shell" | "cover" | "fabric"; itemId: string; label: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState("");
  const mut = useMutation({
    mutationFn: () => adjustStock({ data: { item_type: itemType, item_id: itemId, delta: Number(delta), reason } }),
    onSuccess: () => { toast.success("Stock ajustado"); setOpen(false); setDelta(0); setReason(""); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="ghost" size="icon" title="Ajustar stock"><ArrowUpDown className="size-4" /></Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Ajustar stock — {label}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Field label={`Delta (+ entrada / − saída) ${itemType === "fabric" ? "em metros" : ""}`}>
            <Input type="number" value={delta} onChange={(e) => setDelta(Number(e.target.value))} className="h-11" step={itemType === "fabric" ? "0.1" : "1"} />
          </Field>
          <Field label="Motivo"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ex: receção de rolo / correção" className="h-11" /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !delta}>{mut.isPending ? "A guardar…" : "Confirmar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProduceDialog({ itemType, itemId, label, onDone }: { itemType: "shell" | "cover"; itemId: string; label: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(1);
  const mut = useMutation({
    mutationFn: () => createStockProduction({ data: { item_type: itemType, item_id: itemId, quantity: qty } }),
    onSuccess: (res: any) => { toast.success(`Ordem ${res.order_number} criada`); setOpen(false); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="ghost" size="icon" title="Produzir para stock"><Factory className="size-4" /></Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Produzir para stock</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{label}</p>
        <Field label="Quantidade"><Input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} className="h-11" /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || qty < 1}>{mut.isPending ? "A criar…" : "Criar ordem"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children, cls }: { label: React.ReactNode; children: React.ReactNode; cls?: string }) {
  return (
    <div className={`space-y-1.5 ${cls ?? ""}`}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}