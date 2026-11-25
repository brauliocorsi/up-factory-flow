import type { OrderListItem } from "@/lib/orders.functions";

export type OrderListFilters = { search: string; status: string; stage: string; date: string };

export function filterOrderList(orders: OrderListItem[], filters: OrderListFilters, today: string) {
  const term = filters.search.trim().toLocaleLowerCase("pt-PT");
  return orders.filter((order) => {
    if (term && ![order.order_number, order.customer_order, order.product_description, order.model_name, order.gc_code].some((value) => value?.toLocaleLowerCase("pt-PT").includes(term))) return false;
    if (filters.status !== "all" && order.status !== filters.status) return false;
    if (filters.stage !== "all" && order.current_stage !== filters.stage) return false;
    if (filters.date === "today" && order.due_date?.slice(0, 10) !== today) return false;
    if (filters.date === "overdue" && (!order.due_date || order.due_date.slice(0, 10) >= today || order.status === "cancelada" || order.status === "em_armazem")) return false;
    if (filters.date === "none" && order.due_date) return false;
    return true;
  });
}