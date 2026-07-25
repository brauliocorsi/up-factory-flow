import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, queryOptions } from "@tanstack/react-query";
import { Suspense, useState, useMemo } from "react";
import { getDashboardData } from "@/lib/orders.functions";
import { listRef } from "@/lib/catalog.functions";
import { StatCards } from "@/components/app/StatCards";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { MobileStageView } from "@/components/kanban/MobileStageView";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { OrdersListView } from "@/components/dashboard/OrdersListView";
import { OperatorsActiveView } from "@/components/dashboard/OperatorsActiveView";
import { OperatorsEfficiencyView } from "@/components/dashboard/OperatorsEfficiencyView";
import { ProductionKpisBar } from "@/components/dashboard/ProductionKpisBar";
import { DashboardFilters, applyDashboardFilters, emptyFilters, useFabricMatchContext, useStructureMatchContext, type DashboardFilterState } from "@/components/dashboard/DashboardFilters";

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
  const fabricCtx = useFabricMatchContext(filters);
  const structureCtx = useStructureMatchContext(filters);
  const { data: structures = [] } = useQuery({
    queryKey: ["ref", "structures"],
    queryFn: () => listRef({ data: { kind: "structures" } }),
  });
  const structureCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const allOrders = Object.values(data.byStage).flat();
    for (const s of structures) {
      if (!s.active) continue;
      const tokens = [s.code, s.name].filter(Boolean).map((t) => t.toLowerCase());
      if (tokens.length === 0) { counts[s.id] = 0; continue; }
      let n = 0;
      for (const o of allOrders) {
        const st = (o.structure_type ?? "").toLowerCase();
        const desc = (o.product_description ?? "").toLowerCase();
        if (tokens.some((t) => (st && (st === t || st.includes(t))) || desc.includes(t))) n++;
      }
      counts[s.id] = n;
    }
    return counts;
  }, [data.byStage, structures]);
  const filteredData = useMemo(
    () => ({ ...data, byStage: applyDashboardFilters(data.byStage, filters, fabricCtx, structureCtx) }),
    [data, filters, fabricCtx, structureCtx]
  );
  return (
    <div>
      <div className="px-4 pt-4 md:pt-6">
        <h1 className="text-2xl font-bold">Chão de fábrica</h1>
        <p className="text-sm text-muted-foreground">Vista em tempo real das etapas de produção</p>
        <DashboardFilters value={filters} onChange={setFilters} structureCounts={structureCounts} />
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