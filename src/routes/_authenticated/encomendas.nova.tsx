import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { createOrder } from "@/lib/orders.functions";
import { getCatalogs } from "@/lib/catalog.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Tag, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/encomendas/nova")({
  component: NovaEncomendaPage,
});

function NovaEncomendaPage() {
  const navigate = useNavigate();
  const { data: cat } = useQuery({ queryKey: ["catalogs"], queryFn: () => getCatalogs() });
  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    order_number: "",
    category_id: "",
    model_id: "",
    structure_id: "",
    measure_id: "",
    fabric_type_id: "",
    fabric_ref_id: "",
    color_id: "",
    finishing: "N" as "F" | "N",
    entry_date: today,
    due_date: "",
    priority: 0,
    observation: "",
    notes: "",
  });

  const modelsForCat = useMemo(
    () => (cat?.models ?? []).filter((m: any) => !form.category_id || m.category_id === form.category_id),
    [cat, form.category_id],
  );

  const sel = {
    category: cat?.categories.find((x: any) => x.id === form.category_id),
    model: cat?.models.find((x: any) => x.id === form.model_id),
    structure: cat?.structures.find((x: any) => x.id === form.structure_id),
    measure: cat?.measures.find((x: any) => x.id === form.measure_id),
    fabric_type: cat?.fabric_types.find((x: any) => x.id === form.fabric_type_id),
    fabric_ref: cat?.fabric_refs.find((x: any) => x.id === form.fabric_ref_id),
    color: cat?.colors.find((x: any) => x.id === form.color_id),
  } as Record<string, any>;

  const generatedCode = [
    sel.category?.code,
    sel.model?.code,
    sel.structure?.code,
    sel.measure?.code,
    sel.fabric_type?.code,
    sel.fabric_ref?.code,
    sel.color?.code,
    form.finishing || "",
  ].filter(Boolean).join("");

  const generatedDescription = [
    sel.category?.name,
    sel.model?.name,
    sel.structure?.name,
    sel.measure?.name,
    sel.fabric_ref?.name,
    sel.color?.name,
    form.finishing === "F" ? "Flutuante" : form.finishing === "N" ? "Normal" : "",
  ].filter(Boolean).join(" ");

  const mut = useMutation({
    mutationFn: (input: any) => createOrder({ data: input }),
    onSuccess: (res: any) => {
      toast.success(`Encomenda ${res.order_number} criada`);
      navigate({ to: "/etiquetas/imprimir", search: { ids: res.id } });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao criar encomenda"),
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.order_number.trim()) {
      toast.error("Nº encomenda é obrigatório");
      return;
    }
    if (!generatedDescription) {
      toast.error("Escolha pelo menos categoria/modelo para gerar a descrição");
      return;
    }
    mut.mutate({
      order_number: form.order_number,
      product_description: generatedDescription,
      model_id: form.model_id || null,
      measure: sel.measure?.name ?? null,
      fabric_type: sel.fabric_type?.name ?? null,
      fabric_ref: sel.fabric_ref?.name ?? null,
      color: sel.color?.name ?? null,
      structure_type: sel.structure?.name ?? null,
      finishing: form.finishing || null,
      barcode: generatedCode || null,
      observation: form.observation || null,
      notes: form.notes || null,
      entry_date: form.entry_date,
      due_date: form.due_date || null,
      priority: Number(form.priority) || 0,
    });
  }

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link to="/encomendas"><ArrowLeft className="size-4" /> Voltar</Link>
        </Button>
      </div>
      <div>
        <h1 className="text-2xl font-bold">Nova encomenda</h1>
        <p className="text-sm text-muted-foreground">Escolha os atributos — o código de produto é gerado automaticamente.</p>
      </div>

      <form onSubmit={submit}>
        <Card className="p-4 space-y-4">
          {/* Live generated code */}
          <div className="rounded-md border bg-primary/5 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Código gerado</div>
            <div className="font-mono text-lg font-bold text-primary break-all">
              {generatedCode || <span className="text-muted-foreground font-normal">…</span>}
            </div>
            <div className="text-xs mt-1">{generatedDescription || <span className="text-muted-foreground">Descrição aparece aqui</span>}</div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Nº Encomenda *">
              <Input value={form.order_number} onChange={(e) => set("order_number", e.target.value)} className="h-11" placeholder="ex: 2026-0042" />
            </Field>
            <Field label="Categoria">
              <RefSelect items={cat?.categories ?? []} value={form.category_id} onChange={(v) => { set("category_id", v); set("model_id", ""); }} />
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Modelo">
              <RefSelect items={modelsForCat} value={form.model_id} onChange={(v) => set("model_id", v)} />
            </Field>
            <Field label="Estrutura">
              <RefSelect items={cat?.structures ?? []} value={form.structure_id} onChange={(v) => set("structure_id", v)} />
            </Field>
            <Field label="Medida">
              <RefSelect items={cat?.measures ?? []} value={form.measure_id} onChange={(v) => set("measure_id", v)} />
            </Field>
            <Field label="Tipo de Tecido">
              <RefSelect items={cat?.fabric_types ?? []} value={form.fabric_type_id} onChange={(v) => set("fabric_type_id", v)} />
            </Field>
            <Field label="Ref. Tecido">
              <RefSelect items={cat?.fabric_refs ?? []} value={form.fabric_ref_id} onChange={(v) => set("fabric_ref_id", v)} />
            </Field>
            <Field label="Cor">
              <RefSelect items={cat?.colors ?? []} value={form.color_id} onChange={(v) => set("color_id", v)} />
            </Field>
            <Field label="Acabamento">
              <Select value={form.finishing} onValueChange={(v) => set("finishing", v as "F" | "N")}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="N">N — Normal</SelectItem>
                  <SelectItem value="F">F — Flutuante</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Prioridade"><Input type="number" min={0} max={10} value={form.priority} onChange={(e) => set("priority", Number(e.target.value))} className="h-11" /></Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Data entrada"><Input type="date" value={form.entry_date} onChange={(e) => set("entry_date", e.target.value)} className="h-11" /></Field>
            <Field label="Data saída prevista"><Input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} className="h-11" /></Field>
          </div>

          <Field label={<span className="flex items-center gap-1.5"><AlertTriangle className="size-3.5 text-warning" /> Observação (aparece na produção e etiqueta)</span>}>
            <Textarea value={form.observation} onChange={(e) => set("observation", e.target.value)} rows={2} placeholder="ex: Cabeceira maior" />
          </Field>

          <Field label="Notas">
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button asChild variant="outline" type="button"><Link to="/encomendas">Cancelar</Link></Button>
            <Button type="submit" disabled={mut.isPending} className="gap-2">
              <Tag className="size-4" />
              {mut.isPending ? "A criar…" : "Criar encomenda"}
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function RefSelect({ items, value, onChange }: { items: Array<{ id: string; code: string; name: string }>; value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-11"><SelectValue placeholder="—" /></SelectTrigger>
      <SelectContent>
        {items.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">Sem opções</div>}
        {items.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            <span className="font-mono text-xs text-muted-foreground mr-2">{m.code}</span>{m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}