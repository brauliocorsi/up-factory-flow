import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Printer, Info, AlertTriangle } from "lucide-react";
import { getLabelsForOrders, type LabelRow } from "@/lib/packages.functions";
import { ProductionLabel, LabelPrintStyles } from "@/components/labels/ProductionLabel";

const searchSchema = z.object({
  ids: z.string().optional(), // comma-separated uuids
});

export const Route = createFileRoute("/_authenticated/etiquetas/imprimir")({
  validateSearch: (s: Record<string, unknown>) => searchSchema.parse(s),
  component: ImprimirPage,
});

function ImprimirPage() {
  const { ids } = useSearch({ from: "/_authenticated/etiquetas/imprimir" });
  const idList = (ids ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const [copies, setCopies] = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ["labels", idList.join(",")],
    queryFn: () => getLabelsForOrders({ data: { ids: idList } }),
    enabled: idList.length > 0,
  });

  const rows: LabelRow[] = data ?? [];
  const missing = rows.filter((r) => r.packages.length === 0).map((r) => r.order.order_number);

  const totalLabels = rows.reduce(
    (acc, r) => acc + Math.max(r.packages.length, 1) * copies,
    0,
  );

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap no-print">
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link to="/encomendas"><ArrowLeft className="size-4" /> Voltar</Link>
        </Button>
        <div className="flex items-end gap-3">
          <div>
            <Label htmlFor="copies" className="text-xs">Cópias por coli</Label>
            <Input
              id="copies"
              type="number"
              min={1}
              max={20}
              value={copies}
              onChange={(e) => setCopies(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              className="h-10 w-24"
            />
          </div>
          <Button onClick={() => window.print()} className="gap-2 h-10">
            <Printer className="size-4" /> Imprimir {totalLabels} etiqueta{totalLabels === 1 ? "" : "s"}
          </Button>
        </div>
      </div>

      <Alert className="no-print">
        <Info className="size-4" />
        <AlertDescription className="text-xs space-y-1">
          <div className="font-semibold">Como imprimir na Brother QL-700 / QL-800W:</div>
          <ol className="list-decimal pl-4 space-y-0.5">
            <li>Confirma que a Brother QL está instalada no computador (driver Brother).</li>
            <li>Carrega rolo de etiquetas <strong>62×29mm (DK-11209)</strong> ou compatível.</li>
            <li>No diálogo de impressão, escolhe a Brother QL e define tamanho <strong>62×29mm</strong>.</li>
            <li>Desativa margens e cabeçalhos/rodapés para a etiqueta sair centrada.</li>
          </ol>
        </AlertDescription>
      </Alert>

      {idList.length === 0 && (
        <Card className="p-6 text-sm text-muted-foreground text-center no-print">
          Nenhuma encomenda selecionada.
        </Card>
      )}
      {isLoading && <div className="text-sm text-muted-foreground no-print">A preparar etiquetas…</div>}
      {error && (
        <Alert variant="destructive" className="no-print">
          <AlertTriangle className="size-4" />
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      )}

      {missing.length > 0 && (
        <Alert variant="destructive" className="no-print">
          <AlertTriangle className="size-4" />
          <AlertDescription className="text-xs">
            Sem colis definidos para: <strong>{missing.join(", ")}</strong>. Vão imprimir 1 etiqueta genérica.
            Define em <Link to="/admin/colis" className="underline">Gestão de Colis</Link>.
          </AlertDescription>
        </Alert>
      )}

      <LabelPrintStyles />

      <div className="print-area flex flex-wrap gap-0">
        {rows.map((row) =>
          renderLabelsForOrder(row, copies),
        )}
      </div>
    </div>
  );
}

function renderLabelsForOrder(row: LabelRow, copies: number) {
  const { order, packages } = row;
  const list = packages.length ? packages : [null];
  const out: ReactElement[] = [];
  for (const pkg of list) {
    for (let c = 0; c < copies; c++) {
      const key = `${order.id}-${pkg?.id ?? "x"}-${c}`;
      out.push(
        <ProductionLabel
          key={key}
          orderNumber={order.order_number}
          barcodeValue={order.barcode || order.order_number}
          productDescription={order.product_description}
          modelName={order.model_name}
          measure={order.measure}
          fabricType={order.fabric_type}
          fabricRef={order.fabric_ref}
          color={order.color}
          packageNumber={pkg?.package_number ?? null}
          packageTotal={pkg?.package_total ?? null}
          packageName={pkg?.package_name ?? null}
        />,
      );
    }
  }
  return out;
}