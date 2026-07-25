import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";
import { listRef } from "@/lib/catalog.functions";
import { STAGE_LABELS, STAGES_ORDER } from "@/lib/format";

export type DashboardFilterState = {
  q: string;
  modelId: string;
  fabric: string;
  measure: string;
  stage: string;
};

export const emptyFilters: DashboardFilterState = { q: "", modelId: "all", fabric: "all", measure: "all", stage: "all" };

export function DashboardFilters({ value, onChange }: { value: DashboardFilterState; onChange: (v: DashboardFilterState) => void }) {
  const { data: models = [] } = useQuery({ queryKey: ["ref", "models"], queryFn: () => listRef({ data: { kind: "models" } }) });
  const { data: fabrics = [] } = useQuery({ queryKey: ["ref", "fabric_types"], queryFn: () => listRef({ data: { kind: "fabric_types" } }) });
  const { data: measures = [] } = useQuery({ queryKey: ["ref", "measures"], queryFn: () => listRef({ data: { kind: "measures" } }) });

  const set = <K extends keyof DashboardFilterState>(k: K, v: DashboardFilterState[K]) => onChange({ ...value, [k]: v });
  const hasFilters =
    value.q.trim() !== "" || value.modelId !== "all" || value.fabric !== "all" || value.measure !== "all" || value.stage !== "all";

  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mt-3">
      <div className="relative col-span-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Nº encomenda ou produto…"
          value={value.q}
          onChange={(e) => set("q", e.target.value)}
          className="pl-9 h-10"
        />
      </div>
      <Select value={value.modelId} onValueChange={(v) => set("modelId", v)}>
        <SelectTrigger className="h-10"><SelectValue placeholder="Modelo" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos os modelos</SelectItem>
          {models.filter((m) => m.active).map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={value.fabric} onValueChange={(v) => set("fabric", v)}>
        <SelectTrigger className="h-10"><SelectValue placeholder="Tecido" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos os tecidos</SelectItem>
          {fabrics.filter((f) => f.active).map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={value.measure} onValueChange={(v) => set("measure", v)}>
        <SelectTrigger className="h-10"><SelectValue placeholder="Medida" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas as medidas</SelectItem>
          {measures.filter((m) => m.active).map((m) => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <div className="flex gap-2">
        <Select value={value.stage} onValueChange={(v) => set("stage", v)}>
          <SelectTrigger className="h-10"><SelectValue placeholder="Etapa" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as etapas</SelectItem>
            {STAGES_ORDER.map((s) => <SelectItem key={s} value={s}>{STAGE_LABELS[s] ?? s}</SelectItem>)}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={() => onChange(emptyFilters)} aria-label="Limpar filtros">
            <X className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function applyDashboardFilters<T extends {
  order_number: string;
  product_description: string;
  customer_order: string | null;
  model_id: string | null;
  fabric_type: string | null;
  measure: string | null;
  current_stage: string;
}>(byStage: Record<string, T[]>, filters: DashboardFilterState): Record<string, T[]> {
  const q = filters.q.trim().toLowerCase();
  const out: Record<string, T[]> = {};
  for (const stage of Object.keys(byStage)) {
    if (filters.stage !== "all" && stage !== filters.stage) { out[stage] = []; continue; }
    out[stage] = byStage[stage].filter((o) => {
      if (q) {
        const hay = `${o.order_number} ${o.customer_order ?? ""} ${o.product_description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filters.modelId !== "all" && o.model_id !== filters.modelId) return false;
      if (filters.fabric !== "all" && (o.fabric_type ?? "") !== filters.fabric) return false;
      if (filters.measure !== "all" && (o.measure ?? "") !== filters.measure) return false;
      return true;
    });
  }
  return out;
}