import { cn } from "@/lib/utils";

/**
 * Célula de carga (Fase B):
 *  - Cor sempre baseada em firm/cap (verde ≤80, amarelo 80–100, vermelho >100).
 *  - Sombra tracejada por cima sinaliza backlog previsto (nunca dispara cor).
 *  - Contorno tracejado vermelho avisa "potencial sobrecarga se ativares".
 */
export function LoadCell({
  capacity,
  firm,
  shadow,
  itemsFirm,
  itemsShadow,
}: {
  capacity: number;
  firm: number;
  shadow: number;
  itemsFirm?: number;
  itemsShadow?: number;
}) {
  const cap = Math.max(0, capacity);
  const firmPct = cap > 0 ? (firm / cap) * 100 : firm > 0 ? 999 : 0;
  const shadowPct = cap > 0 ? (shadow / cap) * 100 : shadow > 0 ? 999 : 0;
  const total = firm + shadow;

  const firmColor =
    firmPct > 100 ? "bg-red-500"
    : firmPct >= 80 ? "bg-amber-500"
    : firmPct > 0 ? "bg-emerald-500"
    : "bg-muted-foreground/20";

  const potentialOverload = cap > 0 && total > cap && firmPct <= 100;

  return (
    <div className="space-y-1">
      <div
        className={cn(
          "relative h-3 rounded bg-muted overflow-hidden",
          potentialOverload && "ring-1 ring-red-400 [outline-style:dashed]",
        )}
        title={`Firme: ${firm}/${cap} min${shadow ? ` · Sombra: +${shadow} min` : ""}`}
      >
        {/* Firme sólido */}
        <div
          className={cn("absolute inset-y-0 left-0", firmColor)}
          style={{ width: `${Math.min(100, firmPct)}%` }}
        />
        {/* Sombra tracejada por cima da firme */}
        {shadow > 0 && (
          <div
            className="absolute inset-y-0 opacity-70"
            style={{
              left: `${Math.min(100, firmPct)}%`,
              width: `${Math.min(100 - Math.min(100, firmPct), shadowPct)}%`,
              backgroundImage:
                "repeating-linear-gradient(135deg, hsl(var(--foreground)/0.45) 0 4px, transparent 4px 8px)",
            }}
          />
        )}
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span className={cn(firmPct > 100 && "text-red-600 font-medium")}>
          {firm}/{cap}
        </span>
        {shadow > 0 && <span className="text-muted-foreground/70">+{shadow}</span>}
      </div>
      {(itemsFirm !== undefined || itemsShadow !== undefined) && (
        <div className="text-[10px] text-muted-foreground/80">
          {itemsFirm ?? 0} pç{itemsShadow ? ` (+${itemsShadow})` : ""}
        </div>
      )}
    </div>
  );
}