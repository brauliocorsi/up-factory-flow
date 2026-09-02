import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getOrderForEdit, updateOrder, type EditableOrder } from "@/lib/orders.functions";
import { getCatalogs } from "@/lib/catalog.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PrioritySelect } from "@/components/planning/PrioritySelect";
import { Pencil } from "lucide-react";

type Draft = {
  customer_order: string;
  product_description: string;
  model_id: string;
  measure: string;
  fabric_type: string;
  fabric_ref: string;
  color: string;
  structure_type: string;
  finishing: string;
  entry_date: string;
  due_date: string;
  priority: number;
  notes: string;
  observation: string;
};

function toDraft(o: EditableOrder): Draft {
  return {
    customer_order: o.customer_order ?? "",
    product_description: o.product_description ?? "",
    model_id: o.model_id ?? "none",
    measure: o.measure ?? "",
    fabric_type: o.fabric_type ?? "",
    fabric_ref: o.fabric_ref ?? "",
    color: o.color ?? "",
    structure_type: o.structure_type ?? "",
    finishing: o.finishing ?? "",
    entry_date: o.entry_date ?? "",
    due_date: o.due_date ?? "",
    priority: o.priority ?? 1,
    notes: o.notes ?? "",
    observation: o.observation ?? "",
  };
}

export function EditOrderDialog({
  orderId,
  orderNumber,
  trigger,
}: {
  orderId: string;
  orderNumber: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const fetchOrder = useServerFn(getOrderForEdit);
  const saveFn = useServerFn(updateOrder);
  const [draft, setDraft] = useState<Draft | null>(null);

  const { data: order, isLoading } = useQuery({
    queryKey: ["order-edit", orderId],
    queryFn: () => fetchOrder({ data: { id: orderId } }) as Promise<EditableOrder>,
    enabled: open,
  });
  const { data: cat } = useQuery({ queryKey: ["catalogs"], queryFn: () => getCatalogs(), enabled: open });

  useEffect(() => {
    if (order) setDraft(toDraft(order));
  }, [order]);

  const save = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error("Sem dados");
      return saveFn({
        data: {
          id: orderId,
          customer_order: draft.customer_order,
          product_description: draft.product_description,
          model_id: draft.model_id === "none" ? null : draft.model_id,
          measure: draft.measure,
          fabric_type: draft.fabric_type,
          fabric_ref: draft.fabric_ref,
          color: draft.color,
          structure_type: draft.structure_type,
          finishing: draft.finishing,
          entry_date: draft.entry_date,
          due_date: draft.due_date,
          priority: draft.priority,
          notes: draft.notes,
          observation: draft.observation,
        },
      });
    },
    onSuccess: () => {
      toast.success(`Encomenda ${orderNumber} atualizada`);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["planning-orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["order-edit", orderId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao guardar"),
  });

  function set<K extends keyof Draft>(k: K, v: Draft[K]) {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  }

  const fabricRefs = (cat?.fabric_refs ?? []).filter((r: any) => {
    if (!draft?.fabric_type) return true;
    const ft = (cat?.fabric_types ?? []).find(
      (t: any) => t.name === draft.fabric_type || t.code === draft.fabric_type,
    );
    return !ft || !r.fabric_type_id || r.fabric_type_id === ft.id;
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : (
        <Button size="sm" variant="ghost" className="gap-1 h-8" onClick={() => setOpen(true)}>
          <Pencil className="size-3" /> Editar
        </Button>
      )}
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar encomenda {orderNumber}</DialogTitle>
        </DialogHeader>

        {isLoading || !draft ? (
          <div className="py-8 text-center text-sm text-muted-foreground">A carregar…</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <datalist id="dl-measures">
              {(cat?.measures ?? []).map((m: any) => <option key={m.id} value={m.name} />)}
            </datalist>
            <datalist id="dl-fabric-types">
              {(cat?.fabric_types ?? []).map((m: any) => <option key={m.id} value={m.name} />)}
            </datalist>
            <datalist id="dl-fabric-refs">
              {fabricRefs.map((m: any) => <option key={m.id} value={m.name} />)}
            </datalist>
            <datalist id="dl-colors">
              {(cat?.colors ?? []).map((m: any) => <option key={m.id} value={m.name} />)}
            </datalist>
            <datalist id="dl-structures">
              {(cat?.structures ?? []).map((m: any) => <option key={m.id} value={m.name} />)}
            </datalist>

            <div className="md:col-span-2 space-y-1">
              <Label>Descrição do produto</Label>
              <Input
                value={draft.product_description}
                onChange={(e) => set("product_description", e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label>Encomenda do cliente</Label>
              <Input value={draft.customer_order} onChange={(e) => set("customer_order", e.target.value)} />
            </div>

            <div className="space-y-1">
              <Label>Modelo</Label>
              <Select value={draft.model_id} onValueChange={(v) => set("model_id", v)}>
                <SelectTrigger><SelectValue placeholder="Sem modelo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem modelo</SelectItem>
                  {(cat?.models ?? []).map((m: any) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Medida</Label>
              <Input list="dl-measures" value={draft.measure} onChange={(e) => set("measure", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Estrutura</Label>
              <Input list="dl-structures" value={draft.structure_type} onChange={(e) => set("structure_type", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Tipo de tecido</Label>
              <Input list="dl-fabric-types" value={draft.fabric_type} onChange={(e) => set("fabric_type", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Ref. tecido</Label>
              <Input list="dl-fabric-refs" value={draft.fabric_ref} onChange={(e) => set("fabric_ref", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Cor</Label>
              <Input list="dl-colors" value={draft.color} onChange={(e) => set("color", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Acabamento</Label>
              <Input value={draft.finishing} onChange={(e) => set("finishing", e.target.value)} />
            </div>

            <div className="space-y-1">
              <Label>Data de entrada</Label>
              <Input type="date" value={draft.entry_date} onChange={(e) => set("entry_date", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Data de saída</Label>
              <Input type="date" value={draft.due_date} onChange={(e) => set("due_date", e.target.value)} />
            </div>

            <div className="space-y-1">
              <Label>Prioridade</Label>
              <div><PrioritySelect value={draft.priority} onChange={(p) => set("priority", p)} /></div>
            </div>

            <div className="md:col-span-2 space-y-1">
              <Label>Observação (visível na produção)</Label>
              <Textarea rows={2} value={draft.observation} onChange={(e) => set("observation", e.target.value)} />
            </div>
            <div className="md:col-span-2 space-y-1">
              <Label>Notas internas</Label>
              <Textarea rows={2} value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !draft}>
            {save.isPending ? "A guardar…" : "Guardar alterações"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
