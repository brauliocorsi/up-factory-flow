import { useRouter } from "@tanstack/react-router";

/**
 * Fallback usado por todas as rotas (defaultErrorComponent). Normaliza valores
 * lançados que não são Error (ex.: `undefined`, string ou Response) para evitar
 * ecrã branco com "Uncaught undefined".
 */
export function RouteErrorFallback({ error, reset }: { error: unknown; reset?: () => void }) {
  const router = useRouter();
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Erro inesperado. Tenta novamente.";

  return (
    <div className="mx-auto max-w-lg p-6 text-center space-y-3">
      <h2 className="text-lg font-semibold">Algo correu mal</h2>
      <p className="text-sm text-muted-foreground break-words">{message}</p>
      <div className="flex justify-center gap-2 pt-2">
        <button
          onClick={() => {
            router.invalidate();
            reset?.();
          }}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Tentar novamente
        </button>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Recarregar
        </button>
      </div>
    </div>
  );
}
