import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlanningTable } from "./PlanningTable";
import { PlanningPanel } from "./PlanningPanel";
import { WeekLoadGrid } from "./WeekLoadGrid";
import { CalendarDays, ListOrdered, ChartNoAxesColumnIncreasing } from "lucide-react";

export function PlanningWorkspace({ canEdit }: { canEdit: boolean }) {
  return (
    <Tabs defaultValue="orders" className="min-w-0 space-y-5">
      <TabsList className="grid h-auto w-full grid-cols-1 gap-1 sm:grid-cols-3 sm:w-fit">
        <TabsTrigger value="orders" className="gap-2 py-2">
          <ListOrdered className="size-4" /> Encomendas a planear
        </TabsTrigger>
        <TabsTrigger value="week" className="gap-2 py-2">
          <CalendarDays className="size-4" /> Plano semanal
        </TabsTrigger>
        <TabsTrigger value="load" className="gap-2 py-2">
          <ChartNoAxesColumnIncreasing className="size-4" /> Carga por posto
        </TabsTrigger>
      </TabsList>
      <TabsContent value="orders">
        <PlanningTable canEdit={canEdit} />
      </TabsContent>
      <TabsContent value="week">
        <WeekLoadGrid canEdit={canEdit} />
      </TabsContent>
      <TabsContent value="load">
        <PlanningPanel canEdit={canEdit} />
      </TabsContent>
    </Tabs>
  );
}
