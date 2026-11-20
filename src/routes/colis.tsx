import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Check, Loader2, Minus, Plus, Search } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/colis")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Volumes por produto — UP Fábrica" },
      { name: "description", content: "Indique quantos volumes (colis) tem cada produto." },
      { property: "og:title", content: "Volumes por produto — UP Fábrica" },
      { property: "og:description", content: "Indique quantos volumes (colis) tem cada produto." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth", search: { next: "/colis" } });
  },
  component: ColisPage,
});

type Model = { id: string; code: string; name: string };
type Decl = { model_id: string; colis: number; names: string | null; note: string | null };

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function ColisPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["colis-decl-base"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user!.id;
      const [{ data: models, error: e1 }, { data: decls }] = await Promise.all([
        supabase.from("models").select("id, code, name").eq("active", true).order("name").range(0, 1999),
        supabase.from("coli_count_declarations").select("model_id, colis, names, note").eq("user_id", uid),
      ]);
      if (e1) throw e1;
      return { uid, models: (models ?? []) as Model[], decls: (decls ?? []) as Decl[] };
    },
  });
  const list = useMemo(() => {
    const t = norm(q.trim());
    return (data?.models ?? []).filter((m) => !t || norm(`${m.code} ${m.name}`).includes(t));
  }, [data, q]);

  if (isLoading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (error) return <div className="p-6 text-center">Não foi possível carregar. Confirme que a sua conta tem acesso à fábrica.</div>;
  const done = data!.decls.length;

  return (
    <div className="mx-auto max-w-md p-4 space-y-3">
      <h1 className="text-xl font-semibold">Volumes por produto</h1>
      <p className="text-sm text-muted-foreground">Indique quantos volumes (colis) sai cada produto. Respondidos: {done}/{data!.models.length}</p>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Procurar produto" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.map((m) => (
        <Row key={m.id} m={m} uid={data!.uid} decl={data!.decls.find((d) => d.model_id === m.id)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["colis-decl-base"] })} />
      ))}
    </div>
  );
}

function Row({ m, uid, decl, onSaved }: { m: Model; uid: string; decl?: Decl; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(decl?.colis ?? 1);
  const [names, setNames] = useState(decl?.names ?? "");
  const [note, setNote] = useState(decl?.note ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { data: op } = await supabase.rpc("my_operator_id");
    const { error } = await supabase.from("coli_count_declarations").upsert(
      { model_id: m.id, user_id: uid, operator_id: op ?? null, colis: n, names: names.trim() || null, note: note.trim() || null, updated_at: new Date().toISOString() },
      { onConflict: "model_id,user_id" },
    );
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Guardado");
    setOpen(false);
    onSaved();
  };
  return (
    <div className="rounded-xl border bg-card p-3">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(!open)}>
        <span><span className="block font-medium">{m.name}</span><span className="text-xs text-muted-foreground">{m.code}</span></span>
        {decl ? <span className="flex items-center gap-1 text-sm text-primary"><Check className="h-4 w-4" />{decl.colis}</span> : <span className="text-xs text-muted-foreground">Por responder</span>}
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-center gap-4">
            <button aria-label="Menos" className="rounded-full border p-3" onClick={() => setN(Math.max(1, n - 1))}><Minus className="h-5 w-5" /></button>
            <span className="w-10 text-center text-3xl font-semibold">{n}</span>
            <button aria-label="Mais" className="rounded-full border p-3" onClick={() => setN(Math.min(20, n + 1))}><Plus className="h-5 w-5" /></button>
          </div>
          <Input placeholder="Nomes dos volumes (ex.: Cabeceira, Base, Pés)" value={names} onChange={(e) => setNames(e.target.value)} />
          <Input placeholder="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button disabled={busy} onClick={save} className="w-full rounded-lg bg-primary py-2 font-medium text-primary-foreground disabled:opacity-50">
            {busy ? "A guardar…" : "Guardar"}
          </button>
        </div>
      )}
    </div>
  );
}
