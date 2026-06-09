import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getStockOverview } from "@/lib/stock.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Boxes, Layers, Scissors } from "lucide-react";

export const Route = createFileRoute("/_authenticated/stock/")({
  component: StockDashboard,
});

function StockDashboard() {
  const { data } = useQuery({ queryKey: ["stock", "overview"], queryFn: () => getStockOverview() });
  const totals = data?.totals;
  const alerts = data?.alerts;
  const totalAlerts = (alerts?.shells.length ?? 0) + (alerts?.covers.length ?? 0) + (alerts?.rolls.length ?? 0);

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Stock de semi-acabados</h1>
        <p className="text-sm text-muted-foreground">Visão geral de cascos, capas e rolos de tecido.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Boxes} label="Cascos" value={totals?.shells ?? 0} to="/stock/cascos" />
        <StatCard icon={Layers} label="Capas" value={totals?.covers ?? 0} to="/stock/capas" />
        <StatCard icon={Scissors} label="Tecido (m)" value={Math.round(totals?.fabric_meters ?? 0)} to="/stock/tecidos" />
        <StatCard icon={AlertTriangle} label="Alertas" value={totalAlerts} highlight={totalAlerts > 0} />
      </div>

      <Card className="p-4">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><AlertTriangle className="size-4 text-warning" /> Abaixo do mínimo</h2>
        {totalAlerts === 0 && <p className="text-sm text-muted-foreground">Sem alertas. Stock saudável.</p>}
        <div className="space-y-2">
          {alerts?.shells.map((r: any) => (
            <AlertRow key={`s-${r.id}`} type="Casco" code={r.code} name={r.name} qty={`${r.quantity}/${r.min_quantity}`} to="/stock/cascos" />
          ))}
          {alerts?.covers.map((r: any) => (
            <AlertRow key={`c-${r.id}`} type="Capa" code={r.code} name={r.name} qty={`${r.quantity}/${r.min_quantity}`} to="/stock/capas" />
          ))}
          {alerts?.rolls.map((r: any) => (
            <AlertRow key={`r-${r.id}`} type="Tecido" code={r.fabric_ref_code ?? "—"} name={r.name} qty={`${r.meters}m / ${r.min_meters}m`} to="/stock/tecidos" />
          ))}
        </div>
      </Card>

      <Card className="p-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold">Produção para stock</h2>
          <p className="text-sm text-muted-foreground">Ordens de cascos/capas criadas sem cliente.</p>
        </div>
        <Link to="/stock/producao" className="text-sm text-primary underline">Abrir →</Link>
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold mb-2">Receitas de produtos</h2>
        <p className="text-sm text-muted-foreground mb-3">Cada produto consome um casco e (opcionalmente) uma capa.</p>
        <Link to="/produtos/receitas" className="text-sm text-primary underline">Gerir receitas →</Link>
      </Card>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, to, highlight }: any) {
  const content = (
    <Card className={`p-4 ${highlight ? "border-warning bg-warning/5" : ""}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-4" /> {label}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </Card>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}

function AlertRow({ type, code, name, qty, to }: any) {
  return (
    <Link to={to} className="flex items-center justify-between gap-3 p-2 rounded-md border hover:bg-accent">
      <div className="flex items-center gap-2 min-w-0">
        <Badge variant="outline" className="shrink-0">{type}</Badge>
        <span className="font-mono text-xs">{code}</span>
        <span className="text-sm truncate">{name}</span>
      </div>
      <span className="text-sm font-semibold text-warning shrink-0">{qty}</span>
    </Link>
  );
}