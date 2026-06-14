import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { KeyRound, ShieldCheck } from "lucide-react";
import { STAGE_LABELS } from "@/lib/format";
import {
  getAppSettings, updateAppSettings,
  listOperatorsWithStages, setOperatorStages, upsertOperator,
  STAGES, type Stage,
} from "@/lib/production.functions";
import { setOperatorPin } from "@/lib/operatorAuth.functions";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  component: ConfigPage,
});

function ConfigPage() {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getAppSettings);
  const fetchOps = useServerFn(listOperatorsWithStages);
  const updateSettingsFn = useServerFn(updateAppSettings);
  const setStagesFn = useServerFn(setOperatorStages);
  const upsertOpFn = useServerFn(upsertOperator);

  const { data: settings } = useQuery({ queryKey: ["app-settings"], queryFn: () => fetchSettings() });
  const { data: operators } = useQuery({ queryKey: ["operators-stages"], queryFn: () => fetchOps() });

  const setMode = useMutation({
    mutationFn: (mode: "codigo"|"sessao") => updateSettingsFn({ data: { identification_mode: mode } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["app-settings"] }); toast.success("Modo atualizado"); },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  const saveStages = useMutation({
    mutationFn: (vars: { operator_id: string; stages: Stage[] }) => setStagesFn({ data: vars }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["operators-stages"] }); toast.success("Etapas guardadas"); },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  const setPinFn = useServerFn(setOperatorPin);
  const setPin = useMutation({
    mutationFn: (vars: { operator_id: string; pin: string }) => setPinFn({ data: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["operators-stages"] });
      toast.success("PIN definido. O operador já pode entrar.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao definir PIN"),
  });

  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const createOp = useMutation({
    mutationFn: () => upsertOpFn({ data: { code: newCode.trim(), name: newName.trim() } }),
    onSuccess: () => { setNewCode(""); setNewName(""); qc.invalidateQueries({ queryKey: ["operators-stages"] }); toast.success("Operador criado"); },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  const mode = settings?.identification_mode ?? "codigo";

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold">Configurações</h1>

      <Card className="p-4 space-y-4">
        <h2 className="font-semibold">Modo de identificação na produção</h2>
        <ModeOption
          title="Código por ação (comunitário)"
          description="O ecrã fica aberto. Em cada ação o operador digita o seu código (ex: 01). Ideal para um computador partilhado na produção."
          checked={mode === "codigo"}
          onSelect={() => setMode.mutate("codigo")}
        />
        <ModeOption
          title="Sessão por utilizador (individual)"
          description="O operador faz login uma vez e fica identificado em todas as ações. Ideal para telemóvel próprio."
          checked={mode === "sessao"}
          onSelect={() => setMode.mutate("sessao")}
        />
      </Card>

      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Operadores e etapas atribuídas</h2>
        </div>

        <div className="flex gap-2 items-end pb-2 border-b">
          <div>
            <Label className="text-xs">Código</Label>
            <Input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="04" className="w-24" />
          </div>
          <div className="flex-1">
            <Label className="text-xs">Nome</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome do operador" />
          </div>
          <Button disabled={!newCode.trim() || !newName.trim() || createOp.isPending} onClick={() => createOp.mutate()}>Adicionar</Button>
        </div>

        <div className="space-y-3">
          {(operators ?? []).map((op) => (
            <OperatorRow
              key={op.id}
              op={op}
              onSave={(stages) => saveStages.mutate({ operator_id: op.id, stages })}
              saving={saveStages.isPending}
              onSetPin={(pin) => setPin.mutate({ operator_id: op.id, pin })}
              settingPin={setPin.isPending}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

function ModeOption({ title, description, checked, onSelect }: {
  title: string; description: string; checked: boolean; onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left border rounded-md p-3 transition ${checked ? "border-primary bg-primary/5" : "hover:bg-accent"}`}
    >
      <div className="flex items-start gap-3">
        <Switch checked={checked} onCheckedChange={() => onSelect()} />
        <div className="flex-1">
          <div className="font-medium text-sm">{title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
        </div>
      </div>
    </button>
  );
}

function OperatorRow({ op, onSave, saving }: {
function OperatorRow({ op, onSave, saving, onSetPin, settingPin }: {
  op: { id: string; code: string; name: string; active: boolean; user_id: string | null; stages: Stage[] };
  onSave: (stages: Stage[]) => void;
  saving: boolean;
  onSetPin: (pin: string) => void;
  settingPin: boolean;
}) {
  const [stages, setStages] = useState<Stage[]>(op.stages);
  const dirty = stages.slice().sort().join(",") !== op.stages.slice().sort().join(",");
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");

  function submitPin() {
    if (!/^\d{6}$/.test(pin)) { toast.error("PIN deve ter 6 dígitos"); return; }
    onSetPin(pin);
    setPin("");
    setPinOpen(false);
  }

  function toggle(s: Stage) {
    setStages((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  }
  return (
    <div className="border rounded-md p-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <span className="font-mono text-sm font-bold mr-2">{op.code}</span>
          <span className="font-medium">{op.name}</span>
          {!op.active && <Badge variant="secondary" className="ml-2">Inativo</Badge>}
          {op.user_id && (
            <Badge variant="outline" className="ml-2 gap-1">
              <ShieldCheck className="size-3" /> Login ativo
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setPinOpen(true)} disabled={settingPin}>
            <KeyRound className="size-3.5 mr-1" />
            {op.user_id ? "Repor PIN" : "Criar login"}
          </Button>
          <Button size="sm" disabled={!dirty || saving} onClick={() => onSave(stages)}>Guardar</Button>
        </div>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {STAGES.map((s) => {
          const on = stages.includes(s);
          return (
            <button
              key={s}
              onClick={() => toggle(s)}
              className={`text-xs px-2.5 py-1 rounded-md border transition ${on ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"}`}
            >
              {STAGE_LABELS[s]}
            </button>
          );
        })}
      </div>

      <Dialog open={pinOpen} onOpenChange={setPinOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{op.user_id ? "Repor PIN" : "Criar login"} — {op.name}</DialogTitle>
            <DialogDescription>
              Define um PIN de 6 dígitos. O operador entra na app com o seu código
              ({op.code}) e este PIN.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`pin-${op.id}`}>PIN (6 dígitos)</Label>
            <Input
              id={`pin-${op.id}`}
              type="password"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••••"
              className="text-2xl h-12 font-mono tracking-[0.5em] text-center"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPin(""); setPinOpen(false); }}>Cancelar</Button>
            <Button onClick={submitPin} disabled={settingPin || pin.length !== 6}>
              {settingPin ? "A guardar…" : "Guardar PIN"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}