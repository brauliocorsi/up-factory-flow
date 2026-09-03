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
import { Scissors } from "lucide-react";
import { consumeFabric, getFabricConsumeContext, undoFabricConsumption } from "@/lib/stock.functions";

type Ref = { id: string; code: string; name: string; fabric_type_id?: string | null };
type Roll = {
  id: string;
  name: string;
  fabric_ref_code: string | null;
  color_code: string | null;
  meters: number;
};

/**
 * Consumo manual de metros de tecido na etapa de Corte.
 * Filtra por tipo de tecido → referência → cor, e usa os metros do modelo.
 */
export function ConsumeFabricDialog({
  orderId,
  orderNumber,
  operatorCode,
  canUndo = false,
}: {
  orderId: string;
  orderNumber: string;
  operatorCode?: string;
  canUndo?: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typeId, setTypeId] = useState<string>("");
  const [refCode, setRefCode] = useState<string>("");
  const [colorCode, setColorCode] = useState<string>("");
  const [meters, setMeters] = useState<string>("");

  const ctxQuery = useQuery({
    queryKey: ["fabric-consume-ctx", orderId],
    queryFn: () => getFabricConsumeContext({ data: { order_id: orderId } }),
    enabled: open,
  });
  const ctx = ctxQuery.data as any;

  useEffect(() => {
    if (!ctx?.ok) return;
    setRefCode((prev) => prev || (ctx.order?.fabric_ref ?? ""));
    setColorCode((prev) => prev || (ctx.order?.color ?? ""));
    setMeters((prev) => prev || (ctx.meters_per_unit != null ? String(ctx.meters_per_unit) : ""));
  }, [ctx]);

  const refs: Ref[] = ctx?.fabric_refs ?? [];
  const colors: Ref[] = ctx?.colors ?? [];
  const types: Ref[] = ctx?.fabric_types ?? [];
  const rolls: Roll[] = ctx?.rolls ?? [];
  const consumption = ctx?.consumption ?? null;

  const filteredRefs = useMemo(
    () => (typeId ? refs.filter((r) => r.fabric_type_id === typeId) : refs),
    [refs, typeId],
  );

  const matchingRolls = useMemo(
    () =>
      rolls.filter(
        (r) =>
          (!refCode || r.fabric_ref_code === refCode) &&
          (!colorCode || r.color_code === colorCode || r.color_code == null),
      ),
    [rolls, refCode, colorCode],
  );

  const needed = Number(meters || 0);
  const roll = useMemo(() => {
    const withEnough = matchingRolls
      .filter((r) => Number(r.meters) >= needed && needed > 0)
      .sort((a, b) => Number(a.meters) - Number(b.meters));
    return withEnough[0] ?? matchingRolls.sort((a, b) => Number(b.meters) - Number(a.meters))[0] ?? null;
  }, [matchingRolls, needed]);

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

  const insufficient = Boolean(roll && needed > 0 && Number(roll.meters) < needed);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" variant="outline" className="gap-2 h-12 flex-1 sm:flex-none">
          <Scissors className="size-4" /> Consumir tecido
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
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
              <div className="space-y-1.5 col-span-2">
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
            </div>

            <div className="rounded-md border p-3 text-sm space-y-1">
              {roll ? (
                <>
                  <div className="font-medium">{roll.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {roll.fabric_ref_code ?? "—"} / {roll.color_code ?? "—"} · disponível{" "}
                    {Number(roll.meters).toFixed(1)} m
                  </div>
                  {insufficient && (
                    <div className="text-xs text-destructive">Metros insuficientes neste rolo.</div>
                  )}
                </>
              ) : (
                <div className="text-xs text-muted-foreground">
                  Sem rolo em stock para esta referência/cor.
                </div>
              )}
            </div>
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
