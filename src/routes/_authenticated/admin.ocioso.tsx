import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Download, Hourglass } from "lucide-react";
import { getIdleReport, type IdleRow } from "@/lib/pauses.functions";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/admin/ocioso")({
  head: () => ({
    meta: [
      { title: "Ocioso e pausas — UP Fábrica" },
      { name: "description", content: "Tempo produtivo, pausas por motivo e tempo ocioso de cada colaborador." },
      { property: "og:title", content: "Ocioso e pausas — UP Fábrica" },
      { property: "og:description", content: "Tempo ocioso e pausas por colaborador." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IdlePage,
});

const SHIFT_START = 480;
const SHIFT_END = 1050;

function today() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });
}
function fmtMin(m: number) {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h > 0 ? `${h}h ${String(r).padStart(2, "0")}m` : `${r}m`;
}
function hhmm(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function IdlePage() {
  const { session } = useAuth();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const fetchFn = useServerFn(getIdleReport);
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["idle-report", from, to],
    queryFn: () => fetchFn({ data: { from, to } }),
    enabled: Boolean(session) && !!from && !!to && from <= to,
    refetchInterval: 60_000,
  });

  const byOperator = useMemo(() => {
    const m = new Map<string, { name: string; code: string; prod: number; pause: number; idle: number; shift: number; reasons: Record<string, number> }>();
    for (const r of data as IdleRow[]) {
      const cur = m.get(r.operator_id) ?? { name: r.operator_name, code: r.operator_code, prod: 0, pause: 0, idle: 0, shift: 0, reasons: {} };
      cur.prod += r.productive_min; cur.pause += r.pause_min; cur.idle += r.idle_min; cur.shift += r.shift_min;
      for (const [k, v] of Object.entries(r.pause_by_reason ?? {})) cur.reasons[k] = (cur.reasons[k] ?? 0) + v;
      m.set(r.operator_id, cur);
    }
    return [...m.values()].sort((a, b) => b.idle - a.idle);
  }, [data]);

  function exportCsv() {
    const header = ["Dia", "Código", "Nome", "Produtivo (min)", "Pausa (min)", "Ocioso (min)", "Turno decorrido (min)", "Pausas por motivo"];
    const lines = [header.join(";")];
    for (const r of data as IdleRow[]) {
      const reasons = Object.entries(r.pause_by_reason ?? {}).map(([k, v]) => `${k}: ${v}`).join(", ");
      lines.push([r.day, r.operator_code, r.operator_name, r.productive_min, r.pause_min, r.idle_min, r.shift_min, reasons].join(";"));
    }
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ocioso-pausas-${from}-a-${to}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  const days = (data as IdleRow[]).filter((r) => r.day === to || from === to);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Hourglass className="size-5" /> Ocioso e pausas</h1>
        <p className="text-sm text-muted-foreground">
          Ocioso = tempo dentro do horário (08:00–17:30, sem os intervalos) em que o colaborador, estando presente, não tinha nenhuma encomenda a produzir nem pausa registada.
        </p>
      </div>

      <Card className="p-4 flex flex-wrap items-end gap-3">
        <div><Label className="text-xs">De</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label className="text-xs">Até</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <Button variant="outline" onClick={() => { setFrom(today()); setTo(today()); }}>Hoje</Button>
        <Button variant="outline" onClick={() => {
          const d = new Date(); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow);
          setFrom(d.toLocaleDateString("sv-SE")); setTo(today());
        }}>Esta semana</Button>
        <Button variant="outline" className="gap-1 ml-auto" onClick={exportCsv} disabled={(data as IdleRow[]).length === 0}>
          <Download className="size-4" /> CSV
        </Button>
      </Card>

      {error && <div className="text-sm text-destructive">{(error as Error).message}</div>}
      {isLoading ? (
        <div className="text-sm text-muted-foreground">A carregar…</div>
      ) : byOperator.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Sem registos neste período.</Card>
      ) : (
        <Card className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-2">Colaborador</th>
                <th className="text-right p-2">Produtivo</th>
                <th className="text-right p-2">Pausa</th>
                <th className="text-right p-2">Ocioso</th>
                <th className="text-right p-2">Ocupação</th>
                <th className="text-left p-2">Pausas por motivo</th>
              </tr>
            </thead>
            <tbody>
              {byOperator.map((o) => {
                const occ = o.shift > 0 ? Math.round((o.prod / o.shift) * 100) : 0;
                return (
                  <tr key={o.code} className="border-t">
                    <td className="p-2"><span className="font-medium">{o.name}</span> <span className="text-xs text-muted-foreground">({o.code})</span></td>
                    <td className="p-2 text-right tabular-nums text-emerald-700">{fmtMin(o.prod)}</td>
                    <td className="p-2 text-right tabular-nums text-amber-700">{fmtMin(o.pause)}</td>
                    <td className="p-2 text-right tabular-nums font-semibold text-destructive">{fmtMin(o.idle)}</td>
                    <td className="p-2 text-right tabular-nums">{occ}%</td>
                    <td className="p-2 text-xs">
                      {Object.entries(o.reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                        <span key={k} className="inline-block mr-2 mb-1 rounded bg-amber-100 text-amber-900 px-1.5 py-0.5">{k}: {fmtMin(v)}</span>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {days.length > 0 && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold">Linha do tempo — {to.split("-").reverse().join("/")}</h2>
            <div className="flex gap-3 text-xs">
              <span className="flex items-center gap-1"><span className="size-3 rounded bg-emerald-500" /> A produzir</span>
              <span className="flex items-center gap-1"><span className="size-3 rounded bg-amber-400" /> Pausa</span>
              <span className="flex items-center gap-1"><span className="size-3 rounded bg-destructive" /> Ocioso</span>
            </div>
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground pl-32">
            {[480, 600, 720, 840, 960, 1050].map((m) => <span key={m}>{hhmm(m)}</span>)}
          </div>
          {days.filter((r) => r.day === to).map((r) => (
            <div key={r.operator_id + r.day} className="flex items-center gap-2">
              <div className="w-30 shrink-0 text-xs truncate w-32">{r.operator_name}</div>
              <div className="relative flex-1 h-5 rounded bg-muted overflow-hidden">
                {r.segments.map((s, i) => (
                  <div
                    key={i}
                    title={`${hhmm(s.from)}–${hhmm(s.to)} · ${s.kind === "prod" ? "A produzir" : s.kind === "pausa" ? `Pausa: ${s.reason ?? ""}` : "Ocioso"}`}
                    className={`absolute top-0 h-full ${s.kind === "prod" ? "bg-emerald-500" : s.kind === "pausa" ? "bg-amber-400" : "bg-destructive"}`}
                    style={{
                      left: `${((s.from - SHIFT_START) / (SHIFT_END - SHIFT_START)) * 100}%`,
                      width: `${((s.to - s.from) / (SHIFT_END - SHIFT_START)) * 100}%`,
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
