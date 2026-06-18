import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import { listCovers, upsertCover, deleteCover } from "@/lib/stock.functions";
import { getCatalogs } from "@/lib/catalog.functions";
import { AdjustDialog, ProduceDialog } from "./stock.cascos";

export const Route = createFileRoute("/_authenticated/stock/capas")({
  component: CapasPage,
});

function CapasPage() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ["covers"], queryFn: () => listCovers() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["covers"] });
  const del = useMutation({
    mutationFn: (id: string) => deleteCover({ data: { id } }),
    onSuccess: () => { toast.success("Removido"); refresh(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Capas</h1>
          <p className="text-sm text-muted-foreground">Tecido cortado e costurado, específico do produto.</p>
        </div>
        <UpsertCover onDone={refresh} />
      </div>
      <Card className="p-2 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Modelo</TableHead>
              <TableHead>Medida</TableHead>
              <TableHead>Tecido</TableHead>
              <TableHead>Cor</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Disponível</TableHead>
              <TableHead className="text-right">Reservado</TableHead>
              <TableHead className="text-right">Mínimo</TableHead>
              <TableHead>Local.</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-6">A carregar…</TableCell></TableRow>}
            {!isLoading && rows.length === 0 && (
              <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-6">Sem capas registadas</TableCell></TableRow>
            )}
            {rows.map((r: any) => {
              const available = Number(r.quantity) - Number(r.reserved ?? 0);
              const low = available <= Number(r.min_quantity ?? 0);
              return (
                <TableRow key={r.id} className={low ? "bg-destructive/5" : ""}>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell className="text-sm">{r.name}</TableCell>
                  <TableCell className="font-mono text-xs">{r.model_code ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.measure_code ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{[r.fabric_type_code, r.fabric_ref_code].filter(Boolean).join("·") || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.color_code ?? "—"}</TableCell>
                  <TableCell className="text-xs">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${r.state === 'pronta' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'}`}>
                      {r.state === 'pronta' ? 'Pronta' : 'Cortada'}
                    </span>
                  </TableCell>
                  <TableCell className={`text-right font-semibold ${low ? "text-destructive" : ""}`}>{available}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{r.reserved}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{r.min_quantity}</TableCell>
                  <TableCell className="text-xs">{r.location ?? "—"}</TableCell>
                  <TableCell className="text-right space-x-1 whitespace-nowrap">
                    <AdjustDialog itemType="cover" itemId={r.id} label={r.code} onDone={refresh} />
                    <ProduceDialog itemType="cover" itemId={r.id} label={`${r.code} · ${r.name}`} onDone={refresh} />
                    <UpsertCover editing={r} onDone={refresh} />
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm(`Apagar capa ${r.code}?`)) del.mutate(r.id); }}>
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

function UpsertCover({ editing, onDone }: { editing?: any; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const { data: cat } = useQuery({ queryKey: ["catalogs"], queryFn: () => getCatalogs(), enabled: open });
  const [f, setF] = useState<any>({
    code: editing?.code ?? "",
    name: editing?.name ?? "",
    model_code: editing?.model_code ?? "",
    structure_code: editing?.structure_code ?? "",
    measure_code: editing?.measure_code ?? "",
    fabric_type_code: editing?.fabric_type_code ?? "",
    fabric_ref_code: editing?.fabric_ref_code ?? "",
    color_code: editing?.color_code ?? "",
    quantity: editing?.quantity ?? 0,
    min_quantity: editing?.min_quantity ?? 0,
    location: editing?.location ?? "",
    state: (editing?.state ?? "pronta") as "cortada" | "pronta",
  });

  const autoName = useMemo(() => {
    const lookup = (arr: any[], code: string) => arr?.find((x) => x.code === code)?.name;
    const parts = [
      lookup(cat?.models ?? [], f.model_code),
      lookup(cat?.measures ?? [], f.measure_code),
      lookup(cat?.fabric_refs ?? [], f.fabric_ref_code),
      lookup(cat?.colors ?? [], f.color_code),
    ].filter(Boolean);
    return parts.join(" ");
  }, [cat, f]);

  const mut = useMutation({
    mutationFn: () => upsertCover({ data: { id: editing?.id, ...f, name: f.name || autoName, quantity: Number(f.quantity), min_quantity: Number(f.min_quantity) } }),
    onSuccess: () => { toast.success(editing ? "Atualizado" : "Adicionado"); setOpen(false); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? <Button variant="ghost" size="sm">Editar</Button> : <Button className="gap-2"><Plus className="size-4" /> Nova capa</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{editing ? "Editar" : "Nova"} capa</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <FieldL label="Código"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} className="h-11 font-mono" /></FieldL>
          <FieldL label="Nome" cls="md:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="h-11" placeholder={autoName || "Nome da capa"} /></FieldL>
          <CodeSelect label="Modelo" items={cat?.models} value={f.model_code} onChange={(v) => setF({ ...f, model_code: v })} />
          <CodeSelect label="Estrutura" items={cat?.structures} value={f.structure_code} onChange={(v) => setF({ ...f, structure_code: v })} />
          <CodeSelect label="Medida" items={cat?.measures} value={f.measure_code} onChange={(v) => setF({ ...f, measure_code: v })} />
          <CodeSelect label="Tipo Tecido" items={cat?.fabric_types} value={f.fabric_type_code} onChange={(v) => setF({ ...f, fabric_type_code: v })} />
          <CodeSelect label="Ref. Tecido" items={cat?.fabric_refs} value={f.fabric_ref_code} onChange={(v) => setF({ ...f, fabric_ref_code: v })} />
          <CodeSelect label="Cor" items={cat?.colors} value={f.color_code} onChange={(v) => setF({ ...f, color_code: v })} />
          <FieldL label="Quantidade"><Input type="number" min={0} value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} className="h-11" /></FieldL>
          <FieldL label="Mínimo"><Input type="number" min={0} value={f.min_quantity} onChange={(e) => setF({ ...f, min_quantity: Number(e.target.value) })} className="h-11" /></FieldL>
          <FieldL label="Localização"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} className="h-11" /></FieldL>
          <FieldL label="Estado" cls="md:col-span-3">
            <select
              value={f.state}
              onChange={(e) => setF({ ...f, state: e.target.value as "cortada" | "pronta" })}
              className="w-full h-11 border rounded-md px-3 bg-background"
            >
              <option value="pronta">Pronta (cortada + cosida — salta Corte e Costura)</option>
              <option value="cortada">Cortada (só falta coser — salta só Corte)</option>
            </select>
          </FieldL>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !f.code}>{mut.isPending ? "A guardar…" : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldL({ label, children, cls }: { label: React.ReactNode; children: React.ReactNode; cls?: string }) {
  return <div className={`space-y-1.5 ${cls ?? ""}`}><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}

function CodeSelect({ label, items, value, onChange }: { label: string; items?: any[]; value: string; onChange: (v: string) => void }) {
  return (
    <FieldL label={label}>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger className="h-11"><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>
          {(items ?? []).map((m: any) => (
            <SelectItem key={m.id} value={m.code}>
              <span className="font-mono text-xs text-muted-foreground mr-2">{m.code}</span>{m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldL>
  );
}