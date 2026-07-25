import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
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
  structure: string;
  stage: string;
};

export const emptyFilters: DashboardFilterState = { q: "", modelId: "all", fabric: "all", measure: "all", structure: "all", stage: "all" };

export function DashboardFilters({ value, onChange }: { value: DashboardFilterState; onChange: (v: DashboardFilterState) => void }) {
export function DashboardFilters({
  value,
  onChange,
  structureCounts,
}: {
  value: DashboardFilterState;
  onChange: (v: DashboardFilterState) => void;
  structureCounts?: Record<string, number>;
}) {
  const { data: models = [] } = useQuery({ queryKey: ["ref", "models"], queryFn: () => listRef({ data: { kind: "models" } }) });
  const { data: fabrics = [] } = useQuery({ queryKey: ["ref", "fabric_types"], queryFn: () => listRef({ data: { kind: "fabric_types" } }) });
  const { data: measures = [] } = useQuery({ queryKey: ["ref", "measures"], queryFn: () => listRef({ data: { kind: "measures" } }) });
  const { data: structures = [] } = useQuery({ queryKey: ["ref", "structures"], queryFn: () => listRef({ data: { kind: "structures" } }) });

  const set = <K extends keyof DashboardFilterState>(k: K, v: DashboardFilterState[K]) => onChange({ ...value, [k]: v });
  const hasFilters =
    value.q.trim() !== "" || value.modelId !== "all" || value.fabric !== "all" || value.measure !== "all" || value.structure !== "all" || value.stage !== "all";

  // If a model is selected, restrict structures to the ones linked to that model.
  const filteredStructures = useMemo(() => {
    if (value.modelId === "all") return structures.filter((s) => s.active);
    return structures.filter((s) => s.active && (s.model_ids ?? []).includes(value.modelId));
  }, [structures, value.modelId]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-7 gap-2 mt-3">
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
      <Select value={value.structure} onValueChange={(v) => set("structure", v)}>
        <SelectTrigger className="h-10"><SelectValue placeholder="Estrutura" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas as estruturas</SelectItem>
          {filteredStructures.map((s) => <SelectItem key={s.id} value={s.id}>{s.code} · {s.name}</SelectItem>)}
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

export type FabricMatchContext = {
  /** allowed fabric_type names AND fabric_ref names for the selected type id */
  allowedNames: Set<string> | null;
};

export function useFabricMatchContext(filters: DashboardFilterState): FabricMatchContext {
  const { data: fabrics = [] } = useQuery({ queryKey: ["ref", "fabric_types"], queryFn: () => listRef({ data: { kind: "fabric_types" } }) });
  const { data: refs = [] } = useQuery({ queryKey: ["ref", "fabric_refs"], queryFn: () => listRef({ data: { kind: "fabric_refs" } }) });
  return useMemo(() => {
    if (filters.fabric === "all") return { allowedNames: null };
    const type = fabrics.find((f) => f.id === filters.fabric);
    const allowed = new Set<string>();
    if (type) allowed.add(type.name);
    for (const r of refs) {
      if ((r as any).fabric_type_id === filters.fabric) allowed.add(r.name);
    }
    return { allowedNames: allowed };
  }, [filters.fabric, fabrics, refs]);
}

export type StructureMatchContext = {
  /** allowed structure code + name tokens for the selected structure id */
  allowedTokens: string[] | null;
};

export function useStructureMatchContext(filters: DashboardFilterState): StructureMatchContext {
  const { data: structures = [] } = useQuery({ queryKey: ["ref", "structures"], queryFn: () => listRef({ data: { kind: "structures" } }) });
  return useMemo(() => {
    if (filters.structure === "all") return { allowedTokens: null };
    const s = structures.find((x) => x.id === filters.structure);
    if (!s) return { allowedTokens: [] };
    const tokens = [s.code, s.name].filter(Boolean) as string[];
    return { allowedTokens: tokens };
  }, [filters.structure, structures]);
}

export function applyDashboardFilters<T extends {
  order_number: string;
  product_description: string;
  customer_order: string | null;
  model_id: string | null;
  fabric_type: string | null;
  fabric_ref?: string | null;
  measure: string | null;
  structure_type?: string | null;
  current_stage: string;
}>(byStage: Record<string, T[]>, filters: DashboardFilterState, fabricCtx?: FabricMatchContext, structureCtx?: StructureMatchContext): Record<string, T[]> {
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
      if (filters.fabric !== "all") {
        const allowed = fabricCtx?.allowedNames;
        if (!allowed) return false;
        const ft = o.fabric_type ?? "";
        const fr = o.fabric_ref ?? "";
        if (allowed.has(ft) || allowed.has(fr)) {
          // ok
        } else {
          // Fallback: some legacy/imported orders keep the fabric info only in product_description.
          const desc = (o.product_description ?? "").toLowerCase();
          const hit = Array.from(allowed).some((n) => n && desc.includes(n.toLowerCase()));
          if (!hit) return false;
        }
      }
      if (filters.measure !== "all") {
        const m = filters.measure;
        if ((o.measure ?? "") !== m) {
          const desc = (o.product_description ?? "").toLowerCase();
          if (!desc.includes(m.toLowerCase())) return false;
        }
      }
      if (filters.structure !== "all") {
        const tokens = structureCtx?.allowedTokens;
        if (!tokens || tokens.length === 0) return false;
        const st = (o.structure_type ?? "").toLowerCase();
        const desc = (o.product_description ?? "").toLowerCase();
        const hit = tokens.some((t) => {
          const lt = t.toLowerCase();
          return (st && st === lt) || (st && st.includes(lt)) || desc.includes(lt);
        });
        if (!hit) return false;
      }
      return true;
    });
  }
  return out;
}