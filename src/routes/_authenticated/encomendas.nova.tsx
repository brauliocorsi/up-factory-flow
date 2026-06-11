import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { createOrder } from "@/lib/orders.functions";
import { getCatalogs } from "@/lib/catalog.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { ArrowLeft, Tag, AlertTriangle, ScanLine, ChevronDown, Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/encomendas/nova")({
  component: NovaEncomendaPage,
});

// Estrutura fixa do código: CAT(3) MODEL(3) STRUCT(2) MEAS(3) FT(2) FR(2) COR(2) ACAB(1) = 18
const SEGMENTS = [
  { key: "category", len: 3 },
  { key: "model", len: 3 },
  { key: "structure", len: 2 },
  { key: "measure", len: 3 },
  { key: "fabric_type", len: 2 },
  { key: "fabric_ref", len: 2 },
  { key: "color", len: 2 },
  { key: "finishing", len: 1 },
] as const;
const EXPECTED_LEN = SEGMENTS.reduce((a, s) => a + s.len, 0);

// Traduz mensagens de erro (Zod JSON cru, etc.) em PT amigável.
function friendlyError(msg?: string | null): string {
  if (!msg) return "Erro ao criar encomenda";
  const FIELD_PT: Record<string, string> = {
    order_number: "Nº de encomenda",
    product_description: "Descrição",
    measure: "Medida",
    fabric_type: "Tipo de tecido",
    fabric_ref: "Ref. tecido",
    color: "Cor",
    structure_type: "Estrutura",
    finishing: "Acabamento",
    due_date: "Data prevista",
    entry_date: "Data de entrada",
    priority: "Prioridade",
  };
  try {
    const arr = JSON.parse(msg);
    if (Array.isArray(arr) && arr.length) {
      return arr
        .map((i: any) => {
          const f = Array.isArray(i.path) && i.path.length ? FIELD_PT[i.path[0]] ?? i.path.join(".") : "Campo";
          if (i.code === "too_small") return `${f} obrigatório`;
          if (i.code === "too_big") return `${f} demasiado longo`;
          if (i.code === "invalid_type") return `${f} inválido`;
          return `${f}: ${i.message ?? "inválido"}`;
        })
        .join(" · ");
    }
  } catch {}
  if (msg.includes("já existe")) return msg;
  return msg;
}

function splitCode(raw: string) {
  const code = (raw || "").replace(/\s+/g, "").toUpperCase();
  const out: Record<string, string> = {};
  let i = 0;
  for (const seg of SEGMENTS) {
    out[seg.key] = code.slice(i, i + seg.len);
    i += seg.len;
  }
  return { code, segments: out };
}

