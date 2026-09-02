import { SHIFT_BLOCKS, TONE_CLASSES, toneFor, minutesOfDay } from "@/lib/shift";

export function ShiftBlocksChart({
  blocks,
  operators,
  now,
}: {
  blocks: Array<{ block: number; minutes: number }>;
  operators: number;
  now: Date;
}) {
  const byIdx = new Map(blocks.map((b) => [b.block, b.minutes]));
  const nowMin = minutesOfDay(now);
  const ops = Math.max(1, operators);
  const max = Math.max(
    60,
    ...SHIFT_BLOCKS.map((b) => Math.max(byIdx.get(b.idx) ?? 0, (b.end - b.start) * ops))
  );

  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="text-sm uppercase tracking-widest text-muted-foreground mb-4">Blocos do turno</div>
      <div className="grid grid-cols-4 gap-3 items-end h-40">
        {SHIFT_BLOCKS.map((b) => {
          const done = byIdx.get(b.idx) ?? 0;
          const elapsedInBlock = Math.min(b.end, Math.max(b.start, nowMin)) - b.start;
          const target = elapsedInBlock * ops;
          const pct = target > 0 ? Math.round((done / target) * 100) : null;
          const tone = nowMin <= b.start ? "neutro" : toneFor(pct);
          const t = TONE_CLASSES[tone];
          return (
            <div key={b.idx} className="flex flex-col justify-end h-full">
              <div className="text-center text-sm font-bold tabular-nums">{done}m</div>
              <div
                className={`mt-1 w-full rounded-t-md ${t.bg} transition-all`}
                style={{ height: `${Math.max(4, (done / max) * 100)}%` }}
              />
              <div className="mt-2 text-center text-[11px] text-muted-foreground">{b.label}</div>
              <div className={`text-center text-[11px] font-semibold ${t.text}`}>{pct == null ? "—" : `${pct}%`}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
