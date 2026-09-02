import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicPanel, type PanelData } from "@/lib/publicPanel.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Factory, PackageCheck, Timer, Gauge } from "lucide-react";
import { ShiftClock } from "@/components/panel/ShiftClock";
import { PerformanceGauge } from "@/components/panel/PerformanceGauge";
import { ShiftBlocksChart } from "@/components/panel/ShiftBlocksChart";
import { LiveOperatorsPanel } from "@/components/panel/LiveOperatorsPanel";
import { TONE_CLASSES, elapsedUsefulMinutes, toneFor } from "@/lib/shift";

const STORAGE_KEY = "factory-panel-code";

export const Route = createFileRoute("/painel")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { c?: string } =>
    typeof s.c === "string" && s.c ? { c: s.c } : {},
  head: () => ({
    meta: [
      { title: "Painel de Produção — UP Móveis" },
      { name: "description", content: "Desempenho diário da fábrica em tempo real: ritmo de produção, encomendas do dia e operadores ativos." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Painel de Produção — UP Móveis" },
      { property: "og:description", content: "Desempenho diário da fábrica em tempo real." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PanelPage,
});

function PanelPage() {
  const { c } = Route.useSearch();
  const [code, setCode] = useState<string>("");
  const [input, setInput] = useState("");

  useEffect(() => {
    if (c) {
      setCode(c);
      localStorage.setItem(STORAGE_KEY, c);
      return;
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setCode(saved);
  }, [c]);

  const fetchPanel = useServerFn(getPublicPanel);
  const query = useQuery({
    queryKey: ["public-panel", code],
    queryFn: () => fetchPanel({ data: { code } }),
    enabled: code.length > 0,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  // relógio local (contadores em tempo real)
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const invalid = query.data && !query.data.ok;

  if (!code || invalid) {
    return (
      <div className="min-h-screen grid place-items-center bg-background p-6">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="mx-auto size-12 rounded-xl bg-primary/10 text-primary grid place-items-center mb-2">
              <Factory className="size-6" />
            </div>
            <CardTitle>Painel de Produção</CardTitle>
            <CardDescription>Introduz o código de acesso do ecrã.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const v = input.trim();
                if (!v) return;
                localStorage.setItem(STORAGE_KEY, v);
                setCode(v);
              }}
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Código de acesso"
                autoFocus
              />
              {invalid && query.data && !query.data.ok && (
                <p className="text-sm text-destructive">{query.data.message}</p>
              )}
              <Button type="submit" className="w-full">Entrar</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!query.data || !query.data.ok) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground">A carregar painel…</div>;
  }

  return <PanelView data={query.data.data} now={now} />;
}

function PanelView({ data, now }: { data: PanelData; now: Date }) {
  const elapsed = elapsedUsefulMinutes(now);
  const ops = Math.max(1, data.active_operators);
  const expected = Math.round(elapsed * ops);
  const rhythmPct = useMemo(
    () => (expected > 0 ? Math.round((data.productive_minutes_today / expected) * 100) : null),
    [expected, data.productive_minutes_today]
  );
  const ordersPct = data.orders_due_today > 0
    ? Math.round((data.orders_due_done / data.orders_due_today) * 100)
    : null;
  const slaPct = data.sla_actual_minutes > 0 && data.sla_expected_minutes > 0
    ? Math.round((data.sla_expected_minutes / data.sla_actual_minutes) * 100)
    : null;

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <header className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary/10 text-primary grid place-items-center">
            <Factory className="size-5" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-black leading-tight">Painel de Produção</h1>
            <p className="text-xs text-muted-foreground">
              {now.toLocaleDateString("pt-PT", { weekday: "long", day: "2-digit", month: "long" })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-2 rounded-full bg-emerald-500 animate-pulse" /> Em tempo real
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <ShiftClock now={now} />
          <PerformanceGauge pct={rhythmPct} done={data.productive_minutes_today} expected={expected} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <MiniCard
              icon={<Gauge className="size-4" />}
              label="Ritmo do dia"
              value={rhythmPct == null ? "—" : `${rhythmPct}%`}
              sub={`${data.productive_minutes_today} / ${expected} min`}
              pct={rhythmPct}
            />
            <MiniCard
              icon={<PackageCheck className="size-4" />}
              label="Encomendas de hoje"
              value={`${data.orders_due_done}/${data.orders_due_today}`}
              sub={ordersPct == null ? "sem saídas hoje" : `${ordersPct}% concluídas`}
              pct={ordersPct}
            />
            <MiniCard
              icon={<Timer className="size-4" />}
              label="SLA das etapas"
              value={slaPct == null ? "—" : `${slaPct}%`}
              sub={`${data.sla_actual_minutes} min reais · ${data.sla_expected_minutes} esperados`}
              pct={slaPct}
            />
          </div>
          <ShiftBlocksChart blocks={data.blocks} operators={data.active_operators} now={now} />
        </div>
        <div className="xl:h-[calc(100vh-7rem)] xl:sticky xl:top-6">
          <LiveOperatorsPanel operators={data.operators} now={now} />
        </div>
      </div>
    </div>
  );
}

function MiniCard({ icon, label, value, sub, pct }: {
  icon: React.ReactNode; label: string; value: string; sub: string; pct: number | null;
}) {
  const t = TONE_CLASSES[toneFor(pct)];
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}{label}
      </div>
      <div className={`text-3xl font-black mt-2 ${t.text}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
      <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${t.bg}`} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
      </div>
    </div>
  );
}
