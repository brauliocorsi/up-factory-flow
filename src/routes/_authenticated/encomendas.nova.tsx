import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { createOrder, listModels } from "@/lib/orders.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Tag } from "lucide-react";

export const Route = createFileRoute("/_authenticated/encomendas/nova")({
  component: NovaEncomendaPage,
});

function NovaEncomendaPage() {
  const navigate = useNavigate();
  const { data: models } = useQuery({ queryKey: ["models"], queryFn: () => listModels() });
  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    order_number: "",
    product_description: "",
    model_id: "",
    measure: "",
    fabric_type: "",
    fabric_ref: "",
    color: "",
    structure_type: "",
    entry_date: today,
    due_date: "",
    priority: 0,
    notes: "",
  });

  const mut = useMutation({
    mutationFn: (input: any) => createOrder({ data: input }),
    onSuccess: (res: any) => {
      toast.success(`Encomenda ${res.order_number} criada`);
      navigate({ to: "/encomendas/$id/etiqueta", params: { id: res.id } });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao criar encomenda"),
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.order_number.trim() || !form.product_description.trim()) {
      toast.error("Nº encomenda e descrição são obrigatórios");
      return;
    }
    mut.mutate({
      ...form,
      model_id: form.model_id || null,
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
        <p className="text-sm text-muted-foreground">Lançar manualmente uma encomenda no chão de fábrica</p>
      </div>

      <form onSubmit={submit}>
        <Card className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Nº Encomenda *">
              <Input value={form.order_number} onChange={(e) => set("order_number", e.target.value)} className="h-11" placeholder="ex: 2026-0042" />
            </Field>
            <Field label="Modelo">
              <Select value={form.model_id} onValueChange={(v) => set("model_id", v)}>
                <SelectTrigger className="h-11"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {(models ?? []).map((m: any) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Descrição do produto *">
            <Input value={form.product_description} onChange={(e) => set("product_description", e.target.value)} className="h-11" />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Medida"><Input value={form.measure} onChange={(e) => set("measure", e.target.value)} className="h-11" /></Field>
            <Field label="Tipo de tecido"><Input value={form.fabric_type} onChange={(e) => set("fabric_type", e.target.value)} className="h-11" /></Field>
            <Field label="Ref. tecido"><Input value={form.fabric_ref} onChange={(e) => set("fabric_ref", e.target.value)} className="h-11" /></Field>
            <Field label="Cor"><Input value={form.color} onChange={(e) => set("color", e.target.value)} className="h-11" /></Field>
            <Field label="Tipo de estrutura"><Input value={form.structure_type} onChange={(e) => set("structure_type", e.target.value)} className="h-11" /></Field>
            <Field label="Prioridade"><Input type="number" min={0} max={10} value={form.priority} onChange={(e) => set("priority", Number(e.target.value))} className="h-11" /></Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Data entrada"><Input type="date" value={form.entry_date} onChange={(e) => set("entry_date", e.target.value)} className="h-11" /></Field>
            <Field label="Data saída prevista"><Input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} className="h-11" /></Field>
          </div>

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}