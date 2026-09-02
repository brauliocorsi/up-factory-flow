import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { RouteErrorFallback } from "./components/app/RouteErrorFallback";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // Garante um boundary em TODAS as rotas, mesmo quando o valor lançado
    // não é um Error (causa do "Uncaught undefined" com ecrã branco).
    defaultErrorComponent: RouteErrorFallback,
  });

  return router;
};
