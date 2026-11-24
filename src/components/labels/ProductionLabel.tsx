import { formatProductCode, needsNormalization } from "@/lib/laminates";
import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

export type LabelProps = {
  orderNumber: string;
  productCode?: string | null;
  coliBarcode: string;
  productDescription: string;
  modelName?: string | null;
  measure?: string | null;
  fabricType?: string | null;
  fabricRef?: string | null;
  color?: string | null;
  packageNumber?: number | null;
  packageTotal?: number | null;
  packageName?: string | null;
  observation?: string | null;
  /** Encomenda sem código GestãoClick: mostra aviso na etiqueta. */
  gcMissing?: boolean;
};

/**
 * Brother QL 62×29mm label. Exact physical size; one per page on print.
 */
export function ProductionLabel(props: LabelProps) {
  // Mesmo layout do projeto Contagem: título, linha de contexto e UM código de
  // barras na largura toda (CODIGO ou CODIGO-C<n>), com o código por baixo.
  const barcodeRef = useRef<SVGSVGElement>(null);
  const code = props.coliBarcode || props.productCode || props.orderNumber;

  useEffect(() => {
    if (!barcodeRef.current || !code) return;
    try {
      JsBarcode(barcodeRef.current, code, {
        format: "CODE128",
        width: 2,
        height: 120,
        displayValue: false,
        margin: 0,
      });
    } catch (e) {
      console.error("Barcode error", e);
    }
  }, [code]);

  const desc = props.productDescription ?? "";
  const title =
    props.measure && !desc.includes(props.measure) ? `${desc} ${props.measure}`.trim() : desc;
  const coli =
    props.packageNumber && props.packageTotal && props.packageTotal > 1
      ? `Coli ${props.packageNumber}/${props.packageTotal}${props.packageName && !/^coli\s/i.test(props.packageName) ? " - " + props.packageName : ""}`
      : null;
  const warn = props.gcMissing
    ? "sem código GC"
    : needsNormalization(props.productCode)
      ? "por normalizar"
      : null;
  const info = [
    props.productCode ? `Código: ${formatProductCode(props.productCode)}` : null,
    coli,
    `Enc. ${props.orderNumber}`,
    warn,
  ]
    .filter(Boolean)
    .join("  •  ");

  return (
    <div className="label">
      <div className="label-title" title={title}>{title}</div>
      <div className="label-info">{info}</div>
      {props.observation && <div className="label-observation">⚠ {props.observation}</div>}
      <div className="label-bottom">
        <svg ref={barcodeRef} className="label-barcode" />
        <div className="label-code">{code}</div>
      </div>
    </div>
  );
}

/**
 * Shared print CSS for the 62×29mm Brother QL labels.
 * Mount once on any page that renders ProductionLabel.
 */
export function LabelPrintStyles() {
  return (
    <style>{`
      .label {
        width: 62mm;
        height: 29mm;
        box-sizing: border-box;
        background: white;
        color: black;
        padding: 2mm;
        font-family: Helvetica, Arial, sans-serif;
        overflow: hidden;
        border: 1px dashed #cbd5e1;
        margin: 4px;
        display: flex;
        flex-direction: column;
        page-break-after: always;
        break-after: page;
      }
      .label-title {
        font-size: 7.5pt;
        font-weight: 700;
        line-height: 1.1;
        max-height: 2.2em;
        overflow: hidden;
        word-break: break-word;
      }
      .label-info {
        font-size: 6pt;
        line-height: 1.15;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .label-observation {
        font-size: 6pt;
        font-weight: 800;
        line-height: 1.1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .label-bottom { margin-top: auto; padding-bottom: 1.6mm; }
      .label-barcode { width: 100%; height: 8.5mm; display: block; }
      .label-code {
        font-size: 7pt;
        font-weight: 700;
        text-align: center;
        line-height: 1.1;
        margin-top: 0.4mm;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      @media print {
        @page { size: 62mm 29mm; margin: 0; }
        html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
        body * { visibility: hidden; }
        .print-area, .print-area * { visibility: visible; }
        .print-area { position: absolute; left: 0; top: 0; }
        .no-print { display: none !important; }
        .label { border: none; margin: 0; }
      }
    `}</style>
  );
}
