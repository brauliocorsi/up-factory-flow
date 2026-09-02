import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { bulkCancelOrders, bulkDeleteOrders, setOrdersDates, setOrdersPriority } from "@/lib/orders.functions";
import { activateOrders } from "@/lib/planning.functions";
import { CalendarDays, Flag, PlayCircle, Trash2, XCircle } from "lucide-react";

type Props = {
  ids: string[];
  canEdit: boolean;
  isAdmin: boolean;
  onDone: () => void;
};

export function BulkOrderActions({ ids, canEdit, isAdmin, onDone }: Props) {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<null | "dates" | "cancel" | "delete">(null);
  const [entryDate, setEntryDate] = useState("");
  const [dueDate, setDueDate] = useState("");

  function refresh() {
    for (const key of [["orders"], ["planning-orders"], ["dashboard"], ["urgent-active"]]) {
      qc.invalidateQueries({ queryKey: key });
    }
    onDone();
  }

  const prio = useMutation({
    mutationFn: (priority: number) => setOrdersPriority({ data: { order_ids: ids, priority } }),
    onSuccess: () => { toast.success("Prioridade atualizada"); refresh(); },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao alterar prioridade"),
  });

  const activate = useMutation({
    mutationFn: () => activateOrders({ data: { order_ids: ids } }),
    onSuccess: (r: any) => {
      const n = r?.activated?.length ?? ids.length;
      toast.success(`${n} encomenda(s) ativa(s) em produção`);
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao ativar"),
  });

  const dates = useMutation({
    mutationFn: () =>
      setOrdersDates({
        data: {
          order_ids: ids,
          ...(entryDate ? { entry_date: entryDate } : {}),
          ...(dueDate ? { due_date: dueDate } : {}),
        },
      }),
    onSuccess: (r) => {
      toast.success(r.message ?? `Datas alteradas em ${r.affected} encomenda(s)`);
      setDialog(null); setEntryDate(""); setDueDate("");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao alterar datas"),
  });

  const cancelMany = useMutation({
    mutationFn: () => bulkCancelOrders({ data: { order_ids: ids } }),
    onSuccess: (r) => {
      toast.success(`${r.affected} encomenda(s) cancelada(s)${r.skipped.length ? ` · ${r.skipped.length} falharam` : ""}`);
      setDialog(null);
      qc.invalidateQueries({ queryKey: ["shells"] });
      qc.invalidateQueries({ queryKey: ["covers"] });
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao cancelar"),
  });

  const deleteMany = useMutation({
    mutationFn: () => bulkDeleteOrders({ data: { order_ids: ids } }),
    onSuccess: (r) => {
      if (r.affected > 0) toast.success(`${r.affected} encomenda(s) apagada(s)`);
      if (r.message) toast.warning(r.message);
      setDialog(null);
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao apagar"),
  });

  if (!canEdit || ids.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2">
      <span className="text-sm font-medium px-1">{ids.length} selecionada(s)</span>

      <Select value="" onValueChange={(v) => prio.mutate(Number(v))}>
        <SelectTrigger className="h-9 w-[190px]">
          <span className="flex items-center gap-2 text-sm"><Flag className="size-4" /> Prioridade…</span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="3">Urgente</SelectItem>
          <SelectItem value="2">Média</SelectItem>
          <SelectItem value="1">Baixa</SelectItem>
        </SelectContent>
      </Select>

      <Button size="sm" variant="outline" className="gap-2" disabled={activate.isPending} onClick={() => activate.mutate()}>
        <PlayCircle className="size-4" /> Deixar ativa
      </Button>

      <Button size="sm" variant="outline" className="gap-2" onClick={() => setDialog("dates")}>
        <CalendarDays className="size-4" /> Alterar datas
      </Button>

      <Button size="sm" variant="outline" className="gap-2 text-destructive" onClick={() => setDialog("cancel")}>
        <XCircle className="size-4" /> Cancelar
      </Button>

      {isAdmin && (
        <Button size="sm" variant="destructive" className="gap-2" onClick={() => setDialog("delete")}>
          <Trash2 className="size-4" /> Apagar
        </Button>
      )}

      <Dialog open={dialog === "dates"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar datas de {ids.length} encomenda(s)</DialogTitle>
            <DialogDescription>Deixa em branco o campo que não queres alterar.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="bulk-entry">Entrada</Label>
              <Input id="bulk-entry" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bulk-due">Saída</Label>
              <Input id="bulk-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Voltar</Button>
            <Button disabled={(!entryDate && !dueDate) || dates.isPending} onClick={() => dates.mutate()}>
              {dates.isPending ? "A guardar…" : "Guardar datas"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "cancel"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar {ids.length} encomenda(s)?</DialogTitle>
            <DialogDescription>
              As reservas de casco/capa são libertadas e as etapas não concluídas são anuladas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Voltar</Button>
            <Button variant="destructive" disabled={cancelMany.isPending} onClick={() => cancelMany.mutate()}>
              {cancelMany.isPending ? "A cancelar…" : "Confirmar cancelamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "delete"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apagar {ids.length} encomenda(s) definitivamente?</DialogTitle>
            <DialogDescription>
              Ação irreversível. Encomendas com produção iniciada ou stock acabado não são apagadas — essas devem ser canceladas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Voltar</Button>
            <Button variant="destructive" disabled={deleteMany.isPending} onClick={() => deleteMany.mutate()}>
              {deleteMany.isPending ? "A apagar…" : "Apagar definitivamente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
