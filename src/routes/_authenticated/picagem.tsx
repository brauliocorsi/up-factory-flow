import { useState, useEffect, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Barcode, User, ArrowRight, CheckCircle2, Box, Send, ListCheck, Trash2, Volume2, VolumeX, Loader2, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  resolveOrderForPicking,
  scanPickingColi,
  sendPickingBatchToStock,
  listPickingQueue,
  listPendingDispatch,
  type PickingOrder,
} from "@/lib/picking.functions";
import { useMySession } from "@/hooks/useMySession";

export const Route = createFileRoute("/_authenticated/picagem")({
  component: PicagemPage,
});

function playSound(type: "success" | "error" | "complete") {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if (type === "success") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      osc.start(); osc.stop(ctx.currentTime + 0.1);
    } else if (type === "complete") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.08);
      osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.16);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      osc.start(); osc.stop(ctx.currentTime + 0.3);
    } else {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(150, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      osc.start(); osc.stop(ctx.currentTime + 0.25);
    }
  } catch {}
}

type LoadedOrder = {
  order: PickingOrder;
  pickedColis: Set<number>; // coli_number marked as picked
  completed: boolean;
};

function PicagemPage() {
  const { operator } = useMySession();
  const [operatorCode, setOperatorCode] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [loaded, setLoaded] = useState<Record<string, LoadedOrder>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Pre-select if user IS a picker linked to an operator
  useEffect(() => {
    if (!operatorCode && operator?.code) setOperatorCode(operator.code);
  }, [operator?.code]);

  useEffect(() => {
    inputRef.current?.focus();
    const keepFocus = () => {
      const tag = document.activeElement?.tagName;
      if (tag !== "SELECT" && tag !== "BUTTON" && tag !== "INPUT") inputRef.current?.focus();
    };
    document.addEventListener("click", keepFocus);
    return () => document.removeEventListener("click", keepFocus);
  }, []);

  const { data: operators = [], isLoading: loadingOps } = useQuery({
    queryKey: ["picking-operators"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("operators")
        .select("id, name, code, operator_stages!inner(stage)")
        .eq("active", true)
        .eq("operator_stages.stage", "picagem");
      if (error) throw error;
      return data ?? [];
    },
  });

  const queueFn = useServerFn(listPickingQueue);
  const { data: queue = [] } = useQuery({
    queryKey: ["picking-queue"],
    queryFn: () => queueFn(),
    refetchInterval: 15_000,
  });

  // Try resolving by order_number first (when operator scans the order barcode).
  // Otherwise treat as coli scan and dispatch to whichever loaded order matches.
  const resolveMutation = useMutation({
    mutationFn: (code: string) => resolveOrderForPicking({ data: { code } }),
    onSuccess: (order, code) => {
      const existing = loaded[order.id];
      if (existing && !existing.completed) {
        // Re-scanning the order label picks the next pending coli.
        scanMutation.mutate({ order_id: order.id, code });
        setBarcodeInput("");
        return;
      }
      if (soundEnabled) playSound("success");
      setLoaded((prev) => prev[order.id] ? prev : {
        ...prev,
        [order.id]: { order, pickedColis: new Set(), completed: false },
      });
      toast.success(`Encomenda ${order.order_number} carregada (${order.package_total} colis).`);
      setBarcodeInput("");
    },
    onError: (err: any) => {
      if (soundEnabled) playSound("error");
      toast.error(err.message || "Código desconhecido");
      setBarcodeInput("");
    },
  });


  const scanMutation = useMutation({
    mutationFn: async (vars: { order_id: string; code: string }) => {
      return scanPickingColi({
        data: { order_id: vars.order_id, code: vars.code, operator_code: operatorCode },
      });
    },
    onSuccess: (res, vars) => {
      if (soundEnabled) playSound(res.completed ? "complete" : "success");
      setLoaded((prev) => {
        const cur = prev[vars.order_id];
        if (!cur) return prev;
        const newSet = new Set(cur.pickedColis);
        newSet.add(res.coli_number);
        return {
          ...prev,
          [vars.order_id]: { ...cur, pickedColis: newSet, completed: res.completed },
        };
      });
      if (res.completed) {
        toast.success(`Encomenda EM ARMAZÉM (${res.done}/${res.total} colis lidos)`);
        queryClient.invalidateQueries({ queryKey: ["picking-queue"] });
      } else {
        toast.info(`Coli ${res.coli_number} lido (${res.done}/${res.total})`);
      }
      setBarcodeInput("");
    },
    onError: (err: any) => {
      if (soundEnabled) playSound("error");
      toast.error(err.message || "Coli inválido");
      setBarcodeInput("");
    },
  });

  const sendBatchMutation = useMutation({
    mutationFn: async () => {
      const completedIds = Object.values(loaded).filter((s) => s.completed).map((s) => s.order.id);
      if (completedIds.length === 0) throw new Error("Não há encomendas concluídas para enviar.");
      return sendPickingBatchToStock({ data: { operator_code: operatorCode, order_ids: completedIds } });
    },
    onSuccess: (res) => {
      if (res.success) {
        toast.success(res.message);
        setLoaded((prev) => {
          const next = { ...prev };
          Object.keys(next).forEach((id) => { if (next[id].completed) delete next[id]; });
          return next;
        });
      } else toast.error(res.message);
    },
    onError: (err: any) => toast.error(err.message || "Erro ao enviar lote."),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!operatorCode) { if (soundEnabled) playSound("error"); toast.error("Selecione primeiro o operador."); return; }
    const code = barcodeInput.trim();
    if (!code) return;

    const upper = code.toUpperCase();
    // First, try to match against any LOADED order's expected coli barcodes.
    for (const entry of Object.values(loaded)) {
      const match = entry.order.packages.find((p) => (p.expected_code ?? "").toUpperCase() === upper);
      if (match) {
        scanMutation.mutate({ order_id: entry.order.id, code });
        return;
      }
    }
    // Then, if the code is the ORDER label of an already loaded order, pick the next pending coli.
    for (const entry of Object.values(loaded)) {
      if (entry.completed) continue;
      if (entry.order.order_number.toUpperCase() === upper) {
        scanMutation.mutate({ order_id: entry.order.id, code });
        return;
      }
    }
    // Otherwise resolve as an order_number/barcode (load it).
    resolveMutation.mutate(code);

  };

  const removeOrder = (orderId: string) => {
    setLoaded((prev) => { const n = { ...prev }; delete n[orderId]; return n; });
  };

  const loadedList = Object.values(loaded);
  const completedCount = loadedList.filter((s) => s.completed).length;
  const isScanning = scanMutation.isPending || resolveMutation.isPending;

  return (
    <div className="container mx-auto p-4 max-w-7xl space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Picar — Posto de Picagem</h1>
          <p className="text-sm text-muted-foreground">Lê o código de cada coli. Quando todos os colis forem lidos, a encomenda fica EM ARMAZÉM.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setSoundEnabled(!soundEnabled)} className="gap-2">
          {soundEnabled ? <Volume2 className="size-4 text-green-500" /> : <VolumeX className="size-4 text-muted-foreground" />}
          Som: {soundEnabled ? "Ativo" : "Mudo"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 space-y-6">
          <Card className="border-2 border-primary/20">
            <CardHeader className="bg-primary/5">
              <CardTitle className="text-lg flex items-center gap-2"><User className="size-5 text-primary" /> Operador</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {loadingOps ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> A carregar...</div>
              ) : (
                <Select value={operatorCode} onValueChange={setOperatorCode}>
                  <SelectTrigger className="w-full h-12 text-base"><SelectValue placeholder="Selecione o picador..." /></SelectTrigger>
                  <SelectContent>
                    {operators.map((op) => (<SelectItem key={op.id} value={op.code}>{op.name} ({op.code})</SelectItem>))}
                  </SelectContent>
                </Select>
              )}
              {!operatorCode && <p className="text-xs text-amber-500 mt-2">* Necessário para começar.</p>}
            </CardContent>
          </Card>

          <Card className="border-2">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Barcode className="size-5 text-primary" /> Scan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="relative">
                  <Input
                    ref={inputRef}
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    placeholder="Lê código da encomenda ou de um coli..."
                    disabled={!operatorCode || isScanning}
                    className="h-16 text-xl tracking-widest pl-12 font-mono bg-accent/20"
                    autoComplete="off"
                  />
                  <Barcode className="absolute left-4 top-1/2 -translate-y-1/2 size-6 text-muted-foreground" />
                </div>
                <Button type="submit" disabled={!operatorCode || isScanning || !barcodeInput} className="w-full h-12 gap-2">
                  {isScanning ? <Loader2 className="size-5 animate-spin" /> : <ArrowRight className="size-5" />} Confirmar
                </Button>
              </form>
              <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-semibold text-foreground">Como funciona:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>1º scan = código da encomenda → carrega a lista de colis.</li>
                  <li>2º+ scans = código de cada coli, ou repete a etiqueta da encomenda para marcar o coli seguinte.</li>
                  <li>Quando todos os colis forem lidos, a encomenda passa a EM ARMAZÉM.</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2"><ListCheck className="size-4" /> Fila de picagem ({queue.length})</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1 max-h-[300px] overflow-y-auto">
              {queue.length === 0 ? (
                <p className="text-muted-foreground">Sem encomendas pendentes.</p>
              ) : queue.map((q) => (
                <div key={q.order_id} className="flex justify-between items-center py-1 border-b last:border-0">
                  <span className="font-mono">{q.order_number}</span>
                  <span className="text-xs text-muted-foreground">{q.coli_picked}/{q.coli_total}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-7 space-y-6">
          <Card className="min-h-[400px]">
            <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
              <CardTitle className="text-lg flex items-center gap-2"><Box className="size-5 text-primary" /> Em curso ({loadedList.length})</CardTitle>
              <Button disabled={completedCount === 0 || sendBatchMutation.isPending} onClick={() => sendBatchMutation.mutate()} className="gap-2 bg-green-600 hover:bg-green-700">
                {sendBatchMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Enviar lote ({completedCount})
              </Button>
            </CardHeader>
            <CardContent className="pt-6">
              {loadedList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground space-y-3">
                  <PackageCheck className="size-16 stroke-1 opacity-40" />
                  <p>Lê o código da encomenda para começar.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {loadedList.map(({ order, pickedColis, completed }) => {
                    const done = pickedColis.size;
                    const total = order.package_total;
                    return (
                      <div key={order.id} className={`border rounded-lg p-4 ${completed ? "bg-green-500/10 border-green-500/30" : ""}`}>
                        <div className="flex items-start justify-between gap-4 mb-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-lg">{order.order_number}</span>
                              {completed && <span className="inline-flex items-center gap-1 rounded bg-green-500/20 text-green-700 dark:text-green-300 text-xs px-2 py-0.5 font-medium"><CheckCircle2 className="size-3" /> EM ARMAZÉM</span>}
                            </div>
                            <p className="text-sm font-medium">{order.product_description}</p>
                            <p className="text-xs text-muted-foreground">{order.structure_type} | {order.measure} | {order.color}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-right">
                              <span className="text-2xl font-black block">{done}/{total}</span>
                              <span className="text-[10px] uppercase text-muted-foreground">Colis</span>
                            </div>
                            <Button variant="ghost" size="icon" onClick={() => removeOrder(order.id)} className="h-8 w-8 text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></Button>
                          </div>
                        </div>
                        <div className="w-full bg-accent h-2 rounded-full overflow-hidden mb-2">
                          <div className={`h-full transition-all duration-300 ${completed ? "bg-green-500" : "bg-primary"}`} style={{ width: `${(done / total) * 100}%` }} />
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {order.packages.map((pkg) => {
                            const isRead = pickedColis.has(pkg.package_number);
                            return (
                              <div key={pkg.package_number} className={`rounded p-2 text-xs border text-center ${isRead ? "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-300 font-semibold" : "bg-muted text-muted-foreground"}`}>
                                <div className="truncate">{pkg.package_name}</div>
                                <div className="text-[10px] font-mono opacity-80">Coli {pkg.package_number}/{pkg.package_total}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
