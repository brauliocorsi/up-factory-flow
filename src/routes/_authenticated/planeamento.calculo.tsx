import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getCatalogs } from "@/lib/catalog.functions";
import { listCategorySla, listModelSla, listProductSla } from "@/lib/sla.functions";
import { getDailyMinutes, listOperatorsByStage } from "@/lib/planning.functions";
import { getMySession } from "@/lib/operatorAuth.functions";
import { CapacityCalculator } from "@/components/planning/CapacityCalculator";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calculator } from "lucide-react";

const capacityOptions = queryOptions({
  queryKey: ["capacity-calculator-data"],
  staleTime: 60_000,
  queryFn: async () => {
    const [catalog, categoryTimes, modelTimes, productTimes, operators, dailyMinutes] =
      await Promise.all([
        getCatalogs(),
        listCategorySla(),
        listModelSla(),
        listProductSla(),
        listOperatorsByStage({ data: { work_date: new Date().toLocaleDateString("sv-SE") } }),
        getDailyMinutes(),
      ]);
    return { catalog, categoryTimes, modelTimes, productTimes, operators, dailyMinutes };
  },
});

export const Route = createFileRoute("/_authenticated/planeamento/calculo")({
  beforeLoad: async () => {
    const session = await getMySession();
    if (session.role !== "admin" && session.role !== "escritorio")
      throw redirect({ to: "/producao" });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(capacityOptions),
  head: () => ({
    meta: [
      { title: "Cálculo de capacidade de produção | UP Fábrica" },
      {
        name: "description",
        content:
          "Simule a capacidade por produto e etapa com as horas disponíveis de cada colaborador na UP Fábrica.",
      },
      { property: "og:title", content: "Cálculo de capacidade de produção | UP Fábrica" },
      {
        property: "og:description",
        content: "Horas de mão de obra, tempos por produto e capacidade estimada da equipa.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CapacityPage,
  errorComponent: CapacityError,
  notFoundComponent: () => <div className="p-6 text-center">Cálculo não encontrado.</div>,
});

function CapacityError() {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="font-semibold">Não foi possível carregar o cálculo.</h1>
      <Button onClick={() => router.invalidate()}>Tentar novamente</Button>
    </div>
  );
}

function CapacityPage() {
  const { data } = useSuspenseQuery(capacityOptions);
  return (
    <div className="mx-auto w-full max-w-7xl min-w-0 space-y-5 p-4 sm:p-6">
      <Button asChild variant="ghost" size="sm">
        <Link to="/encomendas">
          <ArrowLeft className="size-4" /> Encomendas
        </Link>
      </Button>
      <header className="flex items-center gap-3">
        <Calculator className="size-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Cálculo de produção</h1>
          <p className="mt-1 text-sm text-muted-foreground">Capacidade por produto e colaborador</p>
        </div>
      </header>
      <CapacityCalculator {...data} />
    </div>
  );
}
