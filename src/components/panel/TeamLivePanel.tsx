import { Coffee, Hourglass, Play, UserCircle2 } from "lucide-react";
import type { PanelActivity, PanelIdle, PanelOperator } from "@/lib/publicPanel.functions";
import { STAGE_LABELS } from "@/lib/format";
import { formatMinutes } from "@/lib/shift";

type State = "trabalhar" | "pausa" | "entre" | "parado";

export type TeamMember = {
  id: string;
  name: string;
  state: State;
  since: number | null; // ms timestamp for live timer
  pauseReason: string | null;
  orders: NonNullable<PanelOperator["orders"]>;
  productive: number;
  pause: number;
  between: number;
  done: number;
};

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function liveProd(o: { productive_seconds: number; is_paused: boolean; last_resume_at: string | null }, now: Date) {
  if (o.is_paused || !o.last_resume_at) return o.productive_seconds ?? 0;
  return (o.productive_seconds ?? 0) + Math.max(0, (now.getTime() - new Date(o.last_resume_at).getTime()) / 1000);
}

export function buildTeam(ops: PanelOperator[], idle: PanelIdle[], activity: PanelActivity[]): TeamMember[] {
  const map = new Map<string, TeamMember>();
  const get = (id: string, name: string) => {
    let m = map.get(id);
    if (!m) {
      m = { id, name, state: "parado", since: null, pauseReason: null, orders: [], productive: 0, pause: 0, between: 0, done: 0 };
      map.set(id, m);
    }
    return m;
  };
  for (const r of idle) {
    const m = get(r.operator_id, r.operator_name);
    m.productive = r.productive_min; m.pause = r.pause_min; m.between = r.idle_min;
  }
  for (const a of activity) {
    const m = get(a.operator_id, a.operator_name);
    m.done = a.done_today;
    if (a.last_finished_at) { m.state = "entre"; m.since = new Date(a.last_finished_at).getTime(); }
  }
  for (const op of ops) {
    const m = get(op.operator_id ?? op.operator_name, op.operator_name);
    m.orders = op.orders ?? [];
    const running = m.orders.some((o) => !o.is_paused);
    if (running) { m.state = "trabalhar"; m.since = null; }
    else if (m.orders.length) {
      m.state = "pausa";
      const ts = m.orders.map((o) => (o.pause_since ? new Date(o.pause_since).getTime() : NaN)).filter((n) => !isNaN(n));
      m.since = ts.length ? Math.max(...ts) : null;
      m.pauseReason = m.orders.find((o) => o.pause_reason)?.pause_reason ?? null;
    }
  }
  const order: Record<State, number> = { pausa: 0, entre: 1, trabalhar: 2, parado: 3 };
  return [...map.values()]
    .filter((m) => m.state !== "parado" || m.productive + m.pause > 0)
    .sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));
}

const STYLE: Record<State, { label: string; box: string; chip: string; icon: React.ReactNode }> = {
  trabalhar: { label: "A trabalhar", box: "border-emerald-500/50 bg-emerald-500/5", chip: "bg-emerald-500 text-white", icon: <Play className="size-4" /> },
  pausa: { label: "Em pausa", box: "border-amber-500/60 bg-amber-500/10", chip: "bg-amber-500 text-white", icon: <Coffee className="size-4" /> },
  entre: { label: "Sem encomenda", box: "border-red-500/50 bg-red-500/5", chip: "bg-red-500 text-white", icon: <Hourglass className="size-4" /> },
  parado: { label: "Sem atividade", box: "border-border", chip: "bg-muted text-muted-foreground", icon: <UserCircle2 className="size-4" /> },
};

