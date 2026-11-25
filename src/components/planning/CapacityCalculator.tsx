import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RotateCcw, Users, Clock, Package, AlertTriangle } from "lucide-react";
import { calculateCapacity, hoursLabel, usefulMinutes } from "@/lib/productionCalculations";
import { STAGE_LABELS } from "@/lib/format";
import type { Stage, DayAssignment } from "@/lib/planning.functions";
import type { CategorySla, ModelSla, ProductSla } from "@/lib/sla.functions";

type Catalog = {
  models: {
    id: string;
    name: string;
    code: string;
    category_id: string;
    structure_code: string | null;
  }[];
  categories: { id: string; code: string }[];
  structures: { code: string; name: string }[];
  measures: { code: string; name: string }[];
};
type Props = {
  catalog: Catalog;
  modelTimes: ModelSla[];
  categoryTimes: CategorySla[];
  productTimes: ProductSla[];
  operators: DayAssignment[];
  dailyMinutes: number;
};
const STAGES: Stage[] = [
  "estrutura",
  "corte",
  "costura",
  "branco",
  "estofagem",
  "qualidade",
  "embalagem",
  "picagem",
];
type Person = { id: string; stage: Stage; hours: string; pause: string };

export function CapacityCalculator({
  catalog,
  modelTimes,
  categoryTimes,
  productTimes,
  operators,
  dailyMinutes,
}: Props) {
  const [modelId, setModelId] = useState("");
  const [measure, setMeasure] = useState("none");
  const [structure, setStructure] = useState("none");
  const [quantity, setQuantity] = useState("1");
  const [days, setDays] = useState("1");
  const [selectedStages, setStages] = useState<Stage[]>(["estofagem"]);
  const [overrides, setOverrides] = useState<Partial<Record<Stage, string>>>({});
  const [people, setPeople] = useState<Person[]>([]);
  const model = catalog.models.find((m) => m.id === modelId);
  const category = catalog.categories.find((c) => c.id === model?.category_id)?.code;
  const operatorMap = new Map<string, { id: string; name: string; stages: Stage[] }>();
  for (const op of operators) {
    const existing = operatorMap.get(op.operator_id);
    if (existing) {
      if (!existing.stages.includes(op.stage)) existing.stages.push(op.stage);
    } else
      operatorMap.set(op.operator_id, {
        id: op.operator_id,
        name: op.operator_name,
        stages: [op.stage],
      });
  }
  function standard(stage: Stage) {
    const product = productTimes.find(
      (r) =>
        r.category_code === category &&
        r.model_code === model?.code &&
        r.structure_code === structure &&
        r.measure_code === measure &&
        r.stage === stage,
    );
    const byModel = modelTimes.find(
      (r) => r.category_code === category && r.model_code === model?.code && r.stage === stage,
    );
    const byCategory = categoryTimes.find((r) => r.category_code === category && r.stage === stage);
    return product
      ? { minutes: product.expected_minutes, source: "Produto" }
      : byModel
        ? { minutes: byModel.expected_minutes, source: "Modelo" }
        : byCategory
          ? { minutes: byCategory.expected_minutes, source: "Categoria" }
          : { minutes: null, source: "Sem tempo definido" };
  }
  const invalidHours =
    usefulMinutes(0, 0, Number(days)) === null ||
    people.some(
      (p) =>
        usefulMinutes(Number(p.hours), Number(p.pause), Number(days)) === null || p.hours === "",
    );
  const result = calculateCapacity(
    selectedStages.map((stage) => ({
      stage,
      minutesPerUnit:
        overrides[stage] !== undefined
          ? overrides[stage] === ""
            ? null
            : Number(overrides[stage])
          : standard(stage).minutes,
    })),
    people.map((p) => ({
      id: p.id,
      stage: p.stage,
      minutes: usefulMinutes(Number(p.hours), Number(p.pause), Number(days)) ?? -1,
    })),
    Number(quantity),
  );
  const ready = Boolean(model) && result.complete && !invalidHours;
  const bottleneck = ready
    ? result.rows.reduce<(typeof result.rows)[number] | null>(
        (min, r) => (!min || (r.units ?? 0) < (min.units ?? 0) ? r : min),
        null,
      )
    : null;
  function updatePerson(id: string, patch: Partial<Person>) {
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function togglePerson(id: string) {
    const op = operatorMap.get(id);
    if (!op) return;
    const first = selectedStages.find((s) => op.stages.includes(s));
    if (!first) return;
    setPeople((prev) =>
      prev.some((p) => p.id === id)
        ? prev.filter((p) => p.id !== id)
        : [...prev, { id, stage: first, hours: String(dailyMinutes / 60), pause: "0" }],
    );
  }
  function toggleStage(stage: Stage) {
    setStages((prev) =>
      prev.includes(stage)
        ? prev.filter((s) => s !== stage)
        : STAGES.filter((s) => prev.includes(s) || s === stage),
    );
    setPeople((prev) => prev.filter((p) => p.stage !== stage));
  }
  return (
    <div className="min-w-0 space-y-6">
      <section className="grid gap-4 border-y py-5 sm:grid-cols-2 xl:grid-cols-5">
        <div className="space-y-2 xl:col-span-2">
          <Label>Modelo / produto</Label>
          <Select
            value={modelId}
            onValueChange={(v) => {
              setModelId(v);
              setOverrides({});
              const m = catalog.models.find((x) => x.id === v);
              setStructure(m?.structure_code ?? "none");
            }}
          >
            <SelectTrigger aria-label="Modelo / produto" className="w-full">
              <SelectValue placeholder="Selecionar modelo" />
            </SelectTrigger>
            <SelectContent>
              {catalog.models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name} · {m.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Estrutura</Label>
          <Select
            value={structure}
            onValueChange={(v) => {
              setStructure(v);
              setOverrides({});
            }}
          >
            <SelectTrigger aria-label="Estrutura" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sem especificação</SelectItem>
              {catalog.structures.map((s) => (
                <SelectItem key={s.code} value={s.code}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Medida</Label>
          <Select
            value={measure}
            onValueChange={(v) => {
              setMeasure(v);
              setOverrides({});
            }}
          >
            <SelectTrigger aria-label="Medida" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sem especificação</SelectItem>
              {catalog.measures.map((m) => (
                <SelectItem key={m.code} value={m.code}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="capacity-quantity">Quantidade pretendida</Label>
          <Input
            id="capacity-quantity"
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
      </section>
      <section>
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <Clock className="size-4 text-primary" /> Tempos por unidade
        </h2>
        <div className="flex flex-wrap gap-2">
          {STAGES.map((stage) => (
            <Button
              key={stage}
              size="sm"
              variant={selectedStages.includes(stage) ? "secondary" : "outline"}
              aria-pressed={selectedStages.includes(stage)}
              onClick={() => toggleStage(stage)}
            >
              {STAGE_LABELS[stage]}
            </Button>
          ))}
        </div>
        <div className="mt-4 divide-y border-y">
          {selectedStages.map((stage) => {
            const s = standard(stage);
            return (
              <div key={stage} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <Label htmlFor={`minutes-${stage}`}>{STAGE_LABELS[stage]}</Label>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {overrides[stage] !== undefined ? "Ajuste da simulação" : s.source}
                    {s.minutes !== null ? ` · padrão ${s.minutes} min` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    id={`minutes-${stage}`}
                    className="w-24 text-right"
                    type="number"
                    min={0.1}
                    step={0.1}
                    disabled={!model}
                    value={overrides[stage] ?? s.minutes ?? ""}
                    placeholder="—"
                    onChange={(e) => setOverrides((prev) => ({ ...prev, [stage]: e.target.value }))}
                  />
                  <span className="text-xs text-muted-foreground">min/un.</span>
                  {overrides[stage] !== undefined && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Repor tempo de ${STAGE_LABELS[stage]}`}
                      onClick={() =>
                        setOverrides((prev) => {
                          const next = { ...prev };
                          delete next[stage];
                          return next;
                        })
                      }
                    >
                      <RotateCcw className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <Users className="size-4 text-primary" /> Equipa e horas disponíveis
          </h2>
          <div className="flex items-center gap-2">
            <Label htmlFor="capacity-days">Dias úteis</Label>
            <Input
              id="capacity-days"
              className="w-20"
              type="number"
              min={1}
              step={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Jornada configurada: {hoursLabel(dailyMinutes)} úteis/dia · pausa adicional: 0 min.
        </p>
        <div className="divide-y border-y">
          {Array.from(operatorMap.values())
            .filter((op) => selectedStages.some((s) => op.stages.includes(s)))
            .map((op) => {
              const person = people.find((p) => p.id === op.id);
              return (
                <div
                  key={op.id}
                  className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_150px_100px_100px]"
                >
                  <label className="flex items-center gap-3 text-sm font-medium">
                    <Checkbox
                      checked={Boolean(person)}
                      onCheckedChange={() => togglePerson(op.id)}
                      aria-label={`Incluir ${op.name}`}
                    />
                    {op.name}
                  </label>
                  {person && (
                    <>
                      <Select
                        value={person.stage}
                        onValueChange={(v) => updatePerson(op.id, { stage: v as Stage })}
                      >
                        <SelectTrigger className="w-full" aria-label={`Posto de ${op.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedStages
                            .filter((s) => op.stages.includes(s))
                            .map((s) => (
                              <SelectItem key={s} value={s}>
                                {STAGE_LABELS[s]}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <div>
                        <Label
                          htmlFor={`hours-${op.id}`}
                          className="text-[11px] text-muted-foreground"
                        >
                          Horas/dia
                        </Label>
                        <Input
                          id={`hours-${op.id}`}
                          type="number"
                          min={0}
                          step={0.25}
                          value={person.hours}
                          onChange={(e) => updatePerson(op.id, { hours: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label
                          htmlFor={`pause-${op.id}`}
                          className="text-[11px] text-muted-foreground"
                        >
                          Pausa extra (min/dia)
                        </Label>
                        <Input
                          id={`pause-${op.id}`}
                          type="number"
                          min={0}
                          step={1}
                          value={person.pause}
                          onChange={(e) => updatePerson(op.id, { pause: e.target.value })}
                        />
                      </div>
                    </>
                  )}
                </div>
              );
            })}
        </div>
        {operatorMap.size === 0 && (
          <p className="py-6 text-sm text-muted-foreground">
            Sem colaboradores ativos atribuídos a postos.
          </p>
        )}
      </section>
      <section className="border-t pt-5">
        <div className="mb-4 flex items-center gap-2">
          <Package className="size-4 text-primary" />
          <h2 className="font-semibold">Capacidade estimada</h2>
          <Badge variant="outline">Simulação</Badge>
        </div>
        {!model ? (
          <p className="text-sm text-muted-foreground">Sem produto selecionado.</p>
        ) : !ready ? (
          <div role="status" className="flex gap-2 text-sm text-warning-foreground">
            <AlertTriangle className="size-4 shrink-0" />
            {invalidHours || result.invalid
              ? "Valores inválidos: confirmar quantidade, dias, tempos e pausas."
              : selectedStages.length === 0
                ? "Sem etapas selecionadas."
                : "Estimativa incompleta: há etapas sem tempo definido."}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-5 border-b pb-5 sm:grid-cols-3">
              <div>
                <div className="text-xs text-muted-foreground">
                  Unidades possíveis nas etapas selecionadas
                </div>
                <strong data-testid="capacity-units" className="mt-2 block text-3xl tabular-nums">
                  {result.units}
                </strong>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  Horas de mão de obra necessárias
                </div>
                <strong data-testid="capacity-needed" className="mt-2 block text-3xl tabular-nums">
                  {hoursLabel(result.needed ?? 0)}
                </strong>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  Horas de mão de obra disponíveis
                </div>
                <strong className="mt-2 block text-3xl tabular-nums">
                  {hoursLabel(result.available)}
                </strong>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge variant={(result.units ?? 0) >= Number(quantity) ? "success" : "warning"}>
                {(result.units ?? 0) >= Number(quantity)
                  ? "Quantidade dentro da capacidade"
                  : "Horas insuficientes para a quantidade"}
              </Badge>
              {bottleneck && (
                <Badge variant="secondary">
                  Etapa limitante: {STAGE_LABELS[bottleneck.stage as Stage]}
                </Badge>
              )}
            </div>
            <div className="mt-4 divide-y">
              {result.rows.map((r) => (
                <div key={r.stage} className="grid grid-cols-2 gap-2 py-3 text-sm sm:grid-cols-4">
                  <strong>{STAGE_LABELS[r.stage as Stage]}</strong>
                  <span>{hoursLabel(r.needed ?? 0)} necessárias</span>
                  <span>{hoursLabel(r.available)} disponíveis</span>
                  <span className={(r.balance ?? 0) < 0 ? "text-destructive" : "text-success"}>
                    {(r.balance ?? 0) < 0 ? "Faltam" : "Sobram"}{" "}
                    {hoursLabel(Math.abs(r.balance ?? 0))}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Limite teórico de mão de obra, não prazo de entrega. Não considera dependências entre
              etapas, materiais, máquinas ou trabalho já atribuído. Vários colaboradores não
              garantem execução simultânea do mesmo produto.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
