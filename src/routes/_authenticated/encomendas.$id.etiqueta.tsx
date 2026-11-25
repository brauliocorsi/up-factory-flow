import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/encomendas/$id/etiqueta")({
  head: () => ({ meta: [
    { title: "Etiqueta da encomenda | UP Fábrica" },
    { name: "description", content: "Acesso à etiqueta de produção da encomenda na UP Fábrica." },
    { property: "og:title", content: "Etiqueta da encomenda | UP Fábrica" },
    { property: "og:description", content: "Acesso à etiqueta de produção da encomenda na UP Fábrica." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: RedirectToBatch,
});

function RedirectToBatch() {
  const { id } = Route.useParams();
  return <Navigate to="/etiquetas/imprimir" search={{ ids: id }} replace />;
}