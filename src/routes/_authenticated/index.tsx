import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { Suspense } from "react";
import { getDashboardData } from "@/lib/orders.functions";
import { StatCards } from "@/components/app/StatCards";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { MobileStageView } from "@/components/kanban/MobileStageView";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";

const dashboardQuery = queryOptions({
  queryKey: ["dashboard"],
  queryFn: () => getDashboardData(),
});

export const Route = createFileRoute("/_authenticated/")({
  component: DashboardPage,
  errorComponent: ({ error }) => <div className="p-6 text-sm text-destructive">{error.message}</div>,
});

function DashboardPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">A carregar…</div>}>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const { data } = useSuspenseQuery(dashboardQuery);
  useRealtimeOrders([["dashboard"], ["orders"]]);
  return (
    <div>
      <div className="px-4 pt-4 md:pt-6">
        <h1 className="text-2xl font-bold">Chão de fábrica</h1>
        <p className="text-sm text-muted-foreground">Vista em tempo real das etapas de produção</p>
      </div>
      <StatCards stats={data.stats} />
      <div className="mt-6">
        <div className="hidden md:block"><KanbanBoard data={data} /></div>
        <div className="md:hidden"><MobileStageView data={data} /></div>
      </div>
    </div>
  );
}