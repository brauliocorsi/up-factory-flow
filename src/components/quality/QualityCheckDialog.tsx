import { useState, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Camera, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ReworkDialog } from "@/components/rework/ReworkDialog";
import { getTemplateForOrder, submitQualityCheck } from "@/lib/quality.functions";
import { supabase } from "@/integrations/supabase/client";

type ItemState = {
  template_item_id: string | null;
  label: string;
  status: "ok" | "nok" | null;
  photo_url: string | null;
  uploading?: boolean;
};

export function QualityCheckDialog({
  orderId, orderStageId, orderNumber, productDescription, operatorCode,
}: {
  orderId: string;
  orderStageId: string;
  orderNumber: string;
  productDescription: string;
  operatorCode: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemState[]>([]);

  const fetchTpl = useServerFn(getTemplateForOrder);
  const submitFn = useServerFn(submitQualityCheck);

  const { data: tpl, isLoading } = useQuery({
    queryKey: ["quality-template", orderId],
    queryFn: () => fetchTpl({ data: { order_id: orderId } }),
    enabled: open,
  });

  // Inicializa itens quando o template carrega
  useMemo(() => {
    if (tpl && items.length === 0) {
      setItems(tpl.items.map((i) => ({
        template_item_id: i.id, label: i.label, status: null, photo_url: null,
      })));
    }
  }, [tpl]); // eslint-disable-line

  function setItem(i: number, patch: Partial<ItemState>) {
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  async function uploadPhoto(i: number, file: File) {
    setItem(i, { uploading: true });
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${orderId}/${Date.now()}-${i}.${ext}`;
      const { error } = await supabase.storage.from("quality-photos").upload(path, file, { upsert: false });
      if (error) throw error;
      setItem(i, { photo_url: path, uploading: false });
      toast.success("Foto anexada");
    } catch (e: any) {
      setItem(i, { uploading: false });
      toast.error(e?.message ?? "Erro ao enviar foto");
    }
  }

  const allAnswered = items.length > 0 && items.every((i) => i.status !== null);
  const hasNok = items.some((i) => i.status === "nok");

  const mut = useMutation({
    mutationFn: (result: "aprovado" | "reprovado") => {
      if (!operatorCode) throw new Error("Indica o teu código de operador");
      if (!allAnswered) throw new Error("Responde a todos os itens (OK/NOK)");
      return submitFn({ data: {
        order_id: orderId,
        template_id: tpl?.id ?? null,
        operator_code: operatorCode,
        result,
        notes: notes.trim() || null,
        order_stage_id: result === "aprovado" ? orderStageId : null,
        items: items.map((it) => ({
          template_item_id: it.template_item_id,
          label: it.label,
          status: it.status as "ok" | "nok",
          photo_url: it.photo_url,
        })),
      }});
    },
    onSuccess: (_, result) => {
      setOpen(false);
      setItems([]); setNotes("");
      toast.success(result === "aprovado"
        ? `Encomenda ${orderNumber} aprovada e enviada para embalagem`
        : `Conferência guardada — reprovada`);
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["production"] });
        qc.invalidateQueries({ queryKey: ["quality-checks"] });
        qc.invalidateQueries({ queryKey: ["quality-metrics"] });
      }, 0);
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao guardar conferência"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setItems([]); setNotes(""); } }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1 text-primary border-primary/40 hover:bg-primary/5">
          <ClipboardCheck className="size-4" /> Conferir
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Conferência de qualidade — {orderNumber}</DialogTitle>
        </DialogHeader>
        <div className="text-sm font-medium">{productDescription}</div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground py-6 text-center">A carregar template...</div>
        ) : !tpl ? (
          <div className="text-sm text-destructive py-6 text-center">
            Sem template de qualidade para a categoria desta encomenda.
            Cria um em <strong>Admin · Qualidade</strong>.
          </div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground">
              Template: <strong>{tpl.name}</strong> ({tpl.category_code})
            </div>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className={`p-3 rounded border ${
                  it.status === "ok" ? "bg-emerald-50 border-emerald-300" :
                  it.status === "nok" ? "bg-red-50 border-red-300" : "bg-card"
                }`}>
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="text-sm font-medium flex-1 min-w-0">{it.label}</div>
                    <div className="flex gap-1">
                      <Button size="sm" variant={it.status === "ok" ? "default" : "outline"}
                        className={it.status === "ok" ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                        onClick={() => setItem(i, { status: "ok" })}>
                        <CheckCircle2 className="size-4" /> OK
                      </Button>
                      <Button size="sm" variant={it.status === "nok" ? "destructive" : "outline"}
                        onClick={() => setItem(i, { status: "nok" })}>
                        <XCircle className="size-4" /> NOK
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <label className="inline-flex items-center gap-1 text-xs cursor-pointer text-muted-foreground hover:text-foreground">
                      <Camera className="size-3" />
                      {it.photo_url ? "Trocar foto" : "Anexar foto"}
                      <input type="file" accept="image/*" capture="environment" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(i, f); }}
                        disabled={it.uploading} />
                    </label>
                    {it.uploading && <span className="text-[11px] text-muted-foreground">a enviar...</span>}
                    {it.photo_url && <Badge variant="secondary" className="text-[10px]">📷 foto</Badge>}
                  </div>
                </div>
              ))}
            </div>

            <div>
              <Label>Notas (opcional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                placeholder="Observações da conferência..." />
            </div>

            {hasNok && (
              <div className="text-xs bg-amber-50 border border-amber-300 text-amber-900 rounded p-2">
                Há itens NOK. Podes aprovar (segue para embalagem) ou reprovar e enviar para retrabalho.
              </div>
            )}
          </>
        )}

        <DialogFooter className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          {tpl && (
            <>
              {/* Reprovar usa o sistema de retrabalho já existente */}
              <div onClick={async () => {
                // Guarda a conferência como reprovada antes de abrir retrabalho
                if (!allAnswered) { toast.error("Responde a todos os itens (OK/NOK)"); return; }
                try {
                  await mut.mutateAsync("reprovado");
                } catch { /* já tratado */ }
              }}>
                <ReworkDialog
                  orderId={orderId}
                  orderNumber={orderNumber}
                  detectedStage="qualidade"
                  operatorCode={operatorCode}
                />
              </div>
              <Button onClick={() => mut.mutate("aprovado")}
                disabled={mut.isPending || !allAnswered}
                className="bg-emerald-600 hover:bg-emerald-700 gap-1">
                <CheckCircle2 className="size-4" /> Aprovar
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
