import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { createOrder } from "@/lib/orders.functions";
import { getCatalogs } from "@/lib/catalog.functions";
import {
  buildBedCode,
  buildSofaCode,
  buildSommierCode,
  bedProductName,
  sofaProductName,
  sommierProductName,
  fabricLabel,
  isCustomMeasure,
  SOFA_VARIANTS,
  BED_VARIANTS,
  ODF_LABEL,
  type BedVariant,
  type SofaVariant,
} from "@/lib/productCodes";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { ArrowLeft, Tag, AlertTriangle, ScanLine, ChevronDown, Plus, Lock, Info, Wrench } from "lucide-react";

export const Route = createFileRoute("/_authenticated/encomendas/nova")({
  component: NovaEncomendaPage,
});

const SERVICE_TYPES = [
  { value: "assistencia", label: "Assistência" },
  { value: "reparacao", label: "Reparação" },
  { value: "servico", label: "Serviço" },
  { value: "peca", label: "Peça" },
  { value: "porte", label: "Porte" },
  { value: "outro", label: "Outro" },
] as const;

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
  return msg;
}

function autoOrderNumber() {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function NovaEncomendaPage() {
  const navigate = useNavigate();
  const { data: cat } = useQuery({ queryKey: ["catalogs"], queryFn: () => getCatalogs() });
  const today = new Date().toISOString().slice(0, 10);
  const scanRef = useRef<HTMLInputElement>(null);
  const [scanValue, setScanValue] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [mode, setMode] = useState<"catalogo" | "livre">("catalogo");

  const [form, setForm] = useState({
    order_number: "",
    quantity: 1,
    category_id: "",
    model_id: "",
    measure_id: "",
    ref_tec: "",
    collection_code: "",
    width_cm: "",
    elevatorio: false,
    fundos: false,
    bed_variant: "N" as BedVariant,
    sofa_variant: "N" as SofaVariant,
    customization: "",
    entry_date: today,
    due_date: "",
    priority: 0,
    observation: "",
    notes: "",
  });

  const [free, setFree] = useState({
    order_number: "",
    quantity: 1,
    description: "",
    service_type: "assistencia" as (typeof SERVICE_TYPES)[number]["value"],
    entry_date: today,
    due_date: "",
    observation: "",
    notes: "",
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  const category = cat?.categories.find((c: any) => c.id === form.category_id);
  const categoryCode = (category?.code ?? "").toUpperCase();
  const isSofa = categoryCode === "SOF";
  const isSommier = categoryCode === "SOM";

  const modelsForCat = useMemo(
    () => (cat?.models ?? []).filter((m: any) => !form.category_id || m.category_id === form.category_id),
    [cat, form.category_id],
  );
  const model = (cat?.models ?? []).find((m: any) => m.id === form.model_id);

  // A estrutura e a família nunca são escolhidas: vêm sempre do modelo.
  const structure = (cat?.structures ?? []).find((s: any) => s.code === model?.structure_code);
  const sofaFamily = (cat?.sofa_families ?? []).find((f: any) => f.code === model?.sofa_family_code);

  const measure = (cat?.measures ?? []).find((m: any) => m.id === form.measure_id);

  // Tecidos: coleção → tipo (bloqueado) → referência do fornecedor.
  const collections = cat?.fabric_refs ?? [];
  const collection = collections.find((c: any) => c.code === form.collection_code);
  const fabricType = (cat?.fabric_types ?? []).find(
    (t: any) => t.code === (collection?.fabric_type_code ?? ""),
  );
  const fabricsForCollection = useMemo(
    () => (cat?.fabrics ?? []).filter((f: any) => f.fabric_ref_code === form.collection_code),
    [cat, form.collection_code],
  );
  const fabric = (cat?.fabrics ?? []).find((f: any) => f.ref_tec === form.ref_tec);
  const fabricColor = (cat?.colors ?? []).find((c: any) => c.code === fabric?.color_code);

  useEffect(() => {
    if (!form.ref_tec) return;
    if (!fabricsForCollection.some((f: any) => f.ref_tec === form.ref_tec)) set("ref_tec", "");
  }, [fabricsForCollection, form.ref_tec]);

  useEffect(() => {
    if (form.model_id && !modelsForCat.some((m: any) => m.id === form.model_id)) set("model_id", "");
  }, [modelsForCat, form.model_id]);

  const fabLabel = fabric
    ? fabricLabel({
        supplierRef: fabric.supplier_ref,
        collectionName: collection?.name ?? null,
        colorName: fabricColor?.name ?? null,
      })
    : "";

  const generatedCode = isSofa
    ? buildSofaCode({
        modelCode: model?.code,
        familyCode: model?.sofa_family_code,
        widthCm: form.width_cm,
        refTec: form.ref_tec,
        variant: form.sofa_variant,
      })
    : isSommier
      ? buildSommierCode({
          modelCode: model?.code,
          elevatorio: form.elevatorio,
          fundos: form.fundos,
          measureCode: measure?.code,
          refTec: form.ref_tec,
        })
      : buildBedCode({
          modelCode: model?.code,
          structureCode: model?.structure_code,
          measureCode: measure?.code,
          refTec: form.ref_tec,
          variant: form.bed_variant,
        });

  const generatedName = isSofa
    ? sofaProductName({
        modelName: model?.name,
        familyCode: model?.sofa_family_code,
        familyName: sofaFamily?.name,
        variant: form.sofa_variant,
        widthCm: form.width_cm,
        fabricLabel: fabLabel,
      })
    : isSommier
      ? sommierProductName({
          modelName: model?.name,
          elevatorio: form.elevatorio,
          fundos: form.fundos,
          measureName: measure?.name,
          fabricLabel: fabLabel,
        })
      : bedProductName({
          modelName: model?.name,
          structureName: structure?.name,
          variant: form.bed_variant,
          measureName: measure?.name,
          fabricLabel: fabLabel,
        });

  useEffect(() => { scanRef.current?.focus(); }, []);

  /** Descodifica um código gerado (CAM/SOF/SOM) de volta para os campos. */
  function decode(raw: string, silent = false) {
    if (!cat) return;
    const code = (raw || "").replace(/\s+/g, "").toUpperCase();
    if (code.length < 15) {
      if (!silent) toast.warning("Código incompleto");
      return;
    }
    const prefix = code.slice(0, 3);
    const catRow = cat.categories.find((c: any) => c.code === prefix);
    if (!catRow) {
      if (!silent) toast.error(`Categoria "${prefix}" não existe no catálogo`);
      return;
    }
    const next = { ...form, category_id: catRow.id };
    const modelCode = code.slice(3, 6);
    const m = (cat.models ?? []).find((x: any) => x.code === modelCode && x.category_id === catRow.id);
    if (m) next.model_id = m.id;
    if (prefix === "SOF") {
      next.width_cm = String(Number(code.slice(8, 11)));
      const tec = code.slice(11, 17);
      next.ref_tec = tec ? `TEC${tec}` : "";
      const v = code.slice(17, 18) as SofaVariant;
      if (["N", "E", "D", "R"].includes(v)) next.sofa_variant = v;
    } else if (prefix === "SOM") {
      next.elevatorio = code.slice(6, 7) === "1";
      next.fundos = code.slice(7, 8) === "1";
      const meas = (cat.measures ?? []).find((x: any) => x.code === code.slice(8, 11));
      if (meas) next.measure_id = meas.id;
      const tec = code.slice(11, 17);
      next.ref_tec = tec ? `TEC${tec}` : "";
    } else {
      const meas = (cat.measures ?? []).find((x: any) => x.code === code.slice(8, 11));
      if (meas) next.measure_id = meas.id;
      const tec = code.slice(11, 17);
      next.ref_tec = tec ? `TEC${tec}` : "";
      const v = code.slice(17, 18) as BedVariant;
      if (["N", "F"].includes(v)) next.bed_variant = v;
    }
    const fab = (cat.fabrics ?? []).find((f: any) => f.ref_tec === next.ref_tec);
    next.collection_code = fab?.fabric_ref_code ?? "";
    if (!fab) next.ref_tec = "";
    setForm(next);
    if (!silent) {
      if (m && fab) toast.success("Código descodificado");
      else toast.warning("Código lido, mas há campos por confirmar");
    }
  }

  const mut = useMutation({
    mutationFn: (input: any) => createOrder({ data: input }),
    onSuccess: (res: any) => {
      const n = Number(res?.created ?? 1);
      if (n > 1) {
        const nums: string[] = res?.order_numbers ?? [];
        toast.success(`${n} encomendas criadas: ${nums[0]} … ${nums[nums.length - 1]}`);
      } else {
        toast.success(`Encomenda ${res.order_number} criada`);
      }
      setScanValue("");
      setForm((s) => ({ ...s, order_number: "", quantity: 1, observation: "", notes: "", due_date: "", priority: 0, customization: "" }));
      setFree((s) => ({ ...s, order_number: "", quantity: 1, description: "", observation: "", notes: "", due_date: "" }));
      setTimeout(() => scanRef.current?.focus(), 50);
    },
    onError: (e: any) => toast.error(friendlyError(e?.message)),
  });

  function submitCatalog(e: React.FormEvent) {
    e.preventDefault();
    if (!model) {
      toast.error("Escolhe a categoria e o modelo");
      return;
    }
    if (!generatedCode) {
      toast.error("Faltam dados para gerar o código do produto (medida/largura e tecido)");
      return;
    }
    mut.mutate({
      order_number: form.order_number.trim() || autoOrderNumber(),
      product_description: generatedName,
      model_id: form.model_id || null,
      measure: isSofa ? (form.width_cm ? `${form.width_cm}cm` : null) : measure?.name ?? null,
      fabric_type: fabricType?.name ?? null,
      fabric_ref: collection?.name ?? null,
      color: fabricColor?.name ?? fabric?.supplier_ref ?? null,
      structure_type: isSofa ? sofaFamily?.name ?? null : structure?.name ?? null,
      finishing: isSofa || isSommier ? null : form.bed_variant,
      ref_tec: form.ref_tec || null,
      customization: form.customization.trim() || null,
      barcode: generatedCode,
      observation: form.observation || null,
      notes: form.notes || null,
      entry_date: form.entry_date,
      due_date: form.due_date || null,
      priority: Number(form.priority) || 0,
      quantity: Number(form.quantity) || 1,
      line_kind: "catalogo",
    });
  }

  function submitFree(e: React.FormEvent) {
    e.preventDefault();
    if (!free.description.trim()) {
      toast.error("Escreve a descrição da linha livre");
      return;
    }
    mut.mutate({
      order_number: free.order_number.trim() || autoOrderNumber(),
      product_description: free.description.trim(),
      line_kind: "livre",
      service_type: free.service_type,
      entry_date: free.entry_date,
      due_date: free.due_date || null,
      observation: free.observation || null,
      notes: free.notes || null,
      quantity: Number(free.quantity) || 1,
      priority: 0,
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
        <p className="text-sm text-muted-foreground">
          Escolhe o modelo — a estrutura e o código do produto são gerados automaticamente.
        </p>
      </div>

      <Tabs value={mode} onValueChange={(v) => setMode(v as "catalogo" | "livre")}>
        <TabsList className="w-full">
          <TabsTrigger value="catalogo" className="flex-1">Produto de catálogo</TabsTrigger>
          <TabsTrigger value="livre" className="flex-1 gap-1.5"><Wrench className="size-3.5" /> Linha livre</TabsTrigger>
        </TabsList>

        <TabsContent value="catalogo">
          <form onSubmit={submitCatalog}>
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
                    onChange={(e) => setScanValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); decode(scanValue); } }}
                    placeholder="Lê ou escreve o código (ex: CAM00101160010203N)"
                    className="h-12 font-mono text-base tracking-wider"
                    autoFocus
                  />
                  <Button type="button" variant="secondary" className="h-12" onClick={() => decode(scanValue)}>
                    Descodificar
                  </Button>
                </div>
              </div>

              {/* Código e nome gerados */}
              <div className="rounded-md border bg-primary/5 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Código gerado</div>
                <div className="font-mono text-lg font-bold text-primary break-all">
                  {generatedCode || <span className="text-muted-foreground font-normal">…</span>}
                </div>
                <div className="text-xs mt-1">
                  {generatedName || <span className="text-muted-foreground">Nome do produto aparece aqui</span>}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Nº Encomenda (vazio = automático)">
                  <Input value={form.order_number} onChange={(e) => set("order_number", e.target.value)} className="h-11" placeholder="auto" />
                </Field>
                <Field label="Quantidade (unidades)">
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    value={form.quantity}
                    onChange={(e) => set("quantity", Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
                    className="h-11"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Categoria">
                  <RefSelect
                    items={cat?.categories ?? []}
                    value={form.category_id}
                    onChange={(v) => { set("category_id", v); set("model_id", ""); }}
                  />
                </Field>
                <Field label="Modelo">
                  <RefSelect items={modelsForCat} value={form.model_id} onChange={(v) => set("model_id", v)} />
                </Field>

                <Field label={isSofa ? "Família do sofá (do modelo)" : "Estrutura (do modelo)"}>
                  <LockedValue
                    value={isSofa ? sofaFamily?.name : structure?.name}
                    empty={form.model_id ? "Modelo sem estrutura definida" : "Escolhe o modelo"}
                  />
                </Field>

                {isSofa ? (
                  <Field label="Largura real (cm)">
                    <Input
                      type="number"
                      min={60}
                      max={600}
                      value={form.width_cm}
                      onChange={(e) => set("width_cm", e.target.value)}
                      className="h-11"
                      placeholder="ex: 230"
                    />
                  </Field>
                ) : (
                  <Field label="Medida">
                    <RefSelect items={cat?.measures ?? []} value={form.measure_id} onChange={(v) => set("measure_id", v)} />
                  </Field>
                )}

                <Field label="Coleção de tecido">
                  <RefSelect
                    items={collections}
                    valueKey="code"
                    value={form.collection_code}
                    onChange={(v) => { set("collection_code", v); set("ref_tec", ""); }}
                  />
                </Field>
                <Field label="Tipo de tecido (da coleção)">
                  <LockedValue value={fabricType?.name} empty="Escolhe a coleção" />
                </Field>
                <Field label="Referência do tecido">
                  <Select value={form.ref_tec} onValueChange={(v) => set("ref_tec", v)}>
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder={form.collection_code ? "Escolher…" : "Escolhe a coleção primeiro"} />
                    </SelectTrigger>
                    <SelectContent>
                      {fabricsForCollection.map((f: any) => (
                        <SelectItem key={f.ref_tec} value={f.ref_tec}>
                          {f.supplier_ref} · {f.ref_tec}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                {isSofa ? (
                  <Field
                    label={
                      <span className="flex items-center gap-1.5">
                        Chaise
                        <Tooltip>
                          <TooltipTrigger asChild><Info className="size-3.5 text-muted-foreground" /></TooltipTrigger>
                          <TooltipContent>O lado é sempre {ODF_LABEL}.</TooltipContent>
                        </Tooltip>
                      </span>
                    }
                  >
                    <Select value={form.sofa_variant} onValueChange={(v) => set("sofa_variant", v as SofaVariant)}>
                      <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SOFA_VARIANTS.map((v) => (
                          <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : isSommier ? (
                  <Field label="Opções do sommier">
                    <div className="flex items-center gap-4 h-11">
                      <label className="flex items-center gap-2 text-sm">
                        <Switch checked={form.elevatorio} onCheckedChange={(v) => set("elevatorio", v)} /> Elevatório
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Switch checked={form.fundos} onCheckedChange={(v) => set("fundos", v)} /> c/ Fundos
                      </label>
                    </div>
                  </Field>
                ) : (
                  <Field label="Variante">
                    <Select value={form.bed_variant} onValueChange={(v) => set("bed_variant", v as BedVariant)}>
                      <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {BED_VARIANTS.map((v) => (
                          <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </div>

              {!isSofa && isCustomMeasure(measure?.code) && (
                <Badge variant="outline" className="border-warning text-warning">Medida sob-medida (gama 5xx)</Badge>
              )}

              <Field label="Personalizações (cabeceira, ilhargueiro, furos, …)">
                <Input
                  value={form.customization}
                  onChange={(e) => set("customization", e.target.value)}
                  className="h-11"
                  placeholder="ex: cab:300, ilhargueiro"
                />
              </Field>

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
        </TabsContent>

        <TabsContent value="livre">
          <form onSubmit={submitFree}>
            <Card className="p-4 space-y-4 border-dashed">
              <div className="rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
                Linha livre: assistências, reparações, portes, serviços, peças soltas ou produtos de terceiros.
                Não tem código de produto, modelo, tecido nem volumes — segue direto para embalagem e expedição.
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Nº Encomenda (vazio = automático)">
                  <Input value={free.order_number} onChange={(e) => setFree((s) => ({ ...s, order_number: e.target.value }))} className="h-11" placeholder="auto" />
                </Field>
                <Field label="Quantidade">
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    value={free.quantity}
                    onChange={(e) => setFree((s) => ({ ...s, quantity: Math.max(1, Math.min(200, Number(e.target.value) || 1)) }))}
                    className="h-11"
                  />
                </Field>
                <Field label="Tipo de linha (opcional)">
                  <Select value={free.service_type} onValueChange={(v) => setFree((s) => ({ ...s, service_type: v as any }))}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SERVICE_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Data saída prevista">
                  <Input type="date" value={free.due_date} onChange={(e) => setFree((s) => ({ ...s, due_date: e.target.value }))} className="h-11" />
                </Field>
              </div>
              <Field label="Descrição">
                <Textarea
                  value={free.description}
                  onChange={(e) => setFree((s) => ({ ...s, description: e.target.value }))}
                  rows={2}
                  placeholder="ex: Assistência — substituição de pés em cama Armani"
                />
              </Field>
              <Field label="Observações">
                <Textarea value={free.observation} onChange={(e) => setFree((s) => ({ ...s, observation: e.target.value }))} rows={2} />
              </Field>
              <div className="flex justify-end gap-2 pt-2">
                <Button asChild variant="outline" type="button"><Link to="/encomendas">Cancelar</Link></Button>
                <Button type="submit" disabled={mut.isPending} className="gap-2">
                  <Wrench className="size-4" />
                  {mut.isPending ? "A criar…" : "Criar linha livre"}
                </Button>
              </div>
            </Card>
          </form>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function LockedValue({ value, empty }: { value?: string | null; empty: string }) {
  return (
    <div className="h-11 flex items-center gap-2 rounded-md border bg-muted/50 px-3 text-sm">
      <Lock className="size-3.5 text-muted-foreground shrink-0" />
      {value ? <span className="font-medium">{value}</span> : <span className="text-muted-foreground">{empty}</span>}
    </div>
  );
}

function RefSelect({
  items,
  value,
  onChange,
  valueKey = "id",
}: {
  items: any[];
  value: string;
  onChange: (v: string) => void;
  valueKey?: "id" | "code";
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-11"><SelectValue placeholder="Escolher…" /></SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i[valueKey]} value={i[valueKey]}>
            {i.code} — {i.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
