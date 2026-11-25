type PickingDispatchOrder = {
  order_number: string;
  gc_code: string | null;
  barcode: string | null;
  product_description: string;
  measure: string | null;
  fabric_type: string | null;
  fabric_ref: string | null;
  color: string | null;
};

/** Preserve the supplied product identity; never generate a code from the model. */
export function pickingStockItem(order: PickingDispatchOrder, dispatchedAt: string) {
  const productCode = order.gc_code?.trim() || order.barcode?.trim();
  if (!productCode) {
    throw new Error(`Encomenda ${order.order_number} sem código de produto. Preencha o código antes de enviar para o Contagem.`);
  }
  return {
    order_number: order.order_number,
    product_code: productCode,
    barcode: productCode,
    product_description: order.product_description,
    measure: order.measure ?? "",
    fabric_type: order.fabric_type ?? "",
    fabric_ref: order.fabric_ref ?? "",
    color: order.color ?? "",
    quantity: 1,
    dispatched_at: dispatchedAt,
  };
}