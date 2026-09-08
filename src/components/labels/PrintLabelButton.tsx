import { useRef, useState } from "react";
import { Printer, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Botão que prepara a etiqueta de uma encomenda (ou de um volume) e abre o
 * diálogo de impressão do dispositivo. Usa um iframe oculto que aponta para
 * /etiquetas/imprimir?ids=<id>&autoprint=1 — essa página dispara
 * window.print() quando as etiquetas terminam de renderizar.
 *
 * Etapa 06: nunca afirmamos "impresso com sucesso" (não há confirmação do
 * dispositivo); o iframe só é removido depois do fim da impressão ou de uma
 * espera longa, para não cancelar o diálogo enquanto ainda carrega.
 */
export function PrintLabelButton({
  orderId,
  coliId,
  label = "Imprimir etiqueta",
  size = "sm",
  variant = "outline",
  className,
}: {
  orderId: string;
  /** Quando indicado, imprime apenas a etiqueta deste volume. */
  coliId?: string;
  label?: string;
  size?: "sm" | "lg" | "default" | "icon";
  variant?: "default" | "outline" | "ghost" | "secondary" | "destructive" | "link";
  className?: string;
}) {
  const [printing, setPrinting] = useState(false);
  const busy = useRef(false);

  const url =
    `/etiquetas/imprimir?ids=${encodeURIComponent(orderId)}` +
    (coliId ? `&colis=${encodeURIComponent(coliId)}` : "");

  function handlePrint() {
    if (busy.current) return;
    busy.current = true;
    setPrinting(true);
    try {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.style.visibility = "hidden";
      iframe.src = `${url}&autoprint=1`;

      let done = false;
      const cleanup = () => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        try { document.body.removeChild(iframe); } catch { /* já removido */ }
        busy.current = false;
        setPrinting(false);
      };
      // Salvaguarda longa: só limpa se o dispositivo nunca responder.
      const timer = window.setTimeout(cleanup, 120000);

      iframe.addEventListener("load", () => {
        try {
          const win = iframe.contentWindow;
          if (win) {
            win.addEventListener("afterprint", () => window.setTimeout(cleanup, 500));
          }
        } catch {
          /* sem acesso ao iframe — fica a salvaguarda */
        }
        toast.success("Diálogo de impressão preparado — confirma na impressora.");
      });

      document.body.appendChild(iframe);
    } catch (e: any) {
      busy.current = false;
      setPrinting(false);
      toast.error(e?.message ?? "Não foi possível preparar a etiqueta");
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Button
        type="button"
        size={size}
        variant={variant}
        onClick={handlePrint}
        disabled={printing}
        className={className ?? "gap-1"}
      >
        <Printer className="size-4" />
        {printing ? "A preparar…" : label}
      </Button>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        title="Abrir a página da etiqueta"
        className="text-muted-foreground hover:text-foreground"
      >
        <ExternalLink className="size-3.5" />
      </a>
    </span>
  );
}
