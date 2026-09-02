import { Component, type ReactNode } from "react";
import { reportLovableError } from "@/lib/lovable-error-reporting";

/**
 * Boundary React de último recurso. O router só protege erros lançados dentro
 * das rotas; valores lançados fora (efeitos de layout, providers, componentes
 * partilhados) sobem até à raiz e desmontam a app inteira ("ecrã branco").
 * Aqui normalizamos qualquer valor lançado — incluindo `undefined`.
 */
export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: unknown; hasError: boolean }
> {
  state = { error: undefined as unknown, hasError: false };

  static getDerivedStateFromError(error: unknown) {
    return { error, hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[AppErrorBoundary]", error);
    reportLovableError(error ?? new Error("Erro desconhecido (valor lançado vazio)"), {
      boundary: "app_error_boundary",
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const error = this.state.error;
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
            onClick={() => this.setState({ error: undefined, hasError: false })}
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
}
