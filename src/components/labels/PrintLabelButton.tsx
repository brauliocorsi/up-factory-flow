import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, ExternalLink, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getLabelsForOrders, type LabelRow } from "@/lib/packages.functions";
import { LabelPrintStyles } from "@/components/labels/ProductionLabel";
import { renderLabelsForOrder } from "@/components/labels/renderLabels";

/**
 * Botão que imprime a etiqueta de uma encomenda (ou de um volume).
 *
 * Imprime na própria página: carrega os dados da etiqueta com a sessão atual,
 * desenha-a numa área só visível na impressão e abre o diálogo de impressão.
 * (Antes usava uma página escondida dentro de outra, que em alguns
 * dispositivos não recebia a sessão e não imprimia nada.)
 *
 * Nunca afirmamos "impresso com sucesso": não há confirmação da impressora.
 */
export function PrintLabelButton({
  orderId,
  coliId,
  label = "Imprimir etiqueta",
  size = "sm",
  variant = "outline",
  className,
  showOpenLink = true,
}: {
  orderId: string;
  /** Quando indicado, imprime apenas a etiqueta deste volume. */
  coliId?: string;
  label?: string;
  size?: "sm" | "lg" | "default" | "icon";
  variant?: "default" | "outline" | "ghost" | "secondary" | "destructive" | "link";
  className?: string;
  showOpenLink?: boolean;
}) {
  const fetchLabels = useServerFn(getLabelsForOrders);
  const [printing, setPrinting] = useState(false);
  const [rows, setRows] = useState<LabelRow[] | null>(null);
  const busy = useRef(false);

  const url =
    `/etiquetas/imprimir?ids=${encodeURIComponent(orderId)}` +
    (coliId ? `&colis=${encodeURIComponent(coliId)}` : "");

  const finish = () => {
    document.documentElement.classList.remove("printing-labels");
    setRows(null);
    busy.current = false;
    setPrinting(false);
  };

  async function handlePrint() {
    if (busy.current) return;
    busy.current = true;
    setPrinting(true);
    try {
      const data = await fetchLabels({
        data: { ids: [orderId], ...(coliId ? { coli_ids: [coliId] } : {}) },
      });
      if (!data || data.length === 0) {
        toast.error("Não há dados de etiqueta para esta encomenda.");
        finish();
        return;
      }
      setRows(data);
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível preparar a etiqueta");
      finish();
    }
  }

  // Quando as etiquetas estão desenhadas, abre o diálogo de impressão.
  useEffect(() => {
    if (!rows) return;
    document.documentElement.classList.add("printing-labels");
    const onAfter = () => window.setTimeout(finish, 300);
    window.addEventListener("afterprint", onAfter);
    // Pequeno atraso para os códigos de barras renderizarem.
    const t = window.setTimeout(() => {
      try {
        window.print();
      } catch {
        toast.error("O dispositivo não abriu o diálogo de impressão.");
        finish();
      }
    }, 350);
    // Salvaguarda: se o browser não emitir afterprint, liberta o botão.
    const safety = window.setTimeout(finish, 120000);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(safety);
      window.removeEventListener("afterprint", onAfter);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const iconOnly = size === "icon" || !label;

  return (
    <span className="inline-flex items-center gap-1">
      <Button
        type="button"
        size={size}
        variant={variant}
        onClick={handlePrint}
        disabled={printing}
        className={className ?? "gap-1"}
        title={label || "Imprimir etiqueta"}
        aria-label={label || "Imprimir etiqueta"}
      >
        {printing ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
        {!iconOnly && (printing ? "A preparar…" : label)}
      </Button>
      {showOpenLink && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title="Abrir a página da etiqueta"
          className="text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3.5" />
        </a>
      )}
      {rows && typeof document !== "undefined" &&
        createPortal(
          <div className="label-print-portal">
            <LabelPrintStyles />
            <style>{`
              .label-print-portal { position: fixed; left: -10000px; top: 0; }
              @media print {
                html.printing-labels body > *:not(.label-print-portal) { display: none !important; }
                html.printing-labels .label-print-portal { position: static; left: 0; }
              }
            `}</style>
            <div className="print-area flex flex-wrap gap-0">
              {rows.map((row) => renderLabelsForOrder(row, 1))}
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}
