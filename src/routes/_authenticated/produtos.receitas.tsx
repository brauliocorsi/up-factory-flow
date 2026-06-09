import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import { listRecipes, upsertRecipe, deleteRecipe, listShells } from "@/lib/stock.functions";
import { getCatalogs } from "@/lib/catalog.functions";

export const Route = createFileRoute("/_authenticated/produtos/receitas")({
  component: RecipesPage,
});

function RecipesPage() {
  const qc = useQueryClient();
  const { data: recipes = [], isLoading } = useQuery({ queryKey: ["recipes"], queryFn: () => listRecipes() });
  const { data: shells = [] } = useQuery({ queryKey: ["shells"], queryFn: () => listShells() });
  const shellById = useMemo(() => new Map((shells as any[]).map((s) => [s.id, s])), [shells]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["recipes"] });
  const del = useMutation({
    mutationFn: (id: string) => deleteRecipe({ data: { id } }),
    onSuccess: () => { toast.success("Removido"); refresh(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Receitas de produtos</h1>
          <p className="text-sm text-muted-foreground">Define que casco e capa cada produto consome.</p>
        </div>
        <UpsertRecipe onDone={refresh} />
      </div>
      <Card className="p-2 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead>Casco</TableHead>
              <TableHead className="text-center">Capa?</TableHead>
              <TableHead className="text-right">Metros/un.</TableHead>
              <TableHead>Espuma</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">A carregar…</TableCell></TableRow>}
            {!isLoading && recipes.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Sem receitas</TableCell></TableRow>
            )}
            {recipes.map((r: any) => {
              const shell = r.shell_id ? shellById.get(r.shell_id) : null;
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.category_code}·{r.model_code}·{r.structure_code}·{r.measure_code}</TableCell>
                  <TableCell>{shell ? <Badge variant="secondary">{shell.code} {shell.name}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-center">{r.cover_required ? "Sim" : "Não"}</TableCell>
                  <TableCell className="text-right">{r.meters_per_unit ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.foam_description ?? "—"}</TableCell>
                  <TableCell className="text-right space-x-1 whitespace-nowrap">
                    <UpsertRecipe editing={r} onDone={refresh} />
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm("Apagar receita?")) del.mutate(r.id); }}>
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

function UpsertRecipe({ editing, onDone }: { editing?: any; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const { data: cat } = useQuery({ queryKey: ["catalogs"], queryFn: () => getCatalogs(), enabled: open });
  const { data: shells = [] } = useQuery({ queryKey: ["shells"], queryFn: () => listShells(), enabled: open });
  const [f, setF] = useState<any>({
    category_code: editing?.category_code ?? "",
    model_code: editing?.model_code ?? "",
    structure_code: editing?.structure_code ?? "",
    measure_code: editing?.measure_code ?? "",
    shell_id: editing?.shell_id ?? "",
    cover_required: editing?.cover_required ?? true,
    meters_per_unit: editing?.meters_per_unit ?? "",
    foam_description: editing?.foam_description ?? "",
    notes: editing?.notes ?? "",
  });

  // Auto-suggest shell based on structure_code match
  useEffect(() => {
    if (!editing && f.structure_code && !f.shell_id) {
      const suggested = (shells as any[]).find((s) => s.structure_code === f.structure_code && (!f.category_code || s.category_code === f.category_code));
      if (suggested) setF((p: any) => ({ ...p, shell_id: suggested.id }));
    }
  }, [f.structure_code, f.category_code, shells, editing, f.shell_id]);

  const mut = useMutation({
    mutationFn: () => upsertRecipe({ data: {
      id: editing?.id,
      category_code: f.category_code, model_code: f.model_code,
      structure_code: f.structure_code, measure_code: f.measure_code,
      shell_id: f.shell_id || null,
      cover_required: f.cover_required,
      meters_per_unit: f.meters_per_unit === "" ? null : Number(f.meters_per_unit),
      foam_description: f.foam_description || null,
      notes: f.notes || null,
    } }),
    onSuccess: () => { toast.success(editing ? "Atualizado" : "Adicionado"); setOpen(false); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? <Button variant="ghost" size="sm">Editar</Button> : <Button className="gap-2"><Plus className="size-4" /> Nova receita</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{editing ? "Editar" : "Nova"} receita</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Picker label="Categoria" items={cat?.categories} value={f.category_code} onChange={(v) => setF({ ...f, category_code: v })} />
          <Picker label="Modelo" items={(cat?.models ?? []).filter((m: any) => !f.category_code || cat?.categories.find((c: any) => c.code === f.category_code)?.id === m.category_id)} value={f.model_code} onChange={(v) => setF({ ...f, model_code: v })} />
          <Picker label="Estrutura" items={cat?.structures} value={f.structure_code} onChange={(v) => setF({ ...f, structure_code: v })} />
          <Picker label="Medida" items={cat?.measures} value={f.measure_code} onChange={(v) => setF({ ...f, measure_code: v })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Fld label="Casco (sugerido pela estrutura)">
            <Select value={f.shell_id || undefined} onValueChange={(v) => setF({ ...f, shell_id: v })}>
              <SelectTrigger className="h-11"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {(shells as any[]).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="font-mono text-xs mr-2">{s.code}</span>{s.name}
                    {s.structure_code && <span className="text-muted-foreground ml-2">[{s.structure_code}]</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Fld>
          <Fld label="Metros/unidade"><Input type="number" min={0} step="0.1" value={f.meters_per_unit} onChange={(e) => setF({ ...f, meters_per_unit: e.target.value })} className="h-11" /></Fld>
        </div>
        <Fld label="Espuma"><Input value={f.foam_description} onChange={(e) => setF({ ...f, foam_description: e.target.value })} className="h-11" placeholder="ex: 4cm densidade 30" /></Fld>
        <div className="flex items-center gap-2">
          <Switch checked={f.cover_required} onCheckedChange={(v) => setF({ ...f, cover_required: v })} />
          <Label className="text-sm">Precisa de capa</Label>
        </div>
        <Fld label="Notas"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} /></Fld>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !f.category_code || !f.model_code || !f.structure_code || !f.measure_code}>
            {mut.isPending ? "A guardar…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Picker({ label, items, value, onChange }: { label: string; items?: any[]; value: string; onChange: (v: string) => void }) {
  return (
    <Fld label={label}>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger className="h-11"><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>{(items ?? []).map((m: any) => <SelectItem key={m.id} value={m.code}><span className="font-mono text-xs mr-2">{m.code}</span>{m.name}</SelectItem>)}</SelectContent>
      </Select>
    </Fld>
  );
}

function Fld({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}