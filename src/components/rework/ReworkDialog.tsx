import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STAGE_LABELS } from "@/lib/format";
import { STAGES, type Stage } from "@/lib/production.functions";
import { listReworkReasons, sendToRework } from "@/lib/rework.functions";

const ORDER: Stage[] = ["estrutura","corte","costura","branco","estofagem","qualidade","embalagem","picagem"];

export function ReworkDialog({
  orderId, orderNumber, detectedStage, operatorCode,
}: { orderId: string; orderNumber: string; detectedStage: Stage; operatorCode: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Stage | "">("");
  const [reasonId, setReasonId] = useState<string>("");
  const [notes, setNotes] = useState("");

  const fetchReasons = useServerFn(listReworkReasons);
  const sendFn = useServerFn(sendToRework);

  const { data: reasons } = useQuery({
    queryKey: ["rework-reasons"],
    queryFn: () => fetchReasons(),
    enabled: open,
  });

  const targets = ORDER.filter((s) => ORDER.indexOf(s) < ORDER.indexOf(detectedStage));

  const mut = useMutation({
    mutationFn: () => {
      if (!operatorCode) throw new Error("Indica o teu código de operador");
      if (!target) throw new Error("Escolhe a etapa de destino");
      if (!reasonId && !notes.trim()) throw new Error("Indica um motivo ou descreve no campo de notas");
      return sendFn({ data: {
        order_id: orderId,
        detected_stage: detectedStage,
        target_stage: target as Stage,
        operator_code: operatorCode,
        reason_id: reasonId || null,
        reason_notes: notes.trim() || null,
      }});
    },
    onSuccess: () => {
      // Fechar o diálogo e mostrar o toast ANTES de invalidar dados.
      // Caso contrário, o refetch pode desmontar o cartão (e o diálogo)
      // antes do React conseguir aplicar este estado, deixando ecrã em branco.
      setOpen(false);
      setTarget(""); setReasonId(""); setNotes("");
      toast.success(`Encomenda ${orderNumber} enviada para retrabalho`);
      // Adiar a invalidação para o próximo tick para garantir que o diálogo
      // já está fechado quando os dados mudam.
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["production"] });
        qc.invalidateQueries({ queryKey: ["rework-events"] });
        qc.invalidateQueries({ queryKey: ["rework-metrics"] });
      }, 0);
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao enviar para retrabalho"),
  });

  if (targets.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1 text-orange-700 border-orange-300 hover:bg-orange-50">
          <Wrench className="size-4" /> Enviar para retrabalho
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enviar para retrabalho — {orderNumber}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Etapa de destino</Label>
            <Select value={target} onValueChange={(v) => setTarget(v as Stage)}>
              <SelectTrigger><SelectValue placeholder="Escolhe a etapa..." /></SelectTrigger>
              <SelectContent>
                {targets.map((s) => (
                  <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">
              Detetado em <strong>{STAGE_LABELS[detectedStage]}</strong>. Só pode voltar a etapas anteriores.
            </p>
          </div>
          <div>
            <Label>Motivo</Label>
            <Select value={reasonId} onValueChange={setReasonId}>
              <SelectTrigger><SelectValue placeholder="Escolhe um motivo..." /></SelectTrigger>
              <SelectContent>
                {(reasons ?? []).map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notas (opcional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Detalhe o que foi detetado..." rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending} className="bg-orange-600 hover:bg-orange-700">
            Confirmar retrabalho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}