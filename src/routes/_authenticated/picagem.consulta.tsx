import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOrderProgress } from "@/lib/picking.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, Loader2, CheckCircle2, Circle, PlayCircle, PauseCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/picagem/consulta")({
  component: ConsultaPage,
});

const STAGE_LABELS: Record<string, string> = {
  corte: "Corte",
  costura: "Costura",
  estrutura: "Estrutura",
  estofo: "Estofo",
  acabamento: "Acabamento",
  embalagem: "Embalagem",
  picagem: "Picagem",
};

function statusIcon(status: string) {
  if (status === "concluida") return <CheckCircle2 className="size-5 text-green-600" />;
  if (status === "em_curso") return <PlayCircle className="size-5 text-primary animate-pulse" />;
  if (status === "pausada") return <PauseCircle className="size-5 text-amber-500" />;
  return <Circle className="size-5 text-muted-foreground/50" />;
}

function ConsultaPage() {
  const [code, setCode] = useState("");
  const fn = useServerFn(getOrderProgress);
  const m = useMutation({
    mutationFn: (order_number: string) => fn({ data: { order_number } }),
  });

  return (
    <div className="container mx-auto p-4 max-w-3xl space-y-6">
      <div className="border-b pb-4">
        <h1 className="text-3xl font-extrabold tracking-tight">Consultar encomenda</h1>
        <p className="text-sm text-muted-foreground">Digita o número da encomenda para ver em que etapa está.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form
            onSubmit={(e) => { e.preventDefault(); if (code.trim()) m.mutate(code.trim()); }}
            className="flex gap-2"
          >
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Nº da encomenda" className="h-12 text-lg font-mono" autoFocus />
            <Button type="submit" disabled={!code.trim() || m.isPending} className="h-12 gap-2">
              {m.isPending ? <Loader2 className="size-5 animate-spin" /> : <Search className="size-5" />} Consultar
            </Button>
          </form>
        </CardContent>
      </Card>

      {m.error && <Card className="border-destructive/40"><CardContent className="pt-6 text-sm text-destructive">{(m.error as any).message}</CardContent></Card>}

      {m.data && (
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-2xl">
              {m.data.customer_order ?? m.data.order_number}
              {m.data.items && m.data.items.length > 1 && (
                <span className="ml-2 text-sm text-muted-foreground font-normal">· {m.data.items.length} artigo(s)</span>
              )}
            </CardTitle>
            <p className="text-sm">{m.data.product_description}</p>
            <p className="text-xs text-muted-foreground">{m.data.structure_type} · {m.data.measure} · {m.data.color}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {m.data.items && m.data.items.length > 1 && (
              <div className="space-y-1">
                <div className="text-xs uppercase text-muted-foreground font-bold">Itens da nota</div>
                {m.data.items.map((it) => (
                  <div key={it.order_number} className="flex items-center gap-2 p-2 rounded border text-xs">
                    <span className="font-mono font-semibold">{it.order_number}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="flex-1 truncate">{it.product_description}</span>
                    <span className="uppercase text-muted-foreground">{it.status}</span>
                    {it.current_stage && (
                      <span className="text-primary font-semibold">{STAGE_LABELS[it.current_stage.stage] ?? it.current_stage.stage}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 p-3 rounded-md bg-accent/40">
              <span className="text-xs uppercase font-bold text-muted-foreground">Estado:</span>
              <span className="font-semibold">{m.data.status}</span>
              {m.data.current_stage && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-xs uppercase font-bold text-muted-foreground">Etapa atual:</span>
                  <span className="font-semibold">{STAGE_LABELS[m.data.current_stage.stage] ?? m.data.current_stage.stage}</span>
                </>
              )}
            </div>
            <div className="space-y-2">
              {m.data.stages.map((s) => (
                <div key={s.stage} className="flex items-center gap-3 p-2 rounded border">
                  {statusIcon(s.status)}
                  <div className="flex-1">
                    <p className="font-medium">{STAGE_LABELS[s.stage] ?? s.stage}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.started_at ? `Início: ${new Date(s.started_at).toLocaleString("pt-PT")}` : "Não iniciada"}
                      {s.finished_at ? ` · Fim: ${new Date(s.finished_at).toLocaleString("pt-PT")}` : ""}
                    </p>
                  </div>
                  <span className="text-xs uppercase text-muted-foreground">{s.status}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
