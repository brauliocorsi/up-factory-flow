import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Zap } from "lucide-react";
import { formatDatePT } from "@/lib/format";
import {
  getBacklog, activateOrders, type BacklogItem, type ActivateResult,
} from "@/lib/planning.functions";

function statusBadge(s: BacklogItem["status"]) {
  if (s === "risco_saida") return <Badge variant="destructive">Risco saída</Badge>;
  if (s === "atrasada_folga") return <Badge className="bg-amber-500 hover:bg-amber-500/90">Atrasada folga</Badge>;
  return <Badge variant="secondary">OK</Badge>;
}

export function BacklogTable() {
  const qc = useQueryClient();
  const fetchFn = useServerFn(getBacklog);
  const activateFn = useServerFn(activateOrders);
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["backlog"],
    queryFn: () => fetchFn(),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastResult, setLastResult] = useState<ActivateResult | null>(null);
  const [openFailures, setOpenFailures] = useState(false);

  const allIds = useMemo(() => items.map((i) => i.order_id), [items]);
  const allChecked = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const mut = useMutation({
    mutationFn: (ids: string[]) => activateFn({ data: { order_ids: ids } }),
    onSuccess: (res) => {
      setLastResult(res);
      const ok = res.activated.length;
      const fail = res.failed.length;
      const skip = res.skipped.length;
      if (fail === 0) toast.success(`${ok} ativada(s)${skip ? `, ${skip} já ativas` : ""}`);
      else toast.warning(`${ok} ativada(s), ${fail} falha(s)${skip ? `, ${skip} já ativas` : ""}`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["backlog"] });
      qc.invalidateQueries({ queryKey: ["activation-suggestions"] });
      qc.invalidateQueries({ queryKey: ["global-load"] });
      qc.invalidateQueries({ queryKey: ["stage-queue"] });
      qc.invalidateQueries({ queryKey: ["stage-capload"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro a ativar"),
  });

  function toggle(id: string) {
    setSelected((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(allIds));
  }

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b">
        <div className="text-sm">
          <span className="font-medium">{items.length}</span> encomenda(s) em backlog
          {selected.size > 0 && <> · <span className="font-medium">{selected.size}</span> selecionada(s)</>}
        </div>
        <Button
          size="sm"
          disabled={selected.size === 0 || mut.isPending}
          onClick={() => mut.mutate(Array.from(selected))}
          className="gap-1"
        >
          <Zap className="size-3.5" />
          Ativar selecionadas ({selected.size})
        </Button>
      </div>

      {lastResult && lastResult.failed.length > 0 && (
        <div className="border-b bg-red-50 dark:bg-red-950/30 text-sm">
          <button
            type="button"
            className="w-full text-left px-3 py-2 flex items-center gap-1 font-medium text-red-700 dark:text-red-300"
            onClick={() => setOpenFailures((o) => !o)}
          >
            {openFailures ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            {lastResult.failed.length} falha(s) na última ativação
          </button>
          {openFailures && (
            <ul className="px-3 pb-3 space-y-1 text-xs text-red-800 dark:text-red-200">
              {lastResult.failed.map((f) => (
                <li key={f.order_id}><span className="font-mono">{f.order_id.slice(0, 8)}</span> — {f.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="p-6 text-center text-sm text-muted-foreground">A carregar…</div>
      ) : items.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">Sem encomendas pendentes.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase">
              <tr>
                <th className="p-2 w-8">
                  <Checkbox checked={allChecked} onCheckedChange={() => toggleAll()} />
                </th>
                <th className="text-left p-2">Nº cliente</th>
                <th className="text-left p-2">Produto</th>
                <th className="text-left p-2">Medida</th>
                <th className="text-left p-2">Tecido</th>
                <th className="text-left p-2">Estrutura</th>
                <th className="text-left p-2">Saída</th>
                <th className="text-left p-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.order_id} className="border-t">
                  <td className="p-2"><Checkbox checked={selected.has(it.order_id)} onCheckedChange={() => toggle(it.order_id)} /></td>
                  <td className="p-2 font-mono text-xs">{it.customer_order ?? "—"}</td>
                  <td className="p-2">
                    <div>{it.product_description ?? it.model_name ?? "—"}</div>
                    {it.color && <div className="text-xs text-muted-foreground">{it.color}</div>}
                  </td>
                  <td className="p-2">{it.measure ?? "—"}</td>
                  <td className="p-2 text-xs">
                    {it.fabric_type ?? "—"}{it.fabric_ref ? ` · ${it.fabric_ref}` : ""}
                  </td>
                  <td className="p-2">{it.structure_type ?? "—"}</td>
                  <td className="p-2 tabular-nums">{it.due_date ? formatDatePT(it.due_date) : "—"}</td>
                  <td className="p-2">{statusBadge(it.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}