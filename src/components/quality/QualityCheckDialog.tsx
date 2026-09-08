import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Camera, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { getQualityFamilies, submitQualityCheck } from "@/lib/quality.functions";
import { supabase } from "@/integrations/supabase/client";
import { PrintLabelButton } from "@/components/labels/PrintLabelButton";

type ItemState = {
  template_item_id: string | null;
  label: string;
  status: "ok" | "nok" | null;
  photo_url: string | null;
  uploading?: boolean;
};

type Family = "CAM" | "SOF";

const FAMILY_LABEL: Record<Family, string> = { CAM: "CAMA", SOF: "SOFÁ" };

export function QualityCheckDialog({
  orderId, orderStageId, orderNumber, productDescription, operatorCode,
}: {
  orderId: string;
  orderStageId?: string | null;
  orderNumber: string;
  productDescription: string;
  operatorCode: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemState[]>([]);
  const [family, setFamily] = useState<Family | null>(null);
  const [approved, setApproved] = useState(false);
  // Chave de intenção: criada por abertura do formulário e reutilizada nas
  // tentativas, para que uma repetição não crie outra conferência.
  const [intentId, setIntentId] = useState<string>(() => crypto.randomUUID());

  const fetchFamilies = useServerFn(getQualityFamilies);
  const submitFn = useServerFn(submitQualityCheck);

  const { data: fam, isLoading } = useQuery({
    queryKey: ["quality-families", orderId],
    queryFn: () => fetchFamilies({ data: { order_id: orderId } }),
    enabled: open,
  });

  const tpl = useMemo(
    () => (family ? (fam?.families.find((f) => f.code === family)?.template ?? null) : null),
    [fam, family],
  );

  // Seleção automática quando a categoria é fiável
  useEffect(() => {
    if (!open || !fam || family) return;
    if (fam.suggested) setFamily(fam.suggested);
  }, [open, fam, family]);

  // Carrega os itens da base escolhida
  useEffect(() => {
    if (!open || !tpl) return;
    setItems(
      tpl.items.map((i) => ({
        template_item_id: i.id, label: i.label, status: null, photo_url: null,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl?.id, open]);

  function reset() {
    setItems([]); setNotes(""); setFamily(null); setApproved(false);
    setIntentId(crypto.randomUUID());
  }

  function chooseFamily(next: Family) {
    if (next === family) return;
    const answered = items.some((i) => i.status !== null);
    if (answered && !window.confirm(
      `Mudar para ${FAMILY_LABEL[next]} substitui as respostas já preenchidas. Continuar?`,
    )) return;
    setFamily(next);
  }

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
  const uploading = items.some((i) => i.uploading);
  const divergent = Boolean(fam?.suggested && family && fam.suggested !== family);

  const mut = useMutation({
    mutationFn: (result: "aprovado" | "reprovado") => {
      if (!operatorCode) throw new Error("Indica o teu código de operador");
      if (!family) throw new Error("Escolhe a família: CAMA ou SOFÁ");
      if (!allAnswered) throw new Error("Responde a todos os itens (OK/NOK)");
      if (uploading) throw new Error("Aguarda o fim do envio das fotos");
      return submitFn({ data: {
        order_id: orderId,
        template_id: tpl?.id ?? null,
        family_code: family,
        intent_id: intentId,
        operator_code: operatorCode,
        result,
        notes: [
          notes.trim(),
          divergent ? `Família escolhida (${FAMILY_LABEL[family]}) diferente da sugerida (${FAMILY_LABEL[fam!.suggested!]}).` : "",
        ].filter(Boolean).join(" — ") || null,
        order_stage_id:
          result === "aprovado" && orderStageId ? orderStageId : null,
        items: items.map((it) => ({
          template_item_id: it.template_item_id,
          label: it.label,
          status: it.status as "ok" | "nok",
          photo_url: it.photo_url,
        })),
      }});
    },
    onSuccess: (res: any, result) => {
      if (res && res.ok === false) {
        toast.error(res.message ?? "Não foi possível guardar a conferência");
        return;
      }
      if (result === "aprovado") {
        // Etapa 06: aprovação confirmada no servidor → ecrã de impressão.
        setApproved(true);
        toast.success(`Encomenda ${orderNumber} aprovada e enviada para embalagem`);
      } else {
        setOpen(false);
        reset();
        toast.success(`Conferência guardada como reprovada. Usa "Enviar para retrabalho" no cartão para definir a etapa de destino.`);
      }
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["production"] });
        qc.invalidateQueries({ queryKey: ["quality-checks"] });
        qc.invalidateQueries({ queryKey: ["quality-metrics"] });
      }, 0);
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao guardar conferência"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
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

        {approved ? (
          <div className="space-y-3 py-4 text-center">
            <div className="text-sm text-emerald-700 font-medium">
              Qualidade aprovada e guardada. Podes imprimir a etiqueta agora.
            </div>
            <div className="flex items-center justify-center gap-2">
              <PrintLabelButton orderId={orderId} label="Imprimir etiqueta" size="default" />
              <Button variant="outline" onClick={() => { setOpen(false); reset(); }}>Fechar</Button>
            </div>
            <div className="text-[11px] text-muted-foreground">
              A impressão é independente da aprovação: cancelar o diálogo da
              impressora não desfaz nada e não cria outra conferência.
            </div>
          </div>
        ) : isLoading ? (
          <div className="text-sm text-muted-foreground py-6 text-center">A carregar checklist...</div>
        ) : (
          <>

            <div className="space-y-1">
              <Label>Família do produto</Label>
              <div className="flex gap-2">
                {(["CAM", "SOF"] as Family[]).map((f) => (
                  <Button key={f} type="button" size="sm"
                    variant={family === f ? "default" : "outline"}
                    onClick={() => chooseFamily(f)}>
                    {FAMILY_LABEL[f]}
                  </Button>
                ))}
              </div>
              {fam?.suggested && (
                <div className="text-[11px] text-muted-foreground">
                  Sugerido pela {fam.suggested_source === "categoria" ? "categoria do produto"
                    : fam.suggested_source === "codigo" ? "referência da encomenda" : "descrição do produto"}:{" "}
                  <strong>{FAMILY_LABEL[fam.suggested]}</strong>
                </div>
              )}
              {divergent && (
                <div className="text-[11px] text-amber-700">
                  Escolheste uma família diferente da sugerida. A escolha fica registada na conferência.
                </div>
              )}
            </div>

            {!family ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                Escolhe CAMA ou SOFÁ para carregar o checklist.
              </div>
            ) : !tpl || tpl.items.length === 0 ? (
              <div className="text-sm text-destructive py-6 text-center">
                Configuração em falta: a base de {FAMILY_LABEL[family]} não tem itens.
                Define-a em <strong>Admin · Qualidade</strong> antes de conferir.
              </div>
            ) : (
              <>
                <div className="text-xs text-muted-foreground">
                  Checklist: <strong>{tpl.name}</strong> ({tpl.items.length} itens)
                </div>
                <div className="space-y-2">
                  {items.map((it, i) => (
                    <div key={`${tpl.id}-${i}`} className={`p-3 rounded border ${
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
                    Há itens NOK. Esta encomenda não pode ser aprovada: reprova e envia para retrabalho.
                  </div>
                )}
              </>
            )}
          </>
        )}

        <DialogFooter className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          {family && tpl && tpl.items.length > 0 && (
            <>
              <Button variant="destructive" disabled={mut.isPending || !allAnswered || uploading}
                onClick={() => mut.mutate("reprovado")}>
                <XCircle className="size-4" /> Reprovar
              </Button>
              <Button onClick={() => mut.mutate("aprovado")}
                disabled={mut.isPending || !allAnswered || hasNok || uploading}
                title={hasNok ? "Não é possível aprovar com itens NOK" : undefined}
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
