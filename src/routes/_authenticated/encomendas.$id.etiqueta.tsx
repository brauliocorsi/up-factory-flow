import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/encomendas/$id/etiqueta")({
  component: RedirectToBatch,
});

function RedirectToBatch() {
  const { id } = Route.useParams();
  return <Navigate to="/etiquetas/imprimir" search={{ ids: id }} replace />;
}