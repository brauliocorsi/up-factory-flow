import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

export type LabelProps = {
  orderNumber: string;
  barcodeValue: string;
  productDescription: string;
  modelName?: string | null;
  measure?: string | null;
  fabricType?: string | null;
  fabricRef?: string | null;
  color?: string | null;
  packageNumber?: number | null;
  packageTotal?: number | null;
  packageName?: string | null;
};

/**
 * Brother QL 62×29mm label. Exact physical size; one per page on print.
 */
export function ProductionLabel(props: LabelProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    try {
      JsBarcode(svgRef.current, props.barcodeValue, {
        format: "CODE128",
        width: 1.4,
        height: 36,
        displayValue: true,
        fontSize: 9,
        margin: 2,
        textMargin: 0,
      });
    } catch (e) {
      console.error("Barcode error", e);
    }
  }, [props.barcodeValue]);

  const fabricLine = [props.fabricType, props.color].filter(Boolean).join(" · ");
  const productLine = [props.productDescription, props.measure].filter(Boolean).join(" ");
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
          {coli && <div className="label-coli">{coli}</div>}
          <div className="label-order">Nº {props.orderNumber}</div>
        </div>
        <div className="label-right">
          <svg ref={svgRef} />
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
        font-size: 8pt;
        font-weight: 700;
        line-height: 1.1;
        max-height: 2.4em;
        overflow: hidden;
      }
      .label-fabric {
        font-size: 7pt;
        line-height: 1.1;
        color: #111;
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
        flex: 0 0 26mm;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .label-right svg { width: 26mm; height: auto; max-height: 26mm; }

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