import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STAGE_LABELS, STAGES_ORDER, timeAgo } from "@/lib/format";
import type { DashboardData } from "@/lib/orders.functions";
import { AlertTriangle, Flame } from "lucide-react";
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";

export function OrdersListView({ data }: { data: DashboardData }) {
  const [q, setQ] = useState("");
  const all = useMemo(() => {
    const out: any[] = [];
    for (const s of STAGES_ORDER) for (const o of (data.byStage[s] ?? [])) out.push(o);
    return out;
  }, [data]);

  const filtered = q.trim()
    ? all.filter((o) => o.order_number.toLowerCase().includes(q.toLowerCase().trim()))
    : all;

  return (
    <Card className="p-2">
      <div className="p-2">
        <Input placeholder="Procurar por nº encomenda..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nº</TableHead>
              <TableHead>Produto</TableHead>
              <TableHead>Etapa atual</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Há</TableHead>
              <TableHead>Prazo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Sem encomendas</TableCell></TableRow>
            )}
            {filtered.map((o) => {
              const overdue = o.due_date && new Date(o.due_date) < new Date();
              return (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-xs font-bold">{o.order_number}</TableCell>
                  <TableCell className="text-sm">
                    <div className="font-medium">{o.product_description}</div>
                    {o.model_name && <div className="text-[11px] text-muted-foreground">{o.model_name}</div>}
                  </TableCell>
                  <TableCell><Badge variant="secondary">{STAGE_LABELS[o.current_stage as keyof typeof STAGE_LABELS] ?? o.current_stage}</Badge></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 flex-wrap">
                      {o.current_stage_status === "bloqueada" && (
                        <Badge variant="destructive" className="gap-1"><AlertTriangle className="size-3" />Bloqueada</Badge>
                      )}
                      {o.current_stage_status === "em_curso" && (
                        <Badge className="bg-emerald-600 text-white">Em curso</Badge>
                      )}
                      {o.current_stage_status === "pendente" && (
                        <Badge variant="outline">Pendente</Badge>
                      )}
                      {o.priority > 0 && <Flame className="size-3.5 text-amber-600" />}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{o.stage_started_at ? timeAgo(o.stage_started_at) : "—"}</TableCell>
                  <TableCell className={`text-xs ${overdue ? "text-destructive font-semibold" : ""}`}>{o.due_date ?? "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}