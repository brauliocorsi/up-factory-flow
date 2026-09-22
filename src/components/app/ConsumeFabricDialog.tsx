import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Scissors, Check, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { consumeFabric, getFabricConsumeContext, undoFabricConsumption } from "@/lib/stock.functions";

type Ref = { id: string; code: string; name: string; fabric_type_id?: string | null };
type Roll = {
  id: string;
  name: string;
  fabric_ref_code: string | null;
  color_code: string | null;
  meters: number;
  kind?: "match" | "same_ref" | "other";
};

/**
 * Consumo manual de metros de tecido na etapa de Corte.
 * O tecido da encomenda é identificado automaticamente e os rolos em stock
 * aparecem sugeridos por ordem de confiança.
 */
export function ConsumeFabricDialog({
  orderId,
  orderNumber,
  operatorCode,
  canUndo = false,
  compact = false,
}: {
  orderId: string;
  orderNumber: string;
  operatorCode?: string;
  canUndo?: boolean;
  /** Versão pequena do botão, para listas de grupos. */
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typeId, setTypeId] = useState<string>("");
  const [refCode, setRefCode] = useState<string>("");
  const [colorCode, setColorCode] = useState<string>("");
  const [meters, setMeters] = useState<string>("");
  const [rollId, setRollId] = useState<string>("");
  const [showAll, setShowAll] = useState(false);
  const [manual, setManual] = useState(false);

  const ctxQuery = useQuery({
    queryKey: ["fabric-consume-ctx", orderId],
    queryFn: () => getFabricConsumeContext({ data: { order_id: orderId } }),
    enabled: open,
  });
  const ctx = ctxQuery.data as any;

  useEffect(() => {
    if (!ctx?.ok) return;
    // A identificação do tecido vem já resolvida do servidor (ficha TEC ou texto
    // da encomenda), em códigos de catálogo.
    setRefCode((prev) => prev || (ctx.suggestion?.fabric_ref_code ?? ""));
    setColorCode((prev) => prev || (ctx.suggestion?.color_code ?? ""));
    setMeters((prev) => prev || (ctx.meters_per_unit != null ? String(ctx.meters_per_unit) : ""));
  }, [ctx]);

  const refs: Ref[] = ctx?.fabric_refs ?? [];
  const colors: Ref[] = ctx?.colors ?? [];
  const types: Ref[] = ctx?.fabric_types ?? [];
  const rolls: Roll[] = ctx?.rolls ?? [];
  const suggested: Roll[] = ctx?.suggested_rolls ?? [];
  const suggestion = ctx?.suggestion ?? null;
  const consumption = ctx?.consumption ?? null;

  const filteredRefs = useMemo(
    () => (typeId ? refs.filter((r) => r.fabric_type_id === typeId) : refs),
    [refs, typeId],
  );

  const needed = Number(meters || 0);

  // Em modo manual (ou sem sugestão) manda a escolha por coleção/cor.
  const manualRolls = useMemo(
    () =>
      rolls.filter(
        (r) =>
          (!refCode || r.fabric_ref_code === refCode) &&
          (!colorCode || r.color_code === colorCode || r.color_code == null),
      ),
    [rolls, refCode, colorCode],
  );

  const matchRolls = suggested.filter((r) => r.kind === "match");
  const sameRefRolls = suggested.filter((r) => r.kind === "same_ref");
  const otherRolls = suggested.filter((r) => r.kind === "other");
  const hasSuggestion = matchRolls.length > 0 || sameRefRolls.length > 0;

  const visibleRolls: Roll[] = manual
    ? manualRolls
    : showAll || !hasSuggestion
      ? suggested
      : [...matchRolls, ...sameRefRolls];

  // Pré-seleciona o primeiro rolo que corresponde e tem metros suficientes.
  useEffect(() => {
    if (!ctx?.ok || consumption) return;
    setRollId((prev) => {
      if (prev && visibleRolls.some((r) => r.id === prev)) return prev;
      const enough = visibleRolls.find((r) => needed > 0 && Number(r.meters) >= needed);
      return (enough ?? visibleRolls[0])?.id ?? "";
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, consumption, manual, showAll, refCode, colorCode, meters]);

  const roll = visibleRolls.find((r) => r.id === rollId) ?? null;
  const insufficient = Boolean(roll && needed > 0 && Number(roll.meters) < needed);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["fabric-consumptions"] });
    qc.invalidateQueries({ queryKey: ["fabric-consume-ctx", orderId] });
    qc.invalidateQueries({ queryKey: ["rolls"] });
    qc.invalidateQueries({ queryKey: ["stock-overview"] });
  };

  const consume = useMutation({
    mutationFn: () =>
      consumeFabric({
        data: {
          order_id: orderId,
          roll_id: roll!.id,
          meters: needed,
          ...(operatorCode ? { operator_code: operatorCode } : {}),
        },
      }),
    onSuccess: (res: any) => {
      if (!res?.ok) {
        toast.error(res?.message ?? "Não foi possível consumir o tecido.");
        refresh();
        return;
      }
      toast.success(`Consumidos ${needed.toFixed(1)} m de tecido`);
      setOpen(false);
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao consumir tecido"),
  });

  const undo = useMutation({
    mutationFn: () => undoFabricConsumption({ data: { order_id: orderId } }),
    onSuccess: (res: any) => {
      if (!res?.ok) {
        toast.error(res?.message ?? "Não foi possível anular.");
        return;
      }
      toast.success("Consumo anulado — metros devolvidos ao rolo");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao anular consumo"),
  });

  const RollRow = ({ r }: { r: Roll }) => {
    const low = needed > 0 && Number(r.meters) < needed;
    const selected = r.id === rollId;
    return (
      <button
        type="button"
        onClick={() => !low && setRollId(r.id)}
        disabled={low}
        className={cn(
          "w-full text-left rounded-md border p-2.5 transition-colors",
          selected ? "border-primary bg-primary/5" : "hover:bg-muted/50",
          low && "opacity-60 cursor-not-allowed",
        )}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm flex-1">{r.name}</span>
          {selected && <Check className="size-4 text-primary shrink-0" />}
        </div>
        <div className="text-xs text-muted-foreground font-mono">
          {r.fabric_ref_code ?? "—"} / {r.color_code ?? "—"} · disponível {Number(r.meters).toFixed(1)} m
        </div>
        {low && <div className="text-xs text-destructive">Metros insuficientes.</div>}
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {compact ? (
          <Button size="sm" variant="outline" className="gap-1 shrink-0">
            <Scissors className="size-3.5" /> Tecido
          </Button>
        ) : (
          <Button size="lg" variant="outline" className="gap-2 h-12 flex-1 sm:flex-none">
            <Scissors className="size-4" /> Consumir tecido
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Consumir tecido — {orderNumber}</DialogTitle>
        </DialogHeader>

        {ctxQuery.isLoading && <div className="text-sm text-muted-foreground py-6">A carregar…</div>}

        {ctx && ctx.ok === false && (
          <div className="text-sm text-destructive py-4">{ctx.message}</div>
        )}

        {ctx?.ok && consumption && (
          <div className="space-y-3 py-2">
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              Tecido já consumido:{" "}
              <span className="font-semibold">{Number(consumption.meters).toFixed(1)} m</span>{" "}
              <Badge variant="secondary" className="ml-1 font-mono text-xs">
                {consumption.fabric_ref_code ?? "—"} / {consumption.color_code ?? "—"}
              </Badge>
            </div>
            {canUndo && (
              <Button
                variant="destructive"
                disabled={undo.isPending}
                onClick={() => {
                  if (confirm("Anular o consumo e devolver os metros ao rolo?")) undo.mutate();
                }}
              >
                Anular consumo
              </Button>
            )}
          </div>
        )}

        {ctx?.ok && !consumption && (
          <div className="space-y-3">
            {/* Tecido identificado na encomenda */}
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              {suggestion?.fabric_ref_code ? (
                <>
                  <div className="font-medium">
                    Tecido da encomenda: {suggestion.fabric_ref_name}
                    {suggestion.color_name ? ` · ${suggestion.color_name}` : ""}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {suggestion.source === "ref_tec"
                      ? "Identificado pela ficha de tecido da encomenda."
                      : "Identificado pela descrição da encomenda."}
                    {!suggestion.color_name && " Cor não registada — confirme no rolo."}
                  </div>
                </>
              ) : (
                <div className="text-xs text-muted-foreground">
                  Não foi possível identificar o tecido desta encomenda — escolha manualmente.
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Metros a consumir (do modelo)</Label>
              <Input
                type="number"
                min={0}
                step="0.1"
                value={meters}
                onChange={(e) => setMeters(e.target.value)}
                className="h-11"
              />
              {ctx.meters_per_unit == null && (
                <p className="text-xs text-destructive">
                  O modelo {ctx.model?.code ?? ""} não tem metros por unidade definidos (Catálogo &gt; Modelos).
                </p>
              )}
            </div>

            {!manual ? (
              <div className="space-y-2">
                {matchRolls.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground">
                      Corresponde ao tecido da encomenda
                    </div>
                    {matchRolls.map((r) => (
                      <RollRow key={r.id} r={r} />
                    ))}
                  </div>
                )}
                {sameRefRolls.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <AlertTriangle className="size-3.5" /> Mesma coleção, cor diferente
                    </div>
                    {sameRefRolls.map((r) => (
                      <RollRow key={r.id} r={r} />
                    ))}
                  </div>
                )}
                {!hasSuggestion && (
                  <div className="space-y-1.5">
                    <div className="text-xs text-destructive">
                      Não há rolos em stock desta coleção — todos os rolos disponíveis:
                    </div>
                    {otherRolls.length === 0 ? (
                      <div className="text-xs text-muted-foreground">Sem rolos em stock.</div>
                    ) : (
                      otherRolls.map((r) => <RollRow key={r.id} r={r} />)
                    )}
                  </div>
                )}
                {hasSuggestion && showAll && otherRolls.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground">Outros rolos</div>
                    {otherRolls.map((r) => (
                      <RollRow key={r.id} r={r} />
                    ))}
                  </div>
                )}
                <div className="flex gap-3 pt-1">
                  {hasSuggestion && otherRolls.length > 0 && (
                    <button
                      type="button"
                      className="text-xs underline text-muted-foreground"
                      onClick={() => setShowAll((v) => !v)}
                    >
                      {showAll ? "Ver só os sugeridos" : "Ver todos os rolos"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-xs underline text-muted-foreground"
                    onClick={() => setManual(true)}
                  >
                    Escolher por coleção e cor
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs">Tipo de tecido (filtro)</Label>
                    <Select
                      value={typeId || "__all__"}
                      onValueChange={(v) => {
                        setTypeId(v === "__all__" ? "" : v);
                        setRefCode("");
                      }}
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="— todos —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">— todos —</SelectItem>
                        {types.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.code} · {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Referência</Label>
                    <Select value={refCode || undefined} onValueChange={setRefCode}>
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {filteredRefs.map((r) => (
                          <SelectItem key={r.id} value={r.code}>
                            <span className="font-mono text-xs mr-2">{r.code}</span>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Cor</Label>
                    <Select value={colorCode || undefined} onValueChange={setColorCode}>
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {colors.map((c) => (
                          <SelectItem key={c.id} value={c.code}>
                            <span className="font-mono text-xs mr-2">{c.code}</span>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {manualRolls.length === 0 ? (
                    <div className="text-xs text-muted-foreground">
                      Sem rolo em stock para esta referência/cor.
                    </div>
                  ) : (
                    manualRolls.map((r) => <RollRow key={r.id} r={r} />)
                  )}
                </div>
                <button
                  type="button"
                  className="text-xs underline text-muted-foreground"
                  onClick={() => setManual(false)}
                >
                  Voltar às sugestões
                </button>
              </div>
            )}
          </div>
        )}

        {ctx?.ok && !consumption && (
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!roll || needed <= 0 || insufficient || consume.isPending}
              onClick={() => consume.mutate()}
            >
              Consumir {needed > 0 ? `${needed.toFixed(1)} m` : ""}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
