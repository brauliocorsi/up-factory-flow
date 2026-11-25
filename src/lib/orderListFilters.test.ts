import { describe, expect, it } from "vitest";
import { filterOrderList } from "./orderListFilters";
import type { OrderListItem } from "./orders.functions";

const order: OrderListItem = { id: "one", order_number: "17399-01", customer_order: "17399", product_description: "Cama Kali", model_name: "Kali", measure: null, fabric_type: null, entry_date: null, due_date: "2026-11-24", status: "concluida", current_stage: "picagem", completed_at: null, picked_at: null, picking_state: "aguarda_picagem", line_kind: "catalogo", service_type: null };
const filters = { search: "", status: "all", stage: "all", date: "all" };
describe("filtros de encomendas", () => {
  it("pesquisa por produto ou número", () => {
    expect(filterOrderList([order], { ...filters, search: "kali" }, "2026-11-25")).toHaveLength(1);
    expect(filterOrderList([order], { ...filters, search: "17399" }, "2026-11-25")).toHaveLength(1);
    expect(filterOrderList([order], { ...filters, search: "Armani" }, "2026-11-25")).toHaveLength(0);
  });
  it("mantém produção concluída na fila de picagem", () => {
    expect(filterOrderList([order], { ...filters, status: "concluida", stage: "picagem" }, "2026-11-25")).toHaveLength(1);
    expect(filterOrderList([order], { ...filters, stage: "corte" }, "2026-11-25")).toHaveLength(0);
  });
  it("atraso exclui armazém e canceladas", () => {
    expect(filterOrderList([order, { ...order, id: "two", status: "cancelada" }, { ...order, id: "three", status: "em_armazem" }], { ...filters, date: "overdue" }, "2026-11-25").map((o) => o.id)).toEqual(["one"]);
  });
  it("distingue saída hoje de encomenda sem data", () => {
    expect(filterOrderList([order], { ...filters, date: "today" }, "2026-11-24")).toHaveLength(1);
    expect(filterOrderList([order], { ...filters, date: "none" }, "2026-11-24")).toHaveLength(0);
    expect(filterOrderList([{ ...order, due_date: null }], { ...filters, date: "none" }, "2026-11-24")).toHaveLength(1);
  });
});