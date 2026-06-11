import { useState, useEffect, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Barcode, User, ArrowRight, CheckCircle2, Box, Send, ListCheck, Trash2, Volume2, VolumeX, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { resolveOrderForPicking, finalizePickingStage, sendPickingBatchToStock, type PickingOrder } from "@/lib/picking.functions";

export const Route = createFileRoute("/_authenticated/picagem")({
  component: PicagemPage,
});

// Sound helpers
function playSound(type: "success" | "error" | "complete") {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "success") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } else if (type === "complete") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.08); // E5
      osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.16); // G5
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } else {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(150, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    }
  } catch (e) {
    console.error("Audio error", e);
  }
}

// Active local scans state interface
interface ScannedOrderState {
  order: PickingOrder;
  scannedCount: number; // sequence count
}

function PicagemPage() {
  const [operatorCode, setOperatorCode] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [scannedOrders, setScannedOrders] = useState<Record<string, ScannedOrderState>>({});
  
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Focus scanner input on load and keep it focused
  useEffect(() => {
    inputRef.current?.focus();
    const keepFocus = () => {
      // Only steal focus if user is not in a selector/dropdown
      if (document.activeElement?.tagName !== "SELECT" && document.activeElement?.tagName !== "BUTTON") {
        inputRef.current?.focus();
      }
    };
    document.addEventListener("click", keepFocus);
    return () => document.removeEventListener("click", keepFocus);
  }, []);

  // Fetch active operators assigned to 'picagem' stage
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
    }
  });

  // Resolve scanned barcode
  const { mutate: scanBarcode, isPending: isScanning } = useMutation({
    mutationFn: (code: string) => resolveOrderForPicking({ data: { code } }),
    onSuccess: (order) => {
      if (soundEnabled) playSound("success");
      
      setScannedOrders(prev => {
        const existing = prev[order.id];
        const nextCount = existing ? Math.min(order.package_total, existing.scannedCount + 1) : 1;
        
        const updated = {
          ...prev,
          [order.id]: {
            order,
            scannedCount: nextCount
          }
        };

        // If order complete (all packages read) -> auto-finalize backend stage
        if (nextCount === order.package_total && (!existing || existing.scannedCount < order.package_total)) {
          if (soundEnabled) {
            setTimeout(() => playSound("complete"), 150);
          }
          toast.success(`Encomenda ${order.order_number} TOTALMENTE PICADA! (${nextCount}/${order.package_total})`);
          
          if (operatorCode) {
            finalizeOrderMutation.mutate({
              orderId: order.id,
              stageId: order.stage_id,
              operatorCode
            });
          } else {
            toast.warning(`Atribua um operador para validar formalmente o encerramento da etapa.`);
          }
        } else {
          toast.info(`Lido coli ${nextCount}/${order.package_total} para ${order.order_number}`);
        }

        return updated;
      });
      setBarcodeInput("");
    },
    onError: (err: any) => {
      if (soundEnabled) playSound("error");
      toast.error(err.message || "Erro ao ler código.");
      setBarcodeInput("");
    }
  });

  // Complete picking step in database
  const finalizeOrderMutation = useMutation({
    mutationFn: async (vars: { orderId: string; stageId: string; operatorCode: string }) => {
      return finalizePickingStage({
        data: {
          stage_id: vars.stageId,
          operator_code: vars.operatorCode
        }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["production-orders"] });
    },
    onError: (err: any) => {
      toast.error(`Falha ao fechar etapa no backend: ${err.message}`);
    }
  });

  // Send completed batch to external system
  const sendBatchMutation = useMutation({
    mutationFn: async () => {
      const completedIds = Object.values(scannedOrders)
        .filter(s => s.scannedCount >= s.order.package_total)
        .map(s => s.order.id);

      if (completedIds.length === 0) {
        throw new Error("Não há nenhuma encomenda concluída para enviar.");
      }

      return sendPickingBatchToStock({
        data: {
          operator_code: operatorCode,
          order_ids: completedIds
        }
      });
    },
    onSuccess: (res) => {
      if (res.success) {
        toast.success(res.message);
        // Clear only successfully sent/completed orders from the screen
        setScannedOrders(prev => {
          const next = { ...prev };
          Object.keys(next).forEach(id => {
            if (next[id].scannedCount >= next[id].order.package_total) {
              delete next[id];
            }
          });
          return next;
        });
      } else {
        toast.error(res.message);
      }
    },
    onError: (err: any) => {
      toast.error(err.message || "Erro ao enviar lote.");
    }
  });

  const handleBarcodeInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!operatorCode) {
      if (soundEnabled) playSound("error");
      toast.error("Por favor, selecione primeiro um Operador.");
      return;
    }
    const clean = barcodeInput.trim();
    if (!clean) return;
    scanBarcode(clean);
  };

  const removeOrder = (orderId: string) => {
    setScannedOrders(prev => {
      const next = { ...prev };
      delete next[orderId];
      return next;
    });
    toast.info("Encomenda removida da lista de trabalho local.");
  };

  const activeOrdersList = Object.values(scannedOrders);
  const completedCount = activeOrdersList.filter(s => s.scannedCount >= s.order.package_total).length;

  return (
    <div className="container mx-auto p-4 max-w-7xl space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Posto de Picagem</h1>
          <p className="text-sm text-muted-foreground">Ecrã otimizado para scanner de pistola. Registo e envio de stock.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="gap-2"
          >
            {soundEnabled ? <Volume2 className="size-4 text-green-500" /> : <VolumeX className="size-4 text-muted-foreground" />}
            Som: {soundEnabled ? "Ativo" : "Mudo"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column - Scanner and Operator */}
        <div className="lg:col-span-5 space-y-6">
          <Card className="border-2 border-primary/20">
            <CardHeader className="bg-primary/5">
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="size-5 text-primary" />
                Operador Responsável
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {loadingOps ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  A carregar operadores...
                </div>
              ) : (
                <Select value={operatorCode} onValueChange={setOperatorCode}>
                  <SelectTrigger className="w-full h-12 text-base">
                    <SelectValue placeholder="Selecione o operador de Picagem..." />
                  </SelectTrigger>
                  <SelectContent>
                    {operators.map((op) => (
                      <SelectItem key={op.id} value={op.code}>
                        {op.name} ({op.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {!operatorCode && (
                <p className="text-xs text-amber-500 mt-2">
                  * É necessário selecionar o operador para começar a picar.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-2">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Barcode className="size-5 text-primary" />
                Leitor Código de Barras
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={handleBarcodeInputSubmit} className="space-y-4">
                <div className="relative">
                  <Input
                    ref={inputRef}
                    type="text"
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    placeholder="Passe o scanner aqui..."
                    disabled={!operatorCode || isScanning}
                    className="h-16 text-xl tracking-widest pl-12 font-mono bg-accent/20 border-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-transparent"
                    autoComplete="off"
                  />
                  <Barcode className="absolute left-4 top-1/2 -translate-y-1/2 size-6 text-muted-foreground" />
                </div>
                <Button 
                  type="submit" 
                  disabled={!operatorCode || isScanning || !barcodeInput}
                  className="w-full h-12 text-base gap-2"
                >
                  {isScanning ? <Loader2 className="size-5 animate-spin" /> : <ArrowRight className="size-5" />}
                  Confirmar Leitura Manual
                </Button>
              </form>

              <div className="rounded-lg bg-muted p-4 text-xs space-y-2 text-muted-foreground">
                <p className="font-semibold text-foreground">Dicas úteis:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>O foco mantém-se no campo de texto para leituras seguidas.</li>
                  <li>O código da etiqueta é o número da encomenda.</li>
                  <li>A leitura repetida avança automaticamente os colis (Ex: 1/2 → 2/2).</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Work Batch / Scanned list */}
        <div className="lg:col-span-7 space-y-6">
          <Card className="min-h-[400px]">
            <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Box className="size-5 text-primary" />
                  Lista de Picagem ({activeOrdersList.length} encomendas)
                </CardTitle>
              </div>
              <Button
                disabled={completedCount === 0 || sendBatchMutation.isPending}
                onClick={() => sendBatchMutation.mutate()}
                className="gap-2 bg-green-600 hover:bg-green-700"
              >
                {sendBatchMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                Enviar Lote ({completedCount} completas)
              </Button>
            </CardHeader>
            <CardContent className="pt-6">
              {activeOrdersList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground space-y-4">
                  <ListCheck className="size-16 stroke-1 text-muted-foreground/40" />
                  <div className="text-center space-y-1">
                    <p className="font-semibold text-foreground">Sem leituras de momento</p>
                    <p className="text-sm">Selecione o operador e use o scanner na etiqueta para começar.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {activeOrdersList.map(({ order, scannedCount }) => {
                    const isComplete = scannedCount >= order.package_total;
                    return (
                      <div 
                        key={order.id} 
                        className={`border rounded-lg p-4 transition-colors ${
                          isComplete ? "bg-green-500/10 border-green-500/30" : "bg-card border-border"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4 mb-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-lg">{order.order_number}</span>
                              {isComplete && (
                                <span className="inline-flex items-center gap-1 rounded bg-green-500/20 text-green-700 dark:text-green-300 text-xs px-2 py-0.5 font-medium">
                                  <CheckCircle2 className="size-3" />
                                  Completo
                                </span>
                              )}
                            </div>
                            <p className="text-sm font-medium text-foreground">{order.product_description}</p>
                            <p className="text-xs text-muted-foreground">
                              {order.structure_type} | {order.measure} | {order.color}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-right">
                              <span className="text-2xl font-black block tracking-tight">
                                {scannedCount}/{order.package_total}
                              </span>
                              <span className="text-[10px] text-muted-foreground uppercase font-bold block">Colis Lidos</span>
                            </div>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              onClick={() => removeOrder(order.id)}
                              className="text-muted-foreground hover:text-destructive h-8 w-8"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </div>

                        {/* Progress bar and colis details */}
                        <div className="space-y-2">
                          <div className="w-full bg-accent h-2 rounded-full overflow-hidden">
                            <div 
                              className={`h-full transition-all duration-300 ${isComplete ? "bg-green-500" : "bg-primary"}`}
                              style={{ width: `${(scannedCount / order.package_total) * 100}%` }}
                            />
                          </div>
                          
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                            {order.packages.map((pkg) => {
                              const isRead = pkg.package_number <= scannedCount;
                              return (
                                <div 
                                  key={pkg.package_number}
                                  className={`rounded p-2 text-xs border text-center transition-all ${
                                    isRead 
                                      ? "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-300 font-semibold" 
                                      : "bg-muted border-border text-muted-foreground"
                                  }`}
                                >
                                  <div className="font-medium truncate">{pkg.package_name}</div>
                                  <div className="text-[10px] font-mono opacity-80">
                                    Coli {pkg.package_number}/{pkg.package_total}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
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