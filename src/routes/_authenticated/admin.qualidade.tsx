import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Save, ClipboardCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  listQualityTemplates, upsertQualityTemplate, setTemplateItems,
  type QualityTemplate,
} from "@/lib/quality.functions";

export const Route = createFileRoute("/_authenticated/admin/qualidade")({
  component: AdminQualidadePage,
});

function AdminQualidadePage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listQualityTemplates);
  const upsertFn = useServerFn(upsertQualityTemplate);
  const setItemsFn = useServerFn(setTemplateItems);

  const { data: templates } = useQuery({
    queryKey: ["quality-templates"],
    queryFn: () => listFn(),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const tpl = (templates ?? []).find((t) => t.id === selectedId);

  useEffect(() => {
    if (!selectedId && templates && templates.length > 0) setSelectedId(templates[0].id);
  }, [templates, selectedId]);

  const createMut = useMutation({
    mutationFn: (vars: { category_code: string; name: string }) => upsertFn({ data: vars }),
    onSuccess: () => {
      toast.success("Template criado");
      qc.invalidateQueries({ queryKey: ["quality-templates"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-3">
        <ClipboardCheck className="size-6 text-primary" />
        <h1 className="text-2xl font-bold">Templates de Qualidade</h1>
      </div>

      <NewTemplateCard onCreate={(v) => createMut.mutate(v)} pending={createMut.isPending} />

      <div className="grid md:grid-cols-[260px_1fr] gap-4">
        <Card className="p-2">
          <div className="text-xs text-muted-foreground px-2 py-1">Templates</div>
          {(templates ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground p-3">Sem templates</div>
          ) : (templates ?? []).map((t) => (
            <button key={t.id} onClick={() => setSelectedId(t.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm ${
                selectedId === t.id ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              }`}>
              <div className="font-medium">{t.name}</div>
              <div className="text-[10px] opacity-80">{t.category_code} · {t.items.length} itens</div>
            </button>
          ))}
        </Card>

        {tpl ? (
          <TemplateEditor key={tpl.id} template={tpl}
            onSave={async (items) => {
              await setItemsFn({ data: { template_id: tpl.id, items } });
              toast.success("Itens guardados");
              qc.invalidateQueries({ queryKey: ["quality-templates"] });
            }} />
        ) : (
          <Card className="p-6 text-center text-muted-foreground">
            Cria ou seleciona um template
          </Card>
        )}
      </div>
    </div>
  );
}

function NewTemplateCard({ onCreate, pending }: { onCreate: (v: { category_code: string; name: string }) => void; pending: boolean }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  return (
    <Card className="p-3 flex flex-wrap items-end gap-2">
      <div>
        <Label className="text-xs">Categoria</Label>
        <Select value={code} onValueChange={setCode}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="CAM / SOF..." /></SelectTrigger>
          <SelectContent>
            <SelectItem value="CAM">CAM — Cama</SelectItem>
            <SelectItem value="SOF">SOF — Sofá</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex-1 min-w-[200px]">
        <Label className="text-xs">Nome</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Conferência Cama..." />
      </div>
      <Button disabled={pending || !code || !name} onClick={() => { onCreate({ category_code: code, name }); setName(""); setCode(""); }}>
        <Plus className="size-4" /> Novo template
      </Button>
    </Card>
  );
}

function TemplateEditor({ template, onSave }: {
  template: QualityTemplate;
  onSave: (items: { label: string; sort_order: number }[]) => Promise<void>;
}) {
  const [items, setItems] = useState(template.items.map((i) => ({ label: i.label, sort_order: i.sort_order })));
  const [saving, setSaving] = useState(false);
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">{template.name}</div>
          <div className="text-xs text-muted-foreground">Categoria {template.category_code}</div>
        </div>
        <Button disabled={saving} onClick={async () => {
          setSaving(true);
          try { await onSave(items.map((i, idx) => ({ ...i, sort_order: idx + 1 }))); }
          finally { setSaving(false); }
        }}>
          <Save className="size-4" /> Guardar itens
        </Button>
      </div>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-6">{i + 1}.</span>
            <Input value={it.label} onChange={(e) => setItems((arr) => arr.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))} />
            <Button variant="ghost" size="icon" onClick={() => setItems((arr) => arr.filter((_, idx) => idx !== i))}>
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setItems((arr) => [...arr, { label: "", sort_order: arr.length + 1 }])}>
          <Plus className="size-4" /> Adicionar item
        </Button>
      </div>
    </Card>
  );
}
