import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useQuery } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { getDashboardData } from "@/lib/orders.functions";
import { StatCards } from "@/components/app/StatCards";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { MobileStageView } from "@/components/kanban/MobileStageView";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { OrdersListView } from "@/components/dashboard/OrdersListView";
import { OperatorsActiveView } from "@/components/dashboard/OperatorsActiveView";
import { OperatorsEfficiencyView } from "@/components/dashboard/OperatorsEfficiencyView";
import { ProductionKpisBar } from "@/components/dashboard/ProductionKpisBar";
import { DashboardFilters, applyDashboardFilters, emptyFilters, type DashboardFilterState } from "@/components/dashboard/DashboardFilters";
import { useMemo } from "react";

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
  const [tab, setTab] = useState("kanban");
  const [filters, setFilters] = useState<DashboardFilterState>(emptyFilters);
  const filteredData = useMemo(
    () => ({ ...data, byStage: applyDashboardFilters(data.byStage, filters) }),
    [data, filters]
  );
  return (
    <div>
      <div className="px-4 pt-4 md:pt-6">
        <h1 className="text-2xl font-bold">Chão de fábrica</h1>
        <p className="text-sm text-muted-foreground">Vista em tempo real das etapas de produção</p>
        <DashboardFilters value={filters} onChange={setFilters} />
      </div>
      <StatCards stats={data.stats} />
      <ProductionKpisBar />
      <div className="mt-4 px-4">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="kanban">Kanban</TabsTrigger>
            <TabsTrigger value="lista">Lista</TabsTrigger>
            <TabsTrigger value="operadores">Operadores</TabsTrigger>
            <TabsTrigger value="eficiencia">Eficiência</TabsTrigger>
          </TabsList>
          <TabsContent value="kanban" className="mt-4">
            <div className="hidden md:block -mx-4"><KanbanBoard data={filteredData} /></div>
            <div className="md:hidden -mx-4"><MobileStageView data={filteredData} /></div>
          </TabsContent>
          <TabsContent value="lista" className="mt-4">
            <OrdersListView data={filteredData} />
          </TabsContent>
          <TabsContent value="operadores" className="mt-4">
            <OperatorsActiveView />
          </TabsContent>
          <TabsContent value="eficiencia" className="mt-4">
            <OperatorsEfficiencyView />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}