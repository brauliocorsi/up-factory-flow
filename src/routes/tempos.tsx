import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { STAGE_LABELS, STAGES_ORDER } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Check, ChevronLeft, Loader2, MessageSquare, Search, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/tempos")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Recolha de tempos — UP Fábrica" },
      { name: "description", content: "Indique quantos minutos demora cada modelo na sua etapa." },
      { property: "og:title", content: "Recolha de tempos — UP Fábrica" },
      { property: "og:description", content: "Indique quantos minutos demora cada modelo na sua etapa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth", search: { next: "/tempos" } });
  },
  component: TemposPage,
});

type Model = { id: string; code: string; name: string };
type Decl = { model_id: string; stage: string; minutes: number; note: string | null };

function useData() {
  return useQuery({
    queryKey: ["tempos-base"],
    queryFn: async () => {
      const { data: opId } = await supabase.rpc("my_operator_id");
      if (!opId) return { operatorId: null as string | null, stages: [] as string[], models: [] as Model[], decls: [] as Decl[] };
      const [{ data: os }, { data: camp }, { data: cat }] = await Promise.all([
        supabase.from("operator_stages").select("stage").eq("operator_id", opId),
        supabase.from("stage_time_campaign").select("stage").eq("category_code", "CAM").eq("open", true),
        supabase.from("ref_categories").select("id").eq("code", "CAM").maybeSingle(),
      ]);
      const open = new Set((camp ?? []).map((c) => c.stage as string));
      const stages = STAGES_ORDER.filter((s) => (os ?? []).some((o) => o.stage === s) && open.has(s));
      const { data: models } = cat
        ? await supabase.from("models").select("id, code, name").eq("active", true).eq("category_id", cat.id).order("code")
        : { data: [] };
      const { data: decls } = await supabase
        .from("stage_time_declarations").select("model_id, stage, minutes, note").eq("operator_id", opId);
      return { operatorId: opId as string, stages: stages as string[], models: (models ?? []) as Model[], decls: (decls ?? []) as Decl[] };
    },
  });
}

function TemposPage() {
  const { data, isLoading, error } = useData();
  const [picked, setPicked] = useState<string | null>(null);

  if (isLoading) return <Center><Loader2 className="h-6 w-6 animate-spin" /></Center>;
  if (error) return <Center>Não foi possível carregar os dados. Tente novamente.</Center>;
  if (!data?.operatorId)
    return <Center><AlertCircle className="h-8 w-8 text-destructive mb-2" />Esta conta não está ligada a nenhum colaborador. Peça ao escritório para a associar.</Center>;
  if (data.stages.length === 0)
    return <Center>Não há etapas suas abertas para recolha de tempos neste momento.</Center>;

  const stage = data.stages.length === 1 ? data.stages[0]! : picked;
  if (!stage) {
    return (
      <div className="mx-auto max-w-md p-4 space-y-3">
        <h1 className="text-xl font-semibold">Recolha de tempos</h1>
        <p className="text-sm text-muted-foreground">Escolha a etapa.</p>
        {data.stages.map((s) => {
          const n = data.decls.filter((d) => d.stage === s).length;
          return (
            <button key={s} onClick={() => setPicked(s)}
              className="w-full flex items-center justify-between rounded-xl border bg-card p-4 text-left active:bg-accent">
              <span className="font-medium">{STAGE_LABELS[s] ?? s}</span>
              <span className="text-sm text-muted-foreground">{n}/{data.models.length}</span>
            </button>
          );
        })}
      </div>
    );
  }
  return <StageForm stage={stage} operatorId={data.operatorId} models={data.models} decls={data.decls}
    onBack={data.stages.length > 1 ? () => setPicked(null) : undefined} />;
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center text-muted-foreground">{children}</div>;
}

