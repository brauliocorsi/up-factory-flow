import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Hand, Bell, Megaphone, MessageSquare, Check, Footprints, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useMySession } from "@/hooks/useMySession";
import { STAGE_LABELS } from "@/lib/format";

type Op = { id: string; code: string; name: string; is_leader: boolean; user_id: string | null; active: boolean };
type Call = {
  id: string; kind: "help_request" | "presence" | "message";
  from_operator_id: string | null; to_operator_id: string | null;
  reason: string | null; message: string | null; stage: string | null;
  status: string; created_at: string; updated_at: string;
};

const REASONS = ["Dúvida", "Falta de material", "Problema na máquina", "Qualidade", "Outro"];
const sb = supabase as any;

function ago(iso: string) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  return `há ${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

function beep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    o.start(); o.stop(ctx.currentTime + 0.25);
  } catch { /* sem som */ }
}

export function FloorCalls() {
  const qc = useQueryClient();
  const { role } = useMySession();
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null)); }, []);
  const isStaff = role === "admin" || role === "escritorio";

  const { data: ops } = useQuery({
    queryKey: ["floor-ops"],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await sb.from("operators").select("id, code, name, is_leader, user_id, active").eq("active", true).order("name");
      if (error) throw error;
      return (data ?? []) as Op[];
    },
  });
  const me = useMemo(() => ops?.find((o) => o.user_id === uid) ?? null, [ops, uid]);
  const isLeader = !!me?.is_leader;

  const { data: calls } = useQuery({
    queryKey: ["floor-calls"],
    enabled: !!uid,
    refetchInterval: 30000,
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data, error } = await sb.from("floor_calls").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as Call[];
    },
  });

  useEffect(() => {
    if (!uid) return;
    const ch = supabase.channel("floor-calls-" + uid)
      .on("postgres_changes", { event: "*", schema: "public", table: "floor_calls" }, () => {
        qc.invalidateQueries({ queryKey: ["floor-calls"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid, qc]);

  const opName = (id: string | null) => ops?.find((o) => o.id === id)?.name ?? "—";

  const myOpenHelp = calls?.find((c) => c.kind === "help_request" && c.from_operator_id === me?.id && (c.status === "aberto" || c.status === "a_caminho")) ?? null;
  const incoming = (calls ?? []).filter((c) => c.kind !== "help_request" && c.to_operator_id === me?.id && c.status === "aberto")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const inbox = (calls ?? []).filter((c) => c.kind === "help_request" && (c.status === "aberto" || c.status === "a_caminho"));
  const canInbox = isLeader || isStaff;

  // Som ao chegar algo novo
  const [seen, setSeen] = useState<Set<string>>(new Set());
  useEffect(() => {
    const relevant = [...incoming, ...(canInbox ? inbox.filter((c) => c.status === "aberto") : [])];
    const fresh = relevant.filter((c) => !seen.has(c.id));
    if (fresh.length && seen.size > 0) beep();
    if (fresh.length) setSeen((s) => { const n = new Set(s); fresh.forEach((c) => n.add(c.id)); return n; });
    else if (seen.size === 0) setSeen(new Set(["_init"]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calls]);

  async function rpc(name: string, args: Record<string, unknown>, ok?: string) {
    const { error } = await sb.rpc(name, args);
    if (error) { toast.error(error.message); return false; }
    if (ok) toast.success(ok);
    qc.invalidateQueries({ queryKey: ["floor-calls"] });
    return true;
  }

  if (!uid || (!me && !isStaff)) return null;

  return (
    <>
      {me && !isLeader && <CallLeaderButton open={myOpenHelp} onSend={(reason, msg) =>
        rpc("create_floor_call", { _kind: "help_request", _to: null, _reason: reason, _message: msg || null, _stage: null }, "Pedido enviado ao líder")}
        onCancel={(id) => rpc("update_floor_call_status", { _id: id, _status: "cancelado" }, "Pedido cancelado")} />}

      {canInbox && (
        <LeaderInbox
          inbox={inbox} opName={opName} ops={(ops ?? []).filter((o) => o.id !== me?.id)}
          onStatus={(id, s) => rpc("update_floor_call_status", { _id: id, _status: s })}
          onCall={(kind, to, msg) => rpc("create_floor_call", { _kind: kind, _to: to, _reason: null, _message: msg || null, _stage: null },
            kind === "presence" ? "Pedido de presença enviado" : "Recado enviado")}
        />
      )}

      {incoming[0] && (
        <IncomingOverlay call={incoming[0]} from={opName(incoming[0].from_operator_id)} more={incoming.length - 1}
          onSeen={() => rpc("update_floor_call_status", { _id: incoming[0].id, _status: "visto" })} />
      )}
    </>
  );
}

function CallLeaderButton({ open, onSend, onCancel }: {
  open: Call | null; onSend: (reason: string, msg: string) => Promise<boolean>; onCancel: (id: string) => void;
}) {
  const [dlg, setDlg] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const waiting = !!open;
  const coming = open?.status === "a_caminho";
  return (
    <>
      <Button
        variant={waiting ? "default" : "outline"} size="sm"
        onClick={() => setDlg(true)}
        className={`gap-2 rounded-full ${coming ? "bg-emerald-600 hover:bg-emerald-600 text-white" : waiting ? "animate-pulse" : ""}`}
        title="Chamar líder de produção"
      >
        <Hand className="size-4" />
        <span className="hidden sm:inline">{coming ? "Líder a caminho" : waiting ? "Líder chamado" : "Chamar líder"}</span>
      </Button>
      <Dialog open={dlg} onOpenChange={setDlg}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{waiting ? (coming ? "O líder vem a caminho" : "Pedido enviado") : "Chamar líder de produção"}</DialogTitle>
            <DialogDescription>
              {waiting ? `Motivo: ${open!.reason ?? "—"} · ${ago(open!.created_at)}` : "Escolhe o motivo. O líder recebe um aviso no ecrã."}
            </DialogDescription>
          </DialogHeader>
          {!waiting && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {REASONS.map((r) => (
                  <button key={r} onClick={() => setReason(r)}
                    className={`px-3 py-2 rounded-full border text-sm font-medium transition ${reason === r ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>
                    {r}
                  </button>
                ))}
              </div>
              <Textarea placeholder="Nota (opcional)" value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={500} />
            </div>
          )}
          <DialogFooter>
            {waiting ? (
              <Button variant="outline" onClick={() => { onCancel(open!.id); setDlg(false); }} className="gap-2">
                <X className="size-4" /> Cancelar pedido
              </Button>
            ) : (
              <Button disabled={busy} className="gap-2" onClick={async () => {
                setBusy(true); const ok = await onSend(reason, msg.trim()); setBusy(false);
                if (ok) { setMsg(""); setDlg(false); }
              }}>
                <Hand className="size-4" /> Chamar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function LeaderInbox({ inbox, opName, ops, onStatus, onCall }: {
  inbox: Call[]; opName: (id: string | null) => string; ops: Op[];
  onStatus: (id: string, s: string) => void;
  onCall: (kind: "presence" | "message", to: string[], msg: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = inbox.filter((c) => c.status === "aberto").length;
  async function send(kind: "presence" | "message") {
    setBusy(true); const ok = await onCall(kind, sel, msg.trim()); setBusy(false);
    if (ok) { setSel([]); setMsg(""); }
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant={pending ? "default" : "ghost"} size="sm" className={`gap-2 rounded-full relative ${pending ? "animate-pulse" : ""}`} title="Pedidos dos operadores">
          <Bell className="size-4" />
          <span className="hidden sm:inline">Pedidos</span>
          {inbox.length > 0 && (
            <span className="min-w-5 h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[11px] grid place-items-center">{inbox.length}</span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader><SheetTitle>Líder de produção</SheetTitle></SheetHeader>

        <div className="mt-4 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pedidos de ajuda</div>
          {inbox.length === 0 && <div className="text-sm text-muted-foreground border border-dashed rounded-lg p-4 text-center">Sem pedidos em aberto</div>}
          {inbox.map((c) => (
            <div key={c.id} className={`rounded-xl border p-3 ${c.status === "aberto" ? "border-destructive/50 bg-destructive/5" : "bg-muted/40"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold">{opName(c.from_operator_id)}</div>
                <div className="text-xs text-muted-foreground">{ago(c.created_at)}</div>
              </div>
              <div className="text-sm">{c.reason}{c.stage ? ` · ${STAGE_LABELS[c.stage as keyof typeof STAGE_LABELS] ?? c.stage}` : ""}</div>
              {c.message && <div className="text-sm text-muted-foreground mt-1">“{c.message}”</div>}
              <div className="flex gap-2 mt-2">
                {c.status === "aberto" && (
                  <Button size="sm" variant="outline" className="gap-1 rounded-full" onClick={() => onStatus(c.id, "a_caminho")}>
                    <Footprints className="size-4" /> A caminho
                  </Button>
                )}
                <Button size="sm" className="gap-1 rounded-full" onClick={() => onStatus(c.id, "resolvido")}>
                  <Check className="size-4" /> Resolvido
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Chamar operador</div>
          <div className="flex flex-wrap gap-2">
            {ops.map((o) => {
              const on = sel.includes(o.id);
              return (
                <button key={o.id} onClick={() => setSel((s) => on ? s.filter((x) => x !== o.id) : [...s, o.id])}
                  className={`px-3 py-1.5 rounded-full border text-sm transition ${on ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>
                  {o.name}
                </button>
              );
            })}
          </div>
          <Textarea placeholder="Recado (para enviar mensagem)" value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={500} />
          <div className="flex gap-2">
            <Button disabled={busy || sel.length === 0} variant="outline" className="gap-2 flex-1" onClick={() => send("presence")}>
              <Megaphone className="size-4" /> Pedir presença
            </Button>
            <Button disabled={busy || sel.length === 0 || !msg.trim()} className="gap-2 flex-1" onClick={() => send("message")}>
              <MessageSquare className="size-4" /> Enviar recado
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function IncomingOverlay({ call, from, more, onSeen }: { call: Call; from: string; more: number; onSeen: () => void }) {
  const presence = call.kind === "presence";
  return (
    <div className="fixed inset-0 z-[100] bg-background/70 backdrop-blur-sm grid place-items-center p-4">
      <div className={`w-full max-w-lg rounded-2xl border-2 shadow-2xl bg-card p-6 text-center ${presence ? "border-destructive" : "border-primary"}`}>
        <div className={`mx-auto size-16 rounded-full grid place-items-center mb-3 ${presence ? "bg-destructive text-destructive-foreground animate-pulse" : "bg-primary text-primary-foreground"}`}>
          {presence ? <Megaphone className="size-8" /> : <MessageSquare className="size-8" />}
        </div>
        <div className="text-xl font-bold">{presence ? "O líder pede a sua presença" : `Recado de ${from}`}</div>
        {presence && <div className="text-sm text-muted-foreground mt-1">{from} · {ago(call.created_at)}</div>}
        {call.message && <div className="text-lg mt-4 whitespace-pre-wrap">{call.message}</div>}
        {!presence && <div className="text-xs text-muted-foreground mt-2">{ago(call.created_at)}</div>}
        <Button size="lg" className="mt-6 w-full gap-2 rounded-full" onClick={onSeen}>
          <Check className="size-5" /> {presence ? "Vou já" : "Visto"}
        </Button>
        {more > 0 && <div className="text-xs text-muted-foreground mt-2">+{more} {more === 1 ? "aviso" : "avisos"} por ver</div>}
      </div>
    </div>
  );
}
