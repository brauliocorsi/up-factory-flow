import { createFileRoute } from "@tanstack/react-router";

declare const __APP_BUILD__: string | undefined;

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
import { KeyRound, ShieldCheck, Pencil, Trash2 } from "lucide-react";
import { STAGE_LABELS } from "@/lib/format";
import {
  getAppSettings, updateAppSettings,
  listOperatorsWithStages, setOperatorStages, upsertOperator,
  deleteOperator,
  STAGES, type Stage,
} from "@/lib/production.functions";
import { setOperatorPin } from "@/lib/operatorAuth.functions";
import {
  listStaffUsers, createStaffUser, setStaffRole, resetStaffPassword, deleteStaffUser,
} from "@/lib/staffUsers.functions";
import { useMySession } from "@/hooks/useMySession";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  component: ConfigPage,
});

function ConfigPage() {
  const qc = useQueryClient();
  const { role: myRole } = useMySession();
  const fetchSettings = useServerFn(getAppSettings);
  const fetchOps = useServerFn(listOperatorsWithStages);
  const updateSettingsFn = useServerFn(updateAppSettings);
  const setStagesFn = useServerFn(setOperatorStages);
  const upsertOpFn = useServerFn(upsertOperator);
  const deleteOpFn = useServerFn(deleteOperator);

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

  const editOp = useMutation({
    mutationFn: (vars: { id: string; code: string; name: string; active: boolean }) =>
      upsertOpFn({ data: vars }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["operators-stages"] }); toast.success("Operador atualizado"); },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  const removeOp = useMutation({
    mutationFn: (id: string) => deleteOpFn({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["operators-stages"] }); toast.success("Operador eliminado"); },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
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
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">Configurações</h1>
        <span className="text-xs text-muted-foreground font-mono">
          Versão da aplicação: {typeof __APP_BUILD__ === "string" ? __APP_BUILD__ : "—"}
        </span>
      </div>


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
              onEdit={(v) => editOp.mutate({ id: op.id, ...v })}
              editing={editOp.isPending}
              onDelete={() => removeOp.mutate(op.id)}
              deleting={removeOp.isPending}
            />
          ))}
        </div>
      </Card>

      {myRole === "admin" && <StaffAccessCard />}
    </div>
  );
}

