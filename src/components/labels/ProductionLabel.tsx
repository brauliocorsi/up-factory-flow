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
};

/**
 * Brother QL 62×29mm label. Exact physical size; one per page on print.
 */
export function ProductionLabel(props: LabelProps) {
  const productBarcodeRef = useRef<SVGSVGElement>(null);
  const coliBarcodeRef = useRef<SVGSVGElement>(null);

  const formattedProductCode = formatProductCode(props.productCode);

  useEffect(() => {
    if (!productBarcodeRef.current || !props.productCode) return;
    try {
      JsBarcode(productBarcodeRef.current, props.productCode, {
        format: "CODE128",
        width: 1.1,
        height: 28,
        displayValue: false,
        margin: 0,
      });
    } catch (e) {
      console.error("Barcode error", e);
    }
  }, [props.productCode]);

  useEffect(() => {
    if (!coliBarcodeRef.current) return;
    try {
      JsBarcode(coliBarcodeRef.current, props.coliBarcode, {
        format: "CODE128",
        width: 1,
        height: 18,
        displayValue: false,
        margin: 0,
      });
    } catch (e) {
      console.error("Coli barcode error", e);
    }
  }, [props.coliBarcode]);

  const fabricLine = [props.fabricType, props.color].filter(Boolean).join(" · ");
  // Avoid duplicating the measure when it is already part of the description
  const desc = props.productDescription ?? "";
  const productLine =
    props.measure && !desc.includes(props.measure)
      ? `${desc} ${props.measure}`.trim()
      : desc;
  const coli =
    props.packageNumber && props.packageTotal
      ? `Coli ${props.packageNumber}/${props.packageTotal}${props.packageName ? " — " + props.packageName : ""}`
      : null;

  return (
    <div className="label">
      <div className="label-inner">
        <div className="label-left">
          <div className="label-product" title={productLine}>{productLine}</div>
          {fabricLine && <div className="label-fabric">{fabricLine}</div>}
          {props.observation && (
            <div className="label-observation">⚠ {props.observation}</div>
          )}
          {coli && <div className="label-coli">{coli}</div>}
          <div className="label-order">Nº {props.orderNumber}</div>
        </div>
        <div className="label-right">
          {props.productCode ? (
            <div className="label-code-block">
              <div className="label-code-title">CÓDIGO DO PRODUTO</div>
              <svg ref={productBarcodeRef} />
              <div className="label-product-code">
                {formattedProductCode}
                {props.packageNumber ? ` · C${props.packageNumber}` : ""}
              </div>
            </div>
          ) : (
            <div className="label-code-missing">Código de produto indisponível</div>
          )}
          <div className="label-coli-code">
            <span>CÓDIGO DO VOLUME</span>
            <svg ref={coliBarcodeRef} />
            <b>{props.coliBarcode}</b>
          </div>
        </div>
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
        padding: 1.5mm 2mm;
        font-family: Inter, system-ui, sans-serif;
        overflow: hidden;
        border: 1px dashed #cbd5e1;
        margin: 4px;
        page-break-after: always;
        break-after: page;
      }
      .label-inner {
        display: flex;
        flex-direction: row;
        gap: 2mm;
        height: 100%;
        align-items: stretch;
      }
      .label-left {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .label-product {
        font-size: 7.5pt;
        font-weight: 700;
        line-height: 1.15;
        max-height: 3.5em;
        overflow: hidden;
        word-break: break-word;
      }
      .label-fabric {
        font-size: 7pt;
        line-height: 1.1;
        color: #111;
      }
      .label-observation {
        font-size: 7.5pt;
        font-weight: 800;
        color: #000;
        background: #fde047;
        padding: 0.3mm 1mm;
        border-radius: 1px;
        line-height: 1.1;
        max-height: 2.2em;
        overflow: hidden;
      }
      .label-coli {
        font-size: 7.5pt;
        font-weight: 700;
        background: #000;
        color: #fff;
        padding: 0.4mm 1mm;
        align-self: flex-start;
        border-radius: 1px;
      }
      .label-order {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 7pt;
        color: #333;
      }
      .label-right {
        flex: 0 0 29mm;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.8mm;
        min-width: 0;
      }
      .label-code-block, .label-coli-code {
        width: 100%;
        min-width: 0;
        text-align: center;
      }
      .label-code-title, .label-coli-code span {
        display: block;
        font-size: 4.7pt;
        font-weight: 800;
        line-height: 1;
      }
      .label-code-block svg { width: 28mm; height: 7mm; display: block; margin: 0 auto; }
      .label-product-code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 5.4pt;
        font-weight: 800;
        line-height: 1.05;
        overflow-wrap: anywhere;
      }
      .label-coli-code { border-top: 0.25mm solid #000; padding-top: 0.5mm; }
      .label-coli-code svg { width: 28mm; height: 4.5mm; display: block; margin: 0 auto; }
      .label-coli-code b {
        display: block;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 5pt;
        line-height: 1;
        overflow-wrap: anywhere;
      }
      .label-code-missing { font-size: 6pt; font-weight: 700; }

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

function formatProductCode(code?: string | null): string {
  const clean = (code ?? "").replace(/\s+/g, "").toUpperCase();
  if (/^CAM[A-Z0-9]{15}$/.test(clean) || /^SOF[A-Z0-9]{15}$/.test(clean)) {
    return [clean.slice(0, 3), clean.slice(3, 6), clean.slice(6, 8), clean.slice(8, 11), clean.slice(11, 17), clean.slice(17)].join(" ");
  }
  if (/^SOM[A-Z0-9]{14}$/.test(clean)) {
    return [clean.slice(0, 3), clean.slice(3, 6), clean.slice(6, 7), clean.slice(7, 8), clean.slice(8, 11), clean.slice(11)].join(" ");
  }
  return clean;
}