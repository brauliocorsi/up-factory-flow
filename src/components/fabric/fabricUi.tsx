import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, AlertTriangle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FabricAvailability } from "@/lib/stock.functions";

export type FabricStatus = FabricAvailability["status"];

export const STATUS_LABEL: Record<FabricStatus, string> = {
  DISPONIVEL: "Disponível",
  POUCO: "Pouco stock",
  "SEM STOCK": "Sem stock",
};

export function StatusDot({ status, className }: { status: FabricStatus | null | undefined; className?: string }) {
  return (
    <span
      title={status ? STATUS_LABEL[status] : undefined}
      className={cn(
        "inline-block size-2.5 rounded-full shrink-0",
        status === "DISPONIVEL" && "bg-success",
        status === "POUCO" && "bg-warning",
        status === "SEM STOCK" && "bg-destructive",
        !status && "bg-muted-foreground/40",
        className,
      )}
    />
  );
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function isSubsequence(t: string, w: string) {
  let i = 0;
  for (const ch of w) if (ch === t[i]) i++;
  return i === t.length;
}

/** Pesquisa tolerante: procura em name, supplier_ref e supplier_number —
 * "bass bege" encontra "Aveludado Bass Beige", "02" ou "célia 02" encontram "Microfibra Célia 02 Beige". */
export function matchFabric(
  f: { name: string; supplier_ref?: string | null; supplier_number?: string | null },
  query: string,
) {
  const q = norm(query).trim();
  if (!q) return true;
  const words = norm(f.name).split(/[\s\-/]+/).filter(Boolean);
  const full = norm(f.name);
  const supplier = norm(f.supplier_ref ?? "");
  const number = norm(f.supplier_number ?? "");
  return q.split(/\s+/).every(
    (t) =>
      full.includes(t) ||
      words.some((w) => w[0] === t[0] && isSubsequence(t, w)) ||
      (number && (number === t || number.includes(t))) ||
      (supplier && supplier.includes(t)),
  );
}

/** Aviso de stock para mostrar junto a um tecido escolhido. */
export function FabricStockNotice({ fabric }: { fabric: FabricAvailability | null | undefined }) {
  if (!fabric || fabric.status === "DISPONIVEL") return null;
  const out = fabric.status === "SEM STOCK";
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border p-2 text-xs",
        out ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-warning bg-warning/10",
      )}
    >
      <AlertTriangle className="size-4 shrink-0 mt-0.5" />
      <span>
        {out
          ? "Sem stock deste tecido. A encomenda pode ser registada e produzida mais tarde."
          : `Pouco stock: ${fabric.meters.toFixed(1)} m (mínimo ${fabric.min_meters.toFixed(1)} m).`}
      </span>
    </div>
  );
}

/** Seletor único de tecido com pesquisa, metros e sinal de cor. */
export function FabricPicker({
  fabrics,
  value,
  onChange,
  placeholder = "Escolher tecido…",
  disabled,
}: {
  fabrics: FabricAvailability[];
  value: string;
  onChange: (refTec: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = fabrics.find((f) => f.ref_tec === value) ?? null;
  const list = useMemo(() => fabrics.filter((f) => matchFabric(f, q)).slice(0, 200), [fabrics, q]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="h-11 w-full justify-between font-normal"
        >
          {selected ? (
            <span className="flex items-center gap-2 min-w-0">
              <StatusDot status={selected.status} />
              <span className="truncate">{selected.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">{selected.meters.toFixed(1)} m</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="size-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-2 w-[--radix-popover-trigger-width] min-w-80" align="start">
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Pesquisar (ex: célia 02, bass bege)"
          className="h-10 mb-2"
        />
        <div className="max-h-72 overflow-y-auto space-y-0.5">
          {list.length === 0 && <div className="text-xs text-muted-foreground p-2">Nenhum tecido encontrado.</div>}
          {list.map((f) => (
            <button
              key={f.ref_tec}
              type="button"
              onClick={() => {
                onChange(f.ref_tec);
                setOpen(false);
                setQ("");
              }}
              className={cn(
                "w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
                f.ref_tec === value && "bg-muted",
              )}
            >
              {f.ref_tec === value ? <Check className="size-3.5 shrink-0" /> : <span className="w-3.5" />}
              <span className="flex-1 truncate">{f.name}</span>
              {f.needs_review && <AlertTriangle className="size-3 text-warning shrink-0" />}
              <span className="text-xs text-muted-foreground tabular-nums">{f.meters.toFixed(1)} m</span>
              <StatusDot status={f.status} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
