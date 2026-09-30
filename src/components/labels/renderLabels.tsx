import type { ReactElement } from "react";
import type { LabelRow } from "@/lib/packages.functions";
import { ProductionLabel } from "@/components/labels/ProductionLabel";

/** Gera as etiquetas (uma por volume × cópias) de uma encomenda. */
export function renderLabelsForOrder(row: LabelRow, copies: number) {
  const { order, packages, colis } = row;
  // Total real de volumes da encomenda (não apenas os que estão a ser impressos).
  const coliTotal = Math.max(row.coli_total ?? colis.length, colis.length);
  const list: ({ id: string; package_number: number; package_total: number; package_name: string; barcode?: string } | null)[] =
    colis.length
      ? colis.map((c) => ({
          id: c.id,
          package_number: c.coli_number,
          package_total: coliTotal,
          package_name: c.coli_name,
          barcode: c.coli_barcode,
        }))
      : packages.length
        ? packages.map((p) => ({
            id: p.id,
            package_number: p.package_number,
            package_total: p.package_total,
            package_name: p.package_name,
          }))
        : [null];
  const out: ReactElement[] = [];
  for (const pkg of list) {
    for (let c = 0; c < copies; c++) {
      const key = `${order.id}-${pkg?.id ?? "x"}-${c}`;
      out.push(
        <ProductionLabel
          key={key}
          orderNumber={order.order_number}
          productCode={order.product_code}
          coliBarcode={pkg?.barcode || order.order_number}
          productDescription={order.product_description}
          modelName={order.model_name}
          measure={order.measure}
          fabricType={order.fabric_type}
          fabricRef={order.fabric_ref}
          color={order.color}
          packageNumber={pkg?.package_number ?? null}
          packageTotal={pkg?.package_total ?? null}
          packageName={pkg?.package_name ?? null}
          observation={order.observation}
        />,
      );
    }
  }
  return out;
}
