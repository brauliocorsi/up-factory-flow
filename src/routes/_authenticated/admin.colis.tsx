import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listModels } from "@/lib/orders.functions";
import {
  listPackagesByModel,
  upsertPackage,
  deletePackage,
  type ModelPackage,
} from "@/lib/packages.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Package } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/colis")({
  component: ColisAdminPage,
});

type Draft = {
  package_number: number;
  package_name: string;
  structure_type: string;
};

function ColisAdminPage() {
  const qc = useQueryClient();
  const { data: models } = useQuery({ queryKey: ["models"], queryFn: () => listModels() });
  const [modelId, setModelId] = useState<string>("");

  const { data: packages } = useQuery({
    queryKey: ["packages", modelId],
    queryFn: () => listPackagesByModel({ data: { model_id: modelId } }),
    enabled: !!modelId,
  });

  const [draft, setDraft] = useState<Draft>({ package_number: 1, package_name: "", structure_type: "" });

  const save = useMutation({
    mutationFn: (p: {
      model_id: string;
      structure_type: string | null;
      package_number: number;
      package_total: number;
      package_name: string;
    }) => upsertPackage({ data: p }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["packages", modelId] });
      setDraft({ package_number: (packages?.length ?? 0) + 2, package_name: "", structure_type: "" });
      toast.success("Coli guardado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deletePackage({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["packages", modelId] });
      toast.success("Coli removido");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Auto-calc total based on max package_number in same structure group
  const currentTotal = Math.max(
    draft.package_number,
    ...((packages ?? [])
      .filter((p) => (p.structure_type ?? "") === (draft.structure_type || ""))
      .map((p) => p.package_total)),
    1,
  );

  function handleAdd() {
    if (!modelId) return toast.error("Escolhe um modelo");
    if (!draft.package_name.trim()) return toast.error("Indica o nome do coli");
    save.mutate({
      model_id: modelId,
      structure_type: draft.structure_type || null,
      package_number: draft.package_number,
      package_total: currentTotal,
      package_name: draft.package_name.trim(),
    });
  }

  // Group by structure_type for display
  const grouped = groupByStructure(packages ?? []);

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Package className="size-6" /> Gestão de Colis
        </h1>
        <p className="text-sm text-muted-foreground">
          Define quantas caixas (colis) cada modelo tem, para que as etiquetas saiam corretamente.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <Label>Modelo</Label>
        <Select value={modelId} onValueChange={setModelId}>
          <SelectTrigger className="h-11"><SelectValue placeholder="Escolhe um modelo…" /></SelectTrigger>
          <SelectContent>
            {(models ?? []).map((m: any) => (
              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Card>

      {modelId && (
        <>
          <Card className="p-4 space-y-3">
            <h2 className="font-semibold">Adicionar coli</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">Estrutura (opcional)</Label>
                <Input
                  placeholder="ex: 2 cabeceiras"
                  value={draft.structure_type}
                  onChange={(e) => setDraft((d) => ({ ...d, structure_type: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs">Nº do coli</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={draft.package_number}
                  onChange={(e) => setDraft((d) => ({ ...d, package_number: Number(e.target.value) || 1 }))}
                />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">Nome do coli</Label>
                <Input
                  placeholder="Cabeceira, Ilhargas, …"
                  value={draft.package_name}
                  onChange={(e) => setDraft((d) => ({ ...d, package_name: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <div>Total será: <strong>{currentTotal}</strong> coli{currentTotal === 1 ? "" : "s"}</div>
              <Button onClick={handleAdd} disabled={save.isPending} className="gap-2">
                <Plus className="size-4" /> Adicionar
              </Button>
            </div>
          </Card>

          {Object.entries(grouped).map(([structure, items]) => (
            <Card key={structure} className="overflow-hidden">
              <div className="px-4 py-2 bg-muted text-sm font-semibold border-b">
                {structure || "Padrão (todas as estruturas)"}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Nº</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead className="w-24">Total</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono">{p.package_number}/{p.package_total}</TableCell>
                      <TableCell>{p.package_name}</TableCell>
                      <TableCell>{p.package_total}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => remove.mutate(p.id)}
                          disabled={remove.isPending}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          ))}

          {(packages ?? []).length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-6">
              Sem colis definidos para este modelo.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function groupByStructure(rows: ModelPackage[]): Record<string, ModelPackage[]> {
  const out: Record<string, ModelPackage[]> = {};
  for (const r of rows) {
    const k = r.structure_type ?? "";
    (out[k] ??= []).push(r);
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.package_number - b.package_number);
  return out;
}