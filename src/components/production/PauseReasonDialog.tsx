import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listPauseReasons, type PauseReason } from "@/lib/pauses.functions";
import { useAuth } from "@/hooks/useAuth";
import { Pause } from "lucide-react";

/** Janela obrigatória de motivo ao pausar. */
export function PauseReasonDialog({
  open,
  title,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title?: string;
  onCancel: () => void;
  onConfirm: (reasonId: string, notes?: string) => void;
}) {
  const { session } = useAuth();
  const fetchFn = useServerFn(listPauseReasons);
  const { data = [] } = useQuery({
    queryKey: ["pause-reasons"],
    queryFn: () => fetchFn(),
    enabled: Boolean(session),
    staleTime: 60_000,
  });
  const reasons = (data as PauseReason[]).filter((r) => r.active);
  const [needsNote, setNeedsNote] = useState<PauseReason | null>(null);
  const [note, setNote] = useState("");

  const close = () => {
    setNeedsNote(null);
    setNote("");
    onCancel();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Pause className="size-4" /> Motivo da pausa</DialogTitle>
          <DialogDescription>{title ?? "Escolhe porque estás a pausar."}</DialogDescription>
        </DialogHeader>
        {needsNote ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!note.trim()) return;
              onConfirm(needsNote.id, note.trim());
              setNeedsNote(null);
              setNote("");
            }}
          >
            <div className="text-sm font-medium">{needsNote.label}</div>
            <Input autoFocus value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Descreve o motivo" />
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setNeedsNote(null)}>Voltar</Button>
              <Button type="submit" className="flex-1" disabled={!note.trim()}>Pausar</Button>
            </div>
          </form>
        ) : reasons.length === 0 ? (
          <div className="text-sm text-muted-foreground">Sem motivos configurados. Pede ao escritório para os criar em Configurações.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {reasons.map((r) => (
              <Button
                key={r.id}
                variant="outline"
                className="h-14 text-base justify-start"
                onClick={() => (r.requires_note ? setNeedsNote(r) : onConfirm(r.id))}
              >
                {r.label}
              </Button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
