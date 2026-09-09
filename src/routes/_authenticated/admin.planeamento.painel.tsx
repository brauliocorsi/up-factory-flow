import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { PlanningPanel } from "@/components/planning/PlanningPanel";

export const Route = createFileRoute("/_authenticated/admin/planeamento/painel")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase
      .from("user_roles").select("role").eq("user_id", data.user.id);
    const list = (roles ?? []).map((r: any) => r.role as string);
    if (!list.includes("admin") && !list.includes("escritorio")) {
      throw redirect({ to: "/producao" });
    }
  },
  component: PainelPage,
  errorComponent: ({ error, reset }) => (
    <div className="max-w-xl mx-auto p-6 text-center space-y-3">
      <AlertTriangle className="size-8 text-orange-600 mx-auto" />
      <p className="text-sm text-muted-foreground">{(error as any)?.message}</p>
      <Button onClick={() => reset()}>Tentar novamente</Button>
    </div>
  ),
  notFoundComponent: () => (
    <div className="p-6 text-center text-sm text-muted-foreground">Página não encontrada.</div>
  ),
  head: () => ({
    meta: [
      { title: "Painel de planeamento semanal | UP Fábrica" },
      {
        name: "description",
        content:
          "Planeamento semana a semana: compara o tempo necessário das encomendas com o tempo disponível das pessoas de cada posto.",
      },
      { property: "og:title", content: "Painel de planeamento semanal | UP Fábrica" },
      {
        property: "og:description",
        content: "Vê por dia e por posto se o trabalho planeado cabe no tempo útil dos trabalhadores presentes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function PainelPage() {
  return (
    <div className="max-w-7xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link
          to="/admin/planeamento"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Voltar
        </Link>
        <h1 className="text-2xl font-bold">Painel de planeamento</h1>
      </div>
      <PlanningPanel canEdit />
    </div>
  );
}
