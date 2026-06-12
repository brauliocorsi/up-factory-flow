import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Boxes, Save } from "lucide-react";
import { toast } from "sonner";
import {
  listColiRoutes, upsertColiRoute, deleteColiRoute,
  listCategoriesAndStructures, STAGES, type Stage, type ColiRoute,
} from "@/lib/coliRoutes.functions";

export const Route = createFileRoute("/_authenticated/admin/rotas-colis")({
  component: ColiRoutesAdmin,
});

type Draft = {
  coli_number: number;
  coli_name: string;
  stages: Record<Stage, boolean>;
};

function emptyDraft(n: number): Draft {
  return {
    coli_number: n,
    coli_name: "",
    stages: Object.fromEntries(STAGES.map((s) => [s, true])) as Record<Stage, boolean>,
  };
}

function ColiRoutesAdmin() {
  const qc = useQueryClient();
  const { data: refs } = useQuery({
    queryKey: ["coli-refs"],
    queryFn: () => listCategoriesAndStructures(),
  });
  const [cat, setCat] = useState<string>("");
  const [struct, setStruct] = useState<string>("");

  const { data: routes = [] } = useQuery({
    queryKey: ["coli-routes", cat, struct],
    queryFn: () => listColiRoutes({ data: { category_code: cat, structure_code: struct } }),
    enabled: !!cat && !!struct,
  });

  const nextNumber = useMemo(
    () => (routes.length ? Math.max(...routes.map((r) => r.coli_number)) + 1 : 1),
    [routes],
  );
  const [draft, setDraft] = useState<Draft>(emptyDraft(1));

  const save = useMutation({
    mutationFn: (input: {
      id?: string;
      coli_number: number;
      coli_name: string;
      stages: Record<Stage, boolean>;
    }) =>
      upsertColiRoute({
        data: {
          id: input.id,
          category_code: cat,
          structure_code: struct,
          coli_number: input.coli_number,
          coli_name: input.coli_name.trim(),
          stages: STAGES.map((s) => ({ stage: s, included: input.stages[s] })),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coli-routes", cat, struct] });
      setDraft(emptyDraft(nextNumber + 1));
      toast.success("Coli guardado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteColiRoute({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coli-routes", cat, struct] });
      toast.success("Coli removido");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleAdd() {
    if (!cat || !struct) return toast.error("Escolhe categoria e estrutura");
    if (!draft.coli_name.trim()) return toast.error("Indica o nome do coli");
    save.mutate({
      coli_number: draft.coli_number,
      coli_name: draft.coli_name,
      stages: draft.stages,
    });
  }

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Boxes className="size-6" /> Rotas de Colis por Estrutura
        </h1>
        <p className="text-sm text-muted-foreground">
          Define os colis (volumes) e que etapas cada um percorre. As encomendas
          herdam automaticamente a rota da sua categoria + estrutura.
        </p>
      </div>

      <Card className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label>Categoria</Label>
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger className="h-11"><SelectValue placeholder="Escolhe…" /></SelectTrigger>
            <SelectContent>
              {(refs?.categories ?? []).map((c) => (
                <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Estrutura</Label>
          <Select value={struct} onValueChange={setStruct}>
            <SelectTrigger className="h-11"><SelectValue placeholder="Escolhe…" /></SelectTrigger>
            <SelectContent>
              {(refs?.structures ?? []).map((s) => (
                <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {cat && struct && (
        <>
          {/* Lista de colis existentes */}
          <div className="space-y-3">
            {routes.map((r) => (
              <RouteRow
                key={r.id}
                route={r}
                onSave={(payload) => save.mutate({ id: r.id, ...payload })}
                onDelete={() => remove.mutate(r.id)}
                busy={save.isPending || remove.isPending}
              />
            ))}
            {routes.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-4">
                Sem colis definidos. Adiciona o primeiro abaixo. Se ficar vazio,
                as encomendas desta estrutura usam um coli único "Produto completo".
              </div>
            )}
          </div>

          {/* Adicionar coli */}
          <Card className="p-4 space-y-3 border-primary/40">
            <h2 className="font-semibold">Adicionar coli</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">Nº</Label>
                <Input
                  type="number" min={1} max={20}
                  value={draft.coli_number}
                  onChange={(e) => setDraft((d) => ({ ...d, coli_number: Number(e.target.value) || 1 }))}
                />
              </div>
              <div className="md:col-span-3">
                <Label className="text-xs">Nome</Label>
                <Input
                  placeholder="Cabeceira, Ilhargas, Coxim…"
                  value={draft.coli_name}
                  onChange={(e) => setDraft((d) => ({ ...d, coli_name: e.target.value }))}
                />
              </div>
            </div>
            <StageChecks
              value={draft.stages}
              onChange={(s) => setDraft((d) => ({ ...d, stages: s }))}
            />
            <div className="flex justify-end">
              <Button onClick={handleAdd} disabled={save.isPending} className="gap-2">
                <Plus className="size-4" /> Adicionar coli
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function RouteRow({
  route, onSave, onDelete, busy,
}: {
  route: ColiRoute;
  onSave: (p: { coli_number: number; coli_name: string; stages: Record<Stage, boolean> }) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const initial = useMemo<Record<Stage, boolean>>(() => {
    const map = Object.fromEntries(STAGES.map((s) => [s, true])) as Record<Stage, boolean>;
    for (const s of route.stages) map[s.stage] = s.included;
    return map;
  }, [route]);
  const [name, setName] = useState(route.coli_name);
  const [num, setNum] = useState(route.coli_number);
  const [stages, setStages] = useState<Record<Stage, boolean>>(initial);

  return (
    <Card className="p-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <Label className="text-xs">Nº</Label>
          <Input type="number" min={1} max={20} value={num}
            onChange={(e) => setNum(Number(e.target.value) || 1)} />
        </div>
        <div className="md:col-span-3">
          <Label className="text-xs">Nome</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <StageChecks value={stages} onChange={setStages} />
      <div className="flex justify-between">
        <Button variant="ghost" size="sm" onClick={onDelete} disabled={busy}
          className="text-destructive">
          <Trash2 className="size-4 mr-1" /> Remover
        </Button>
        <Button size="sm" onClick={() => onSave({ coli_number: num, coli_name: name, stages })}
          disabled={busy} className="gap-2">
          <Save className="size-4" /> Guardar
        </Button>
      </div>
    </Card>
  );
}

function StageChecks({
  value, onChange,
}: {
  value: Record<Stage, boolean>;
  onChange: (v: Record<Stage, boolean>) => void;
}) {
  return (
    <div>
      <Label className="text-xs">Etapas que este coli percorre</Label>
      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
        {STAGES.map((s) => (
          <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={value[s]}
              onCheckedChange={(c) => onChange({ ...value, [s]: Boolean(c) })}
            />
            <span className="capitalize">{s}</span>
          </label>
        ))}
      </div>
    </div>
  );
}