import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import { getOrderForLabel } from "@/lib/orders.functions";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer } from "lucide-react";

export const Route = createFileRoute("/_authenticated/encomendas/$id/etiqueta")({
  component: EtiquetaPage,
});

function EtiquetaPage() {
  const { id } = Route.useParams();
  const { data: order } = useQuery({
    queryKey: ["order-label", id],
    queryFn: () => getOrderForLabel({ data: { id } }),
  });
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!order?.barcode || !svgRef.current) return;
    try {
      JsBarcode(svgRef.current, order.barcode, {
        format: "CODE128",
        width: 2,
        height: 70,
        displayValue: true,
        fontSize: 14,
        margin: 4,
      });
    } catch (e) {
      console.error(e);
    }
  }, [order?.barcode]);

  if (!order) return <div className="p-6 text-sm text-muted-foreground">A carregar…</div>;

  return (
    <div className="p-4 space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between print:hidden">
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link to="/encomendas"><ArrowLeft className="size-4" /> Voltar</Link>
        </Button>
        <Button onClick={() => window.print()} className="gap-2">
          <Printer className="size-4" /> Imprimir
        </Button>
      </div>

      <div className="bg-white text-black border-2 border-black p-5 print:border-black print:shadow-none" id="label">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] tracking-widest font-bold">UP MÓVEIS</div>
            <div className="text-xs text-gray-500">Ordem de produção</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-gray-500">Nº Encomenda</div>
            <div className="font-mono text-lg font-bold">{order.order_number}</div>
          </div>
        </div>

        <div className="my-3 border-t border-dashed border-gray-400" />

        <div className="text-base font-semibold leading-tight">{order.product_description}</div>
        <dl className="grid grid-cols-2 gap-y-1 mt-2 text-xs">
          <Row label="Modelo" value={(order as any).models?.name} />
          <Row label="Medida" value={order.measure} />
          <Row label="Tecido" value={order.fabric_type} />
          <Row label="Ref. tecido" value={order.fabric_ref} />
          <Row label="Cor" value={order.color} />
        </dl>

        <div className="mt-4 grid place-items-center">
          <svg ref={svgRef} />
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #label, #label * { visibility: visible; }
          #label { position: absolute; inset: 0; margin: 8mm; }
        }
      `}</style>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium">{value || "—"}</dd>
    </>
  );
}