function StageForm({ stage, operatorId, models, decls, onBack }: {
  stage: string; operatorId: string; models: Model[]; decls: Decl[]; onBack?: () => void;
}) {
  const [q, setQ] = useState("");
  const mine = useMemo(() => new Map(decls.filter((d) => d.stage === stage).map((d) => [d.model_id, d])), [decls, stage]);
  // Ordem fixa ao entrar (para a linha não saltar ao gravar).
  const [order] = useState(() =>
    [...models].sort((a, b) => Number(mine.has(a.id)) - Number(mine.has(b.id)) || a.code.localeCompare(b.code)));
  const filled = models.filter((m) => mine.has(m.id)).length;
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const list = order.filter((m) => !q || norm(m.code + " " + m.name).includes(norm(q)));
  const done = filled === models.length && models.length > 0;

  return (
    <div className="mx-auto max-w-md pb-10">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b p-3 space-y-2">
        <div className="flex items-center gap-2">
          {onBack && <button onClick={onBack} className="p-2 -ml-2" aria-label="Voltar"><ChevronLeft className="h-5 w-5" /></button>}
          <h1 className="font-semibold text-lg">{STAGE_LABELS[stage] ?? stage}</h1>
          <span className="ml-auto text-sm font-medium">Preenchidos {filled} de {models.length}</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${models.length ? (filled / models.length) * 100 : 0}%` }} />
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar modelo por nome ou código" className="pl-9 h-11" />
        </div>
      </div>
      {done && (
        <div className="m-3 rounded-xl border border-primary/40 bg-primary/10 p-4 text-sm">
          Obrigado! Preencheu todos os modelos desta etapa. Pode continuar a corrigir se precisar.
        </div>
      )}
      <ul className="divide-y">
        {list.map((m) => (
          <Row key={m.id} model={m} stage={stage} operatorId={operatorId} decl={mine.get(m.id)} />
        ))}
      </ul>
    </div>
  );
}

function Row({ model, stage, operatorId, decl }: { model: Model; stage: string; operatorId: string; decl?: Decl }) {
  const qc = useQueryClient();
  const [val, setVal] = useState(decl ? String(decl.minutes).replace(".", ",") : "");
  const [note, setNote] = useState(decl?.note ?? "");
  const [showNote, setShowNote] = useState(!!decl?.note);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function save() {
    const raw = val.trim().replace(",", ".");
    if (!raw) return;
    const n = Number(raw);
    if (!/^\d+(\.\d)?$/.test(raw) || !(n > 0) || n > 600) {
      setState("error"); setMsg("Entre 0,1 e 600 minutos, uma casa decimal."); return;
    }
    if (decl && Number(decl.minutes) === n && (decl.note ?? "") === note.trim()) return;
    setState("saving");
    const { error } = await supabase.from("stage_time_declarations").upsert(
      { model_id: model.id, stage: stage as any, operator_id: operatorId, minutes: n, note: note.trim() || null },
      { onConflict: "model_id,stage,operator_id" },
    );
    if (error) { setState("error"); setMsg("Não gravou. Tente de novo."); return; }
    setState("saved"); setMsg("");
    qc.setQueryData(["tempos-base"], (old: any) => old && ({
      ...old,
      decls: [...old.decls.filter((d: Decl) => !(d.model_id === model.id && d.stage === stage)),
        { model_id: model.id, stage, minutes: n, note: note.trim() || null }],
    }));
  }

  return (
    <li className="p-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">{model.code}</div>
          <div className="font-medium leading-tight truncate">{model.name}</div>
        </div>
        <button onClick={() => setShowNote((s) => !s)} aria-label="Nota"
          className={`p-2 rounded-md ${note ? "text-primary" : "text-muted-foreground"}`}>
          <MessageSquare className="h-4 w-4" />
        </button>
        <div className="relative">
          <Input inputMode="decimal" value={val} placeholder="min"
            onChange={(e) => { setVal(e.target.value); setState("idle"); }}
            onBlur={save}
            className={`w-24 h-12 text-lg text-right pr-8 ${state === "error" ? "border-destructive" : ""}`} />
          <span className="absolute right-2 top-1/2 -translate-y-1/2">
            {state === "saving" && <Loader2 className="h-4 w-4 animate-spin" />}
            {(state === "saved" || (state === "idle" && decl)) && <Check className="h-4 w-4 text-primary" />}
          </span>
        </div>
      </div>
      {showNote && (
        <Input value={note} onChange={(e) => setNote(e.target.value)} onBlur={save}
          placeholder="Nota (opcional)" className="mt-2 h-11" />
      )}
      {state === "error" && <p className="mt-1 text-xs text-destructive">{msg}</p>}
    </li>
  );
}
