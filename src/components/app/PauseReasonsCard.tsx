import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { PauseCircle, Plus, Save } from "lucide-react";
import { listPauseReasons, upsertPauseReason, type PauseReason } from "@/lib/pauses.functions";
import { useAuth } from "@/hooks/useAuth";

export function PauseReasonsCard() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listPauseReasons);
  const saveFn = useServerFn(upsertPauseReason);
  const { data = [] } = useQuery({ queryKey: ["pause-reasons"], queryFn: () => listFn(), enabled: Boolean(session) });
  const [newLabel, setNewLabel] = useState("");

  const save = useMutation({
    mutationFn: (r: Omit<PauseReason, "id"> & { id?: string }) => saveFn({ data: r }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pause-reasons"] });
      toast.success("Motivo guardado");
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao guardar"),
  });

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h2 className="font-semibold flex items-center gap-2"><PauseCircle className="size-4" /> Motivos de pausa</h2>
        <p className="text-xs text-muted-foreground">O operador escolhe um destes motivos sempre que pausa. Desativa em vez de apagar.</p>
      </div>
      <div className="space-y-2">
        {(data as PauseReason[]).map((r) => (
          <ReasonRow key={r.id} reason={r} busy={save.isPending} onSave={(v) => save.mutate(v)} />
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const label = newLabel.trim();
          if (!label) return;
          const max = Math.max(0, ...(data as PauseReason[]).filter((r) => r.sort_order < 99).map((r) => r.sort_order));
          save.mutate({ label, sort_order: max + 1, requires_note: false, active: true });
          setNewLabel("");
        }}
      >
        <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Novo motivo (ex.: Reunião)" maxLength={80} />
        <Button type="submit" className="gap-1" disabled={!newLabel.trim()}><Plus className="size-4" /> Adicionar</Button>
      </form>
    </Card>
  );
}

function ReasonRow({ reason, busy, onSave }: { reason: PauseReason; busy: boolean; onSave: (r: PauseReason) => void }) {
  const [label, setLabel] = useState(reason.label);
  const [order, setOrder] = useState(String(reason.sort_order));
  const dirty = label.trim() !== reason.label || Number(order) !== reason.sort_order;
  return (
    <div className={`flex items-center gap-2 flex-wrap rounded-md border p-2 ${reason.active ? "" : "opacity-60"}`}>
      <Input className="w-16" type="number" min={0} max={999} value={order} onChange={(e) => setOrder(e.target.value)} title="Ordem" />
      <Input className="flex-1 min-w-40" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
      <Label className="flex items-center gap-1 text-xs">
        <Switch checked={reason.requires_note} onCheckedChange={(v) => onSave({ ...reason, requires_note: v })} /> Pede nota
      </Label>
      <Label className="flex items-center gap-1 text-xs">
        <Switch checked={reason.active} onCheckedChange={(v) => onSave({ ...reason, active: v })} /> Ativo
      </Label>
      {dirty && (
        <Button size="sm" disabled={busy || !label.trim()} className="gap-1"
          onClick={() => onSave({ ...reason, label: label.trim(), sort_order: Math.max(0, Math.min(999, Number(order) || 0)) })}>
          <Save className="size-3" /> Guardar
        </Button>
      )}
    </div>
  );
}