function NovaEncomendaPage() {
  const navigate = useNavigate();
  const { data: cat } = useQuery({ queryKey: ["catalogs"], queryFn: () => getCatalogs() });
  const today = new Date().toISOString().slice(0, 10);
  const scanRef = useRef<HTMLInputElement>(null);
  const [scanValue, setScanValue] = useState("");
  const [missingSegments, setMissingSegments] = useState<Set<string>>(new Set());
  const [showDetails, setShowDetails] = useState(false);

  const [form, setForm] = useState({
    order_number: "",
    category_id: "",
    model_id: "",
    structure_id: "",
    measure_id: "",
    fabric_type_id: "",
    fabric_ref_id: "",
    color_id: "",
    finishing: "N" as "F" | "N",
    entry_date: today,
    due_date: "",
    priority: 0,
    observation: "",
    notes: "",
  });

  const modelsForCat = useMemo(
    () => (cat?.models ?? []).filter((m: any) => !form.category_id || m.category_id === form.category_id),
    [cat, form.category_id],
  );

  const sel = {
    category: cat?.categories.find((x: any) => x.id === form.category_id),
    model: cat?.models.find((x: any) => x.id === form.model_id),
    structure: cat?.structures.find((x: any) => x.id === form.structure_id),
    measure: cat?.measures.find((x: any) => x.id === form.measure_id),
    fabric_type: cat?.fabric_types.find((x: any) => x.id === form.fabric_type_id),
    fabric_ref: cat?.fabric_refs.find((x: any) => x.id === form.fabric_ref_id),
    color: cat?.colors.find((x: any) => x.id === form.color_id),
  } as Record<string, any>;

  const generatedCode = [
    sel.category?.code,
    sel.model?.code,
    sel.structure?.code,
    sel.measure?.code,
    sel.fabric_type?.code,
    sel.fabric_ref?.code,
    sel.color?.code,
    form.finishing || "",
  ].filter(Boolean).join("");

  const generatedDescription = [
    sel.category?.name,
    sel.model?.name,
    sel.structure?.name,
    sel.measure?.name,
    sel.fabric_ref?.name,
    sel.color?.name,
    form.finishing === "F" ? "Flutuante" : form.finishing === "N" ? "Normal" : "",
  ].filter(Boolean).join(" ");

  // Autofocus no scan ao abrir
  useEffect(() => { scanRef.current?.focus(); }, []);

  function decode(raw: string) {
    if (!cat) {
      toast.error("Catálogo ainda a carregar — tenta de novo num instante");
      return;
    }
    const { code, segments } = splitCode(raw);
    if (!code) return;
    if (code.length !== EXPECTED_LEN) {
      toast.warning(`Código com tamanho inesperado (${code.length} caracteres, esperados ${EXPECTED_LEN})`);
    }
    const missing = new Set<string>();
    const next = { ...form };

    const category = cat.categories.find((c: any) => c.code === segments.category);
    if (category) next.category_id = category.id; else if (segments.category) missing.add("category");

    const model = (cat.models ?? []).find(
      (m: any) => m.code === segments.model && (!category || m.category_id === category.id),
    );
    if (model) next.model_id = model.id; else if (segments.model) missing.add("model");

    const find = (list: any[], code: string) => list.find((x: any) => x.code === code);
    const structure = find(cat.structures, segments.structure);
    if (structure) next.structure_id = structure.id; else if (segments.structure) missing.add("structure");
    const measure = find(cat.measures, segments.measure);
    if (measure) next.measure_id = measure.id; else if (segments.measure) missing.add("measure");
    const ft = find(cat.fabric_types, segments.fabric_type);
    if (ft) next.fabric_type_id = ft.id; else if (segments.fabric_type) missing.add("fabric_type");
    const fr = find(cat.fabric_refs, segments.fabric_ref);
    if (fr) next.fabric_ref_id = fr.id; else if (segments.fabric_ref) missing.add("fabric_ref");
    const color = find(cat.colors, segments.color);
    if (color) next.color_id = color.id; else if (segments.color) missing.add("color");

    if (segments.finishing === "F" || segments.finishing === "N") {
      next.finishing = segments.finishing as "F" | "N";
    } else if (segments.finishing) {
      missing.add("finishing");
    }

    setForm(next);
    setMissingSegments(missing);

    if (missing.size > 0) {
      const labels: Record<string, string> = {
        category: `Categoria '${segments.category}'`,
        model: `Modelo '${segments.model}'`,
        structure: `Estrutura '${segments.structure}'`,
        measure: `Medida '${segments.measure}'`,
        fabric_type: `Tipo de Tecido '${segments.fabric_type}'`,
        fabric_ref: `Ref. Tecido '${segments.fabric_ref}'`,
        color: `Cor '${segments.color}'`,
        finishing: `Acabamento '${segments.finishing}'`,
      };
      const list = Array.from(missing).map((k) => labels[k]).join(", ");
      toast.warning(`Não encontrado no catálogo: ${list}`);
    } else {
      toast.success("Código descodificado");
    }
  }

  function onScanKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      decode(scanValue);
    }
  }
  function onScanChange(v: string) {
    setScanValue(v);
    const clean = v.replace(/\s+/g, "");
    if (clean.length === EXPECTED_LEN) decode(clean);
  }
  function onScanPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (text) {
      e.preventDefault();
      setScanValue(text);
      decode(text);
    }
  }

  function autoOrderNumber() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const stamp = `${(d.getMonth() + 1).toString().padStart(2, "0")}${d.getDate().toString().padStart(2, "0")}${d.getHours().toString().padStart(2, "0")}${d.getMinutes().toString().padStart(2, "0")}${d.getSeconds().toString().padStart(2, "0")}`;
    return `${yyyy}-${stamp}`;
  }

  const mut = useMutation({
    mutationFn: (input: any) => createOrder({ data: input }),
    onSuccess: (res: any) => {
      toast.success(`Encomenda ${res.order_number} criada`);
      // Reset estado para próxima leitura sequencial (fluxo de fábrica)
      setScanValue("");
      setMissingSegments(new Set());
      setForm((s) => ({
        ...s,
        order_number: "",
        observation: "",
        notes: "",
        due_date: "",
        priority: 0,
      }));
      setTimeout(() => scanRef.current?.focus(), 50);
    },
    onError: (e: any) => toast.error(friendlyError(e?.message)),
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!generatedDescription) {
      toast.error("Escolha pelo menos categoria/modelo para gerar a descrição");
      return;
    }
    const orderNumber = form.order_number.trim() || autoOrderNumber();
    mut.mutate({
      order_number: orderNumber,
      product_description: generatedDescription,
      model_id: form.model_id || null,
      measure: sel.measure?.name ?? null,
      fabric_type: sel.fabric_type?.name ?? null,
      fabric_ref: sel.fabric_ref?.name ?? null,
      color: sel.color?.name ?? null,
      structure_type: sel.structure?.name ?? null,
      finishing: form.finishing || null,
      barcode: generatedCode || null,
      observation: form.observation || null,
      notes: form.notes || null,
      entry_date: form.entry_date,
      due_date: form.due_date || null,
      priority: Number(form.priority) || 0,
    });
  }

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link to="/encomendas"><ArrowLeft className="size-4" /> Voltar</Link>
        </Button>
      </div>
      <div>
        <h1 className="text-2xl font-bold">Nova encomenda</h1>
        <p className="text-sm text-muted-foreground">Escolha os atributos — o código de produto é gerado automaticamente.</p>
      </div>

      <form onSubmit={submit}>
        <Card className="p-4 space-y-4">
          {/* Scan / código rápido */}
          <div className="rounded-md border-2 border-primary/30 bg-primary/5 p-3 space-y-2">
            <Label className="text-xs uppercase tracking-wider text-primary flex items-center gap-1.5">
              <ScanLine className="size-4" /> Ler código do produto
            </Label>
            <div className="flex gap-2">
              <Input
                ref={scanRef}
                value={scanValue}
                onChange={(e) => onScanChange(e.target.value)}
                onKeyDown={onScanKeyDown}
                onPaste={onScanPaste}
                placeholder={`Lê ou escreve o código (ex: CAM00101160010102N)`}
                className="h-12 font-mono text-base tracking-wider"
                autoFocus
              />
              <Button type="button" variant="secondary" className="h-12" onClick={() => decode(scanValue)}>
                Descodificar
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              Scanner: lê uma etiqueta — preenche tudo. Manual: escreve e carrega Enter.
            </div>
          </div>

          {/* Live generated code */}
          <div className="rounded-md border bg-primary/5 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Código gerado</div>
            <div className="font-mono text-lg font-bold text-primary break-all">
              {generatedCode || <span className="text-muted-foreground font-normal">…</span>}
            </div>
            <div className="text-xs mt-1">{generatedDescription || <span className="text-muted-foreground">Descrição aparece aqui</span>}</div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Categoria" highlight={missingSegments.has("category")}>
              <RefSelect items={cat?.categories ?? []} value={form.category_id} onChange={(v) => { set("category_id", v); set("model_id", ""); }} />
            </Field>
            <Field label="Modelo" highlight={missingSegments.has("model")}>
              <RefSelect items={modelsForCat} value={form.model_id} onChange={(v) => set("model_id", v)} />
            </Field>
            <Field label="Estrutura" highlight={missingSegments.has("structure")}>
              <RefSelect items={cat?.structures ?? []} value={form.structure_id} onChange={(v) => set("structure_id", v)} />
            </Field>
            <Field label="Medida" highlight={missingSegments.has("measure")}>
              <RefSelect items={cat?.measures ?? []} value={form.measure_id} onChange={(v) => set("measure_id", v)} />
            </Field>
            <Field label="Tipo de Tecido" highlight={missingSegments.has("fabric_type")}>
              <RefSelect items={cat?.fabric_types ?? []} value={form.fabric_type_id} onChange={(v) => set("fabric_type_id", v)} />
            </Field>
            <Field label="Ref. Tecido" highlight={missingSegments.has("fabric_ref")}>
              <RefSelect items={cat?.fabric_refs ?? []} value={form.fabric_ref_id} onChange={(v) => set("fabric_ref_id", v)} />
            </Field>
            <Field label="Cor" highlight={missingSegments.has("color")}>
              <RefSelect items={cat?.colors ?? []} value={form.color_id} onChange={(v) => set("color_id", v)} />
            </Field>
            <Field label="Acabamento" highlight={missingSegments.has("finishing")}>
              <Select value={form.finishing} onValueChange={(v) => set("finishing", v as "F" | "N")}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="N">N — Normal</SelectItem>
                  <SelectItem value="F">F — Flutuante</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Collapsible open={showDetails} onOpenChange={setShowDetails}>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="gap-1.5 w-full">
                <Plus className="size-3.5" />
                {showDetails ? "Ocultar detalhes" : "Adicionar mais detalhes"}
                <ChevronDown className={`size-3.5 ml-auto transition-transform ${showDetails ? "rotate-180" : ""}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Nº Encomenda (vazio = automático)">
                  <Input value={form.order_number} onChange={(e) => set("order_number", e.target.value)} className="h-11" placeholder="auto" />
                </Field>
                <Field label="Prioridade">
                  <Input type="number" min={0} max={10} value={form.priority} onChange={(e) => set("priority", Number(e.target.value))} className="h-11" />
                </Field>
                <Field label="Data entrada"><Input type="date" value={form.entry_date} onChange={(e) => set("entry_date", e.target.value)} className="h-11" /></Field>
                <Field label="Data saída prevista"><Input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} className="h-11" /></Field>
              </div>
              <Field label={<span className="flex items-center gap-1.5"><AlertTriangle className="size-3.5 text-warning" /> Observação (aparece na produção e etiqueta)</span>}>
                <Textarea value={form.observation} onChange={(e) => set("observation", e.target.value)} rows={2} placeholder="ex: Cabeceira maior" />
              </Field>
              <Field label="Notas">
                <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
              </Field>
            </CollapsibleContent>
          </Collapsible>

          <div className="flex justify-end gap-2 pt-2">
            <Button asChild variant="outline" type="button"><Link to="/encomendas">Cancelar</Link></Button>
            <Button type="submit" disabled={mut.isPending} className="gap-2">
              <Tag className="size-4" />
              {mut.isPending ? "A criar…" : "Criar encomenda"}
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}

function Field({ label, children, highlight }: { label: React.ReactNode; children: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`space-y-1.5 ${highlight ? "ring-2 ring-destructive/60 rounded-md p-2 -m-2 bg-destructive/5" : ""}`}>
      <Label className={`text-xs ${highlight ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
        {label}{highlight && " — não encontrado no catálogo"}
      </Label>
      {children}
    </div>
  );
}

function RefSelect({ items, value, onChange }: { items: Array<{ id: string; code: string; name: string }>; value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-11"><SelectValue placeholder="—" /></SelectTrigger>
      <SelectContent>
        {items.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">Sem opções</div>}
        {items.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            <span className="font-mono text-xs text-muted-foreground mr-2">{m.code}</span>{m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}