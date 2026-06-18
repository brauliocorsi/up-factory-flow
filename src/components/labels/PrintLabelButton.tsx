import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Botão que imprime a etiqueta de uma encomenda diretamente, sem abrir
 * janela de pré-visualização. Usa um iframe oculto que aponta para
 * /etiquetas/imprimir?ids=<id>&autoprint=1 — essa página dispara
 * window.print() automaticamente quando as etiquetas terminam de
 * renderizar.
 */
export function PrintLabelButton({
  orderId,
  label = "Etiquetar",
  size = "sm",
  variant = "outline",
  className,
}: {
  orderId: string;
  label?: string;
  size?: "sm" | "lg" | "default" | "icon";
  variant?: "default" | "outline" | "ghost" | "secondary" | "destructive" | "link";
  className?: string;
}) {
  const [printing, setPrinting] = useState(false);

  function handlePrint() {
    if (printing) return;
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
      iframe.src = `/etiquetas/imprimir?ids=${encodeURIComponent(orderId)}&autoprint=1`;
      // Salvaguarda: remover iframe e reativar botão passados 8s
      const cleanup = () => {
        try { document.body.removeChild(iframe); } catch { /* já removido */ }
        setPrinting(false);
      };
      const timer = window.setTimeout(cleanup, 8000);
      iframe.addEventListener("load", () => {
        // o próprio documento dispara window.print(); aguardamos um pouco
        // antes de limpar para não cancelar o diálogo do browser.
        window.setTimeout(() => {
          window.clearTimeout(timer);
          cleanup();
        }, 4000);
      });
      document.body.appendChild(iframe);
      toast.success("A enviar etiqueta para a impressora…");
    } catch (e: any) {
      setPrinting(false);
      toast.error(e?.message ?? "Não foi possível imprimir a etiqueta");
    }
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      onClick={handlePrint}
      disabled={printing}
      className={className ?? "gap-1"}
    >
      <Printer className="size-4" />
      {printing ? "A imprimir…" : label}
    </Button>
  );
}