export function TeamLivePanel({ team, now }: { team: TeamMember[]; now: Date }) {
  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm uppercase tracking-widest text-muted-foreground">Equipa ao vivo</div>
        <div className="flex gap-3 text-xs text-muted-foreground">
          <Legend c="bg-emerald-500" t="A trabalhar" />
          <Legend c="bg-amber-500" t="Em pausa" />
          <Legend c="bg-red-500" t="Sem encomenda" />
        </div>
      </div>
      {team.length === 0 ? (
        <div className="py-10 text-center text-muted-foreground text-sm">Ainda sem atividade hoje.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
          {team.map((m) => <MemberCard key={m.id} m={m} now={now} />)}
        </div>
      )}
    </div>
  );
}

function Legend({ c, t }: { c: string; t: string }) {
  return <span className="flex items-center gap-1"><span className={`size-2 rounded-full ${c}`} />{t}</span>;
}

function MemberCard({ m, now }: { m: TeamMember; now: Date }) {
  const st = STYLE[m.state];
  const liveSec = m.since ? (now.getTime() - m.since) / 1000 : null;
  const total = m.productive + m.pause + m.between;
  const eff = total > 0 ? Math.round((m.productive / total) * 100) : null;
  return (
    <div className={`rounded-xl border-2 p-4 ${st.box}`}>
      <div className="flex items-center gap-2">
        <div className="font-bold text-lg truncate flex-1">{m.name}</div>
        <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${st.chip}`}>
          {st.icon}{st.label}
        </span>
      </div>

      {m.state === "pausa" && (
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-sm font-medium">{m.pauseReason ?? "Pausa"}</span>
          {liveSec != null && <span className="text-2xl font-black tabular-nums text-amber-600">{fmtClock(liveSec)}</span>}
        </div>
      )}
      {m.state === "entre" && liveSec != null && (
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-sm font-medium">Desde a última etapa terminada</span>
          <span className="text-2xl font-black tabular-nums text-red-600">{fmtClock(liveSec)}</span>
        </div>
      )}

      {m.orders.length > 0 && (
        <div className="mt-2 space-y-1">
          {m.orders.map((o) => (
            <div key={o.id} className="flex items-center gap-2 text-sm">
              <span className={`size-2 rounded-full shrink-0 ${o.is_paused ? "bg-amber-500" : "bg-emerald-500 animate-pulse"}`} />
              <span className="font-mono font-bold">{o.order_number}</span>
              <span className="text-muted-foreground truncate">
                {STAGE_LABELS[o.stage] ?? o.stage}
                {o.coli_total && o.coli_total > 1 ? ` · vol. ${o.coli_number}/${o.coli_total}` : ""}
              </span>
              <span className="ml-auto tabular-nums font-semibold">{fmtClock(liveProd(o, now))}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 grid grid-cols-4 gap-1 text-center">
        <Stat v={formatMinutes(m.productive)} l="Produção" c="text-emerald-600" />
        <Stat v={formatMinutes(m.pause)} l="Pausas" c="text-amber-600" />
        <Stat v={formatMinutes(m.between)} l="Sem encom." c="text-red-600" />
        <Stat v={String(m.done)} l="Feitas" c="" />
      </div>
      {eff != null && (
        <div className="mt-2">
          <div className="h-2 rounded-full bg-muted overflow-hidden flex">
            <div className="bg-emerald-500" style={{ width: `${(m.productive / total) * 100}%` }} />
            <div className="bg-amber-500" style={{ width: `${(m.pause / total) * 100}%` }} />
            <div className="bg-red-500" style={{ width: `${(m.between / total) * 100}%` }} />
          </div>
          <div className="text-xs text-muted-foreground mt-1">{eff}% do tempo a produzir</div>
        </div>
      )}
    </div>
  );
}

function Stat({ v, l, c }: { v: string; l: string; c: string }) {
  return (
    <div className="rounded-lg bg-background/60 py-1.5">
      <div className={`text-base font-black tabular-nums ${c}`}>{v}</div>
      <div className="text-[10px] uppercase text-muted-foreground leading-tight">{l}</div>
    </div>
  );
}
