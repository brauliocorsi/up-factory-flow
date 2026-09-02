import { TONE_CLASSES, toneFor } from "@/lib/shift";

export function PerformanceGauge({ pct, done, expected }: { pct: number | null; done: number; expected: number }) {
  const tone = toneFor(pct);
  const t = TONE_CLASSES[tone];
  const clamped = Math.min(150, Math.max(0, pct ?? 0));
  const angle = (clamped / 150) * 180;

  return (
    <div className="rounded-2xl border bg-card p-6 flex flex-col items-center">
      <div className="text-sm uppercase tracking-widest text-muted-foreground">Ritmo de produção</div>
      <div className="relative mt-4 w-full max-w-md">
        <svg viewBox="0 0 200 110" className="w-full">
          <path d="M10 100 A90 90 0 0 1 190 100" fill="none" stroke="currentColor" className="text-muted" strokeWidth="14" strokeLinecap="round" />
          <path
            d="M10 100 A90 90 0 0 1 190 100"
            fill="none"
            strokeWidth="14"
            strokeLinecap="round"
            className={t.text}
            stroke="currentColor"
            strokeDasharray={`${(angle / 180) * 283} 283`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
          <div className={`text-6xl md:text-7xl font-black leading-none ${t.text}`}>
            {pct == null ? "—" : `${pct}%`}
          </div>
          <div className={`mt-2 rounded-full px-4 py-1 text-sm font-bold text-white ${t.bg}`}>{t.label}</div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-6 text-center w-full max-w-md">
        <div>
          <div className="text-3xl font-bold">{done}</div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">min produzidos</div>
        </div>
        <div>
          <div className="text-3xl font-bold">{expected}</div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">min esperados</div>
        </div>
      </div>
    </div>
  );
}