function StaffAccessCard() {
  const qc = useQueryClient();
  const fetchStaff = useServerFn(listStaffUsers);
  const createFn = useServerFn(createStaffUser);
  const roleFn = useServerFn(setStaffRole);
  const pwdFn = useServerFn(resetStaffPassword);
  const delFn = useServerFn(deleteStaffUser);

  const { data: staff } = useQuery({ queryKey: ["staff-users"], queryFn: () => fetchStaff() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["staff-users"] });

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "escritorio">("escritorio");

  const create = useMutation({
    mutationFn: () => createFn({ data: { email: email.trim(), password, name: name.trim() || undefined, role: newRole } }),
    onSuccess: (r: any) => {
      if (!r?.ok) { toast.error(r?.message ?? "Erro"); return; }
      setEmail(""); setName(""); setPassword("");
      refresh();
      toast.success("Acesso criado. Já pode entrar com o email e a password.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  const changeRole = useMutation({
    mutationFn: (v: { user_id: string; role: "admin" | "escritorio" }) => roleFn({ data: v }),
    onSuccess: (r: any) => {
      if (!r?.ok) { toast.error(r?.message ?? "Erro"); return; }
      refresh(); toast.success("Permissão atualizada");
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  const resetPwd = useMutation({
    mutationFn: (v: { user_id: string; password: string }) => pwdFn({ data: v }),
    onSuccess: (r: any) => {
      if (!r?.ok) { toast.error(r?.message ?? "Erro"); return; }
      toast.success("Password alterada");
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  const removeUser = useMutation({
    mutationFn: (user_id: string) => delFn({ data: { user_id } }),
    onSuccess: (r: any) => {
      if (!r?.ok) { toast.error(r?.message ?? "Erro"); return; }
      refresh(); toast.success("Acesso removido");
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  const canCreate = /\S+@\S+\.\S+/.test(email.trim()) && password.length >= 8 && !create.isPending;

  return (
    <Card className="p-4 space-y-4">
      <div>
        <h2 className="font-semibold">Acessos de escritório e administração</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Criar logins com email e password. Escritório gere encomendas e planeamento;
          administração tem acesso total, incluindo estas configurações.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end pb-3 border-b">
        <div className="md:col-span-2">
          <Label className="text-xs">Email</Label>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@empresa.pt" autoComplete="off" />
        </div>
        <div>
          <Label className="text-xs">Nome</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Opcional" />
        </div>
        <div>
          <Label className="text-xs">Password</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mín. 8 caracteres" autoComplete="new-password" />
        </div>
        <div>
          <Label className="text-xs">Permissão</Label>
          <Select value={newRole} onValueChange={(v) => setNewRole(v as "admin" | "escritorio")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="escritorio">Escritório</SelectItem>
              <SelectItem value="admin">Administração</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-5">
          <Button disabled={!canCreate} onClick={() => create.mutate()}>
            {create.isPending ? "A criar…" : "Criar acesso"}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {(staff ?? []).length === 0 && (
          <div className="text-sm text-muted-foreground">Ainda não existem acessos de escritório.</div>
        )}
        {(staff ?? []).map((u) => (
          <StaffRow
            key={u.id}
            user={u}
            onRole={(r) => changeRole.mutate({ user_id: u.id, role: r })}
            onPassword={(p) => resetPwd.mutate({ user_id: u.id, password: p })}
            onDelete={() => removeUser.mutate(u.id)}
            busy={changeRole.isPending || resetPwd.isPending || removeUser.isPending}
          />
        ))}
      </div>
    </Card>
  );
}

function StaffRow({ user, onRole, onPassword, onDelete, busy }: {
  user: { id: string; email: string; name: string; role: "admin" | "escritorio"; is_self: boolean };
  onRole: (r: "admin" | "escritorio") => void;
  onPassword: (p: string) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwd, setPwd] = useState("");
  const [delOpen, setDelOpen] = useState(false);

  return (
    <div className="border rounded-md p-3 flex items-center justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <div className="font-medium text-sm truncate">{user.name || user.email}</div>
        <div className="text-xs text-muted-foreground truncate">{user.email}</div>
      </div>
      <div className="flex items-center gap-2">
        {user.is_self && <Badge variant="secondary">Você</Badge>}
        <Select value={user.role} onValueChange={(v) => onRole(v as "admin" | "escritorio")} disabled={busy}>
          <SelectTrigger className="w-[170px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="escritorio">Escritório</SelectItem>
            <SelectItem value="admin">Administração</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => setPwdOpen(true)} disabled={busy}>
          <KeyRound className="size-3.5 mr-1" /> Password
        </Button>
        {!user.is_self && (
          <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDelOpen(true)} disabled={busy}>
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>

      <Dialog open={pwdOpen} onOpenChange={setPwdOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar password — {user.email}</DialogTitle>
            <DialogDescription>Defina uma nova password com pelo menos 8 caracteres.</DialogDescription>
          </DialogHeader>
          <Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Nova password" autoComplete="new-password" />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPwd(""); setPwdOpen(false); }}>Cancelar</Button>
            <Button disabled={pwd.length < 8} onClick={() => { onPassword(pwd); setPwd(""); setPwdOpen(false); }}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={delOpen} onOpenChange={setDelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover acesso?</DialogTitle>
            <DialogDescription>
              <b>{user.email}</b> deixa de conseguir entrar na aplicação. O histórico de trabalho mantém-se.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelOpen(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => { onDelete(); setDelOpen(false); }}>Remover</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ModeOption({ title, description, checked, onSelect }: {
  title: string; description: string; checked: boolean; onSelect: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
      className={`w-full cursor-pointer text-left border rounded-md p-3 transition ${checked ? "border-primary bg-primary/5" : "hover:bg-accent"}`}
    >
      <div className="flex items-start gap-3">
        <Switch checked={checked} onCheckedChange={() => onSelect()} />
        <div className="flex-1">
          <div className="font-medium text-sm">{title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
        </div>
      </div>
    </div>
  );
}


function OperatorRow({ op, onSave, saving, onSetPin, settingPin, onEdit, editing, onDelete, deleting }: {
  op: { id: string; code: string; name: string; active: boolean; user_id: string | null; stages: Stage[] };
  onSave: (stages: Stage[]) => void;
  saving: boolean;
  onSetPin: (pin: string) => void;
  settingPin: boolean;
  onEdit: (v: { code: string; name: string; active: boolean }) => void;
  editing: boolean;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [stages, setStages] = useState<Stage[]>(op.stages);
  const dirty = stages.slice().sort().join(",") !== op.stages.slice().sort().join(",");
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [eCode, setECode] = useState(op.code);
  const [eName, setEName] = useState(op.name);
  const [eActive, setEActive] = useState(op.active);
  const [confirmDel, setConfirmDel] = useState(false);

  function openEdit() {
    setECode(op.code); setEName(op.name); setEActive(op.active);
    setEditOpen(true);
  }
  function submitEdit() {
    if (!eCode.trim() || !eName.trim()) { toast.error("Código e nome obrigatórios"); return; }
    onEdit({ code: eCode.trim(), name: eName.trim(), active: eActive });
    setEditOpen(false);
  }

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
          <Button size="sm" variant="outline" onClick={openEdit} disabled={editing}>
            <Pencil className="size-3.5 mr-1" /> Editar
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPinOpen(true)} disabled={settingPin}>
            <KeyRound className="size-3.5 mr-1" />
            {op.user_id ? "Repor PIN" : "Criar login"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirmDel(true)} disabled={deleting} className="text-destructive hover:text-destructive">
            <Trash2 className="size-3.5" />
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

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar operador</DialogTitle>
            <DialogDescription>
              Alterar código, nome ou estado. Se o operador tiver login, o código
              é atualizado automaticamente no acesso.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Código</Label>
              <Input value={eCode} onChange={(e) => setECode(e.target.value)} maxLength={16} />
            </div>
            <div>
              <Label className="text-xs">Nome</Label>
              <Input value={eName} onChange={(e) => setEName(e.target.value)} maxLength={120} />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Switch checked={eActive} onCheckedChange={setEActive} />
              <span className="text-sm">{eActive ? "Ativo" : "Inativo"}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={submitEdit} disabled={editing}>{editing ? "A guardar…" : "Guardar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDel} onOpenChange={setConfirmDel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar operador?</DialogTitle>
            <DialogDescription>
              Vai eliminar <b>{op.code} — {op.name}</b> e o seu acesso. Se houver
              histórico de produção associado, o operador será apenas marcado
              como inativo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDel(false)}>Cancelar</Button>
            <Button variant="destructive" disabled={deleting} onClick={() => { onDelete(); setConfirmDel(false); }}>
              {deleting ? "A eliminar…" : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}