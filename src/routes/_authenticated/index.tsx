import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, queryOptions } from "@tanstack/react-query";
import { Suspense, useState, useMemo } from "react";
import { Factory, Columns3, List, Users, ChartNoAxesColumnIncreasing } from "lucide-react";
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
import {
  DashboardFilters,
  applyDashboardFilters,
  emptyFilters,
  useFabricMatchContext,
  useStructureMatchContext,
  type DashboardFilterState,
} from "@/components/dashboard/DashboardFilters";

const dashboardQuery = queryOptions({
  queryKey: ["dashboard"],
  queryFn: () => getDashboardData(),
});

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Painel de produção | UP Fábrica" },
      { name: "description", content: "Estado da produção, equipa e encomendas da UP Fábrica." },
      { property: "og:title", content: "Painel de produção | UP Fábrica" },
      { property: "og:description", content: "Acompanhe as etapas e a equipa da fábrica." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DashboardPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>
  ),
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
      if (tokens.length === 0) {
        counts[s.id] = 0;
        continue;
      }
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
    () => ({
      ...data,
      byStage: applyDashboardFilters(data.byStage, filters, fabricCtx, structureCtx),
    }),
    [data, filters, fabricCtx, structureCtx],
  );
  return (
    <div className="mx-auto w-full max-w-[1800px] min-w-0 space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg border bg-card">
            <Factory className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Chão de fábrica</h1>
            <p className="mt-1 text-xs text-muted-foreground">Produção e equipa</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-success" />
          Em tempo real
        </div>
      </header>
      <StatCards stats={data.stats} />
      <ProductionKpisBar />
      <div className="space-y-5 border-t pt-5">
        <DashboardFilters value={filters} onChange={setFilters} structureCounts={structureCounts} />
        <div className="text-xs text-muted-foreground">
          {Object.values(filteredData.byStage).flat().length} encomendas na vista{" "}
          <span className="ml-2 border-l pl-2">Indicadores gerais da fábrica</span>
        </div>
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-lg sm:flex sm:w-fit">
            <TabsTrigger value="kanban" className="gap-2 py-2">
              <Columns3 className="size-4" />
              Kanban
            </TabsTrigger>
            <TabsTrigger value="lista" className="gap-2 py-2">
              <List className="size-4" />
              Encomendas
            </TabsTrigger>
            <TabsTrigger value="operadores" className="gap-2 py-2">
              <Users className="size-4" />
              Equipa
            </TabsTrigger>
            <TabsTrigger value="eficiencia" className="gap-2 py-2">
              <ChartNoAxesColumnIncreasing className="size-4" />
              Eficiência
            </TabsTrigger>
          </TabsList>
          <TabsContent value="kanban" className="mt-4">
            <div className="hidden lg:block min-w-0">
              <KanbanBoard data={filteredData} />
            </div>
            <div className="lg:hidden min-w-0">
              <MobileStageView data={filteredData} />
            </div>
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
