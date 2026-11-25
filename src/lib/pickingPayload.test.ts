import { describe, expect, it } from "vitest";
import { pickingStockItem } from "./pickingPayload";

const order = {
  order_number: "TESTE-2411-17452",
  gc_code: "CAM00201140012007N",
  barcode: "002",
  product_description: "Cama Armani Simples 190x140cm - Bass Cream",
  measure: "190x140",
  fabric_type: null,
  fabric_ref: null,
  color: null,
};
const date = "2026-11-25T01:15:00.000Z";

describe("Picking stock product identity", () => {
  it("sends the full GestãoClick code, not the model code 002", () => {
    expect(pickingStockItem(order, date)).toMatchObject({
      product_code: "CAM00201140012007N",
      barcode: "CAM00201140012007N",
      quantity: 1,
    });
  });

  it("preserves the existing EAN code without inventing a CAM replacement", () => {
    const item = pickingStockItem({ ...order, gc_code: "2075110358004", barcode: "2075110358004" }, date);
    expect(item.product_code).toBe("2075110358004");
    expect(item.barcode).toBe("2075110358004");
  });

  it("uses the existing barcode when gc_code is absent", () => {
    expect(pickingStockItem({ ...order, gc_code: null, barcode: "CAM00201140012007N" }, date).product_code)
      .toBe("CAM00201140012007N");
  });

  it("blocks missing codes instead of sending the description or order number", () => {
    expect(() => pickingStockItem({ ...order, gc_code: " ", barcode: null }, date)).toThrow("sem código de produto");
  });

  it("sends optional text fields as strings accepted by Contagem", () => {
    expect(pickingStockItem(order, date)).toMatchObject({
      fabric_type: "", fabric_ref: "", color: "", dispatched_at: date,
    });
  });
  it("sends the factory colis count (2) so Contagem can create the product", () => {
    expect(pickingStockItem({ ...order, total_colis: 2 }, date).total_colis).toBe(2);
  });

  it("never sends fewer than 1 coli", () => {
    expect(pickingStockItem({ ...order, total_colis: 0 }, date).total_colis).toBe(1);
  });
});
