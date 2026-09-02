/**
 * Horário de trabalho da fábrica (hora local).
 * 08:00–10:00 · 10:15–12:00 · 13:30–16:00 · 16:15–17:30 = 450 min úteis.
 */

export type ShiftBlock = {
  idx: number;
  label: string;
  /** minutos desde a meia-noite */
  start: number;
  end: number;
};

export const SHIFT_BLOCKS: ShiftBlock[] = [
  { idx: 0, label: "08:00–10:00", start: 8 * 60, end: 10 * 60 },
  { idx: 1, label: "10:15–12:00", start: 10 * 60 + 15, end: 12 * 60 },
  { idx: 2, label: "13:30–16:00", start: 13 * 60 + 30, end: 16 * 60 },
  { idx: 3, label: "16:15–17:30", start: 16 * 60 + 15, end: 17 * 60 + 30 },
];

export const SHIFT_TOTAL_MINUTES = SHIFT_BLOCKS.reduce((a, b) => a + (b.end - b.start), 0);

export function minutesOfDay(d: Date = new Date()): number {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

export function isWorkday(d: Date = new Date()): boolean {
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

/** Minutos úteis já decorridos hoje (ignora pausas). */
export function elapsedUsefulMinutes(d: Date = new Date()): number {
  const now = minutesOfDay(d);
  let total = 0;
  for (const b of SHIFT_BLOCKS) {
    if (now >= b.end) total += b.end - b.start;
    else if (now > b.start) total += now - b.start;
  }
  return Math.round(total);
}

export type ShiftPhase =
  | { kind: "antes"; nextStart: number }
  | { kind: "trabalho"; block: ShiftBlock; remaining: number }
  | { kind: "pausa"; nextStart: number; remaining: number }
  | { kind: "fim" }
  | { kind: "sem_turno" };

export function currentPhase(d: Date = new Date()): ShiftPhase {
  if (!isWorkday(d)) return { kind: "sem_turno" };
  const now = minutesOfDay(d);
  const first = SHIFT_BLOCKS[0]!;
  const last = SHIFT_BLOCKS[SHIFT_BLOCKS.length - 1]!;
  if (now < first.start) return { kind: "antes", nextStart: first.start };
  if (now >= last.end) return { kind: "fim" };
  for (const b of SHIFT_BLOCKS) {
    if (now >= b.start && now < b.end) {
      return { kind: "trabalho", block: b, remaining: Math.ceil(b.end - now) };
    }
  }
  const next = SHIFT_BLOCKS.find((b) => b.start > now);
  return { kind: "pausa", nextStart: next?.start ?? last.end, remaining: Math.ceil((next?.start ?? last.end) - now) };
}

export function formatClock(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

export type IndexTone = "verde" | "ambar" | "vermelho" | "neutro";

export function toneFor(pct: number | null): IndexTone {
  if (pct == null) return "neutro";
  if (pct >= 90) return "verde";
  if (pct >= 75) return "ambar";
  return "vermelho";
}

export const TONE_CLASSES: Record<IndexTone, { text: string; bg: string; ring: string; label: string }> = {
  verde: { text: "text-emerald-500", bg: "bg-emerald-500", ring: "ring-emerald-500/40", label: "A cumprir" },
  ambar: { text: "text-amber-500", bg: "bg-amber-500", ring: "ring-amber-500/40", label: "Em risco" },
  vermelho: { text: "text-red-500", bg: "bg-red-500", ring: "ring-red-500/40", label: "Não cumpre" },
  neutro: { text: "text-muted-foreground", bg: "bg-muted", ring: "ring-border", label: "Sem dados" },
};
