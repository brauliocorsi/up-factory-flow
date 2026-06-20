import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Scissors, Hammer, Zap } from "lucide-react";
import { formatDatePT } from "@/lib/format";
import {
  getActivationSuggestions, activateOrders, type ActivationGroup,
} from "@/lib/planning.functions";

function describeKey(g: ActivationGroup): string {
  if (g.kind === "corte") {
    const parts = [g.key.measure, g.key.fabric_type].filter(Boolean);
    return `Modelo + ${parts.join(" · ") || "—"}`;
  }
  return [g.key.structure_type, g.key.measure].filter(Boolean).join(" · ") || "—";
}

export function ActivationSuggestions() {
  const qc = useQueryClient();
  const fetchFn = useServerFn(getActivationSuggestions);
  const activateFn = useServerFn(activateOrders);
  const { data: groups = [] } = useQuery({
    queryKey: ["activation-suggestions"],
    queryFn: () => fetchFn(),
  });

  const mut = useMutation({
    mutationFn: (ids: string[]) => activateFn({ data: { order_ids: ids } }),
    onSuccess: (res) => {
      const ok = res.activated.length;
      const fail = res.failed.length;
      if (fail === 0) toast.success(`${ok} ativada(s)`);
      else toast.warning(`${ok} ativada(s), ${fail} falha(s)`);
      qc.invalidateQueries({ queryKey: ["backlog"] });
      qc.invalidateQueries({ queryKey: ["activation-suggestions"] });
      qc.invalidateQueries({ queryKey: ["global-load"] });
      qc.invalidateQueries({ queryKey: ["stage-queue"] });
      qc.invalidateQueries({ queryKey: ["stage-capload"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro a ativar"),
  });

  if (groups.length === 0) return null;

  const urgent = groups.filter((g) => g.urgent);
  const others = groups.filter((g) => !g.urgent);

  return (
    <Card className="p-3 space-y-2">
      <div className="text-sm font-semibold">
        Sugestões para ativar
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {groups.length} grupo(s) {urgent.length > 0 && <>· <span className="text-red-600">{urgent.length} urgente(s)</span></>}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Encomendas iguais no backlog (≥ 2). Ativar em conjunto otimiza o setup. Urgentes têm a 1ª etapa nos próximos 5 dias úteis.
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {[...urgent, ...others].map((g, i) => (
          <div
            key={i}
            className={`rounded-md border p-2 text-sm space-y-1 ${
              g.urgent ? "border-red-400 bg-red-50/40 dark:bg-red-950/20" : ""
            }`}
          >
            <div className="flex items-center gap-1.5">
              {g.kind === "corte" ? <Scissors className="size-3.5" /> : <Hammer className="size-3.5" />}
              <Badge variant="outline" className="capitalize">{g.kind}</Badge>
              {g.urgent && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">urgente</Badge>}
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">{g.count} pç</span>
            </div>
            <div className="text-xs">{describeKey(g)}</div>
            <div className="text-xs text-muted-foreground tabular-nums">
              Alvo: {g.earliest_target ? formatDatePT(g.earliest_target) : "—"}
              {" · "}Saída: {g.earliest_due_date ? formatDatePT(g.earliest_due_date) : "—"}
            </div>
            <Button
              size="sm"
              variant={g.urgent ? "default" : "outline"}
              className="w-full gap-1 mt-1"
              disabled={mut.isPending}
              onClick={() => mut.mutate(g.order_ids)}
            >
              <Zap className="size-3.5" /> Encaixar e ativar lote
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}