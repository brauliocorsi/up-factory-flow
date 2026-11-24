import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Factory, HardHat, ShieldCheck, Layers, ScanLine, ArrowRight, Loader2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { operatorEmailForCode, operatorPasswordFromPin } from "@/lib/operatorPin";

/**
 * Destino inicial conforme o perfil: operador vai direto ao seu posto e
 * picador à picagem. Evita passar pelo painel geral (que estes perfis não
 * podem ler) e o erro "Algo correu mal" logo após iniciar sessão.
 */
async function landingPathForUser(userId: string): Promise<string> {
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const list = (roles ?? []).map((r: any) => r.role as string);
  if (list.includes("admin") || list.includes("escritorio")) return "/";
  if (list.includes("operador")) return "/producao";
  if (list.includes("picador")) return "/picagem";
  return "/producao";
}

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { next?: string } =>
    typeof s.next === "string" && s.next ? { next: s.next } : {},
  beforeLoad: async ({ search }) => {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      const next = (search as { next?: string }).next;
      if (next && next.startsWith("/") && !next.startsWith("//")) {
        throw redirect({ href: next });
      }
      const to = await landingPathForUser(data.session.user.id);
      throw redirect({ href: to });
    }
  },
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  // Only accept same-origin relative paths as the return target.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "";
  function goNext(fallback: string) {
    if (safeNext) {
      window.location.href = safeNext;
      return;
    }
    navigate({ href: fallback, replace: true });
  }
  const [tab, setTab] = useState<"operador" | "admin">("operador");

  // --- Operador ---
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [opLoading, setOpLoading] = useState(false);
  async function onOperatorSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(pin)) { toast.error("PIN deve ter 6 dígitos"); return; }
    if (!code.trim()) { toast.error("Indica o código"); return; }
    setOpLoading(true);
    const email = operatorEmailForCode(code);
    let { error } = await supabase.auth.signInWithPassword({
      email,
      password: operatorPasswordFromPin(code, pin),
    });
    if (error) {
      // Contas antigas ainda podem ter o PIN como password.
      const legacy = await supabase.auth.signInWithPassword({ email, password: pin });
      error = legacy.error;
    }
    setOpLoading(false);
    if (error) { toast.error("Código ou PIN inválido"); return; }
    toast.success("Sessão iniciada");
    goNext("/producao");
  }

  // --- Admin ---
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Sessão iniciada");
    const to = data.user ? await landingPathForUser(data.user.id) : "/";
    goNext(to);
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr] bg-background">
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-primary p-12 text-primary-foreground">
        <div className="pointer-events-none absolute -right-32 -top-32 size-[28rem] rounded-full bg-primary-foreground/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-20 size-[26rem] rounded-full bg-primary-foreground/10 blur-3xl" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(currentColor_1px,transparent_1px),linear-gradient(90deg,currentColor_1px,transparent_1px)] [background-size:40px_40px]" />
        <div className="relative flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-primary-foreground/15 ring-1 ring-primary-foreground/25">
            <Factory className="size-6" />
          </div>
          <div className="text-lg font-extrabold tracking-tight">UP Fábrica</div>
        </div>
        <div className="relative max-w-md space-y-5">
          <h1 className="text-4xl font-extrabold leading-tight">O chão de fábrica, claro e ao vivo.</h1>
          <p className="text-primary-foreground/75 text-lg">Encomendas, etapas, volumes e stock num só lugar — do corte à picagem.</p>
          <ul className="space-y-3 pt-2 text-sm">
            {[["Produção por volume", Layers], ["Qualidade por categoria", ShieldCheck], ["Picagem com código GestãoClick", ScanLine]].map(([t, I]: any) => (
              <li key={t} className="flex items-center gap-3">
                <span className="grid size-8 place-items-center rounded-lg bg-primary-foreground/15"><I className="size-4" /></span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative text-xs text-primary-foreground/60">© UP Móveis</div>
      </aside>

      <main className="flex items-center justify-center p-5 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center lg:items-start lg:text-left">
            <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-elevated lg:hidden">
              <Factory className="size-6" />
            </div>
            <h2 className="text-2xl font-extrabold">Bem-vindo de volta</h2>
            <p className="mt-1 text-sm text-muted-foreground">Inicie sessão para aceder à produção.</p>
          </div>
          <div className="rounded-2xl border bg-card p-6 shadow-soft">
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
            <TabsList className="grid w-full grid-cols-2 mb-6 h-11 rounded-full p-1">
              <TabsTrigger value="operador" className="rounded-full gap-2 font-semibold"><HardHat className="size-4" />Operador</TabsTrigger>
              <TabsTrigger value="admin" className="rounded-full gap-2 font-semibold"><ShieldCheck className="size-4" />Gestão</TabsTrigger>
            </TabsList>
            <TabsContent value="operador">
              <form onSubmit={onOperatorSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="op-code">Código</Label>
                  <Input
                    id="op-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    autoFocus
                    placeholder="Ex: 01"
                    className="text-xl h-14 rounded-xl bg-muted/40 font-mono uppercase tracking-widest text-center"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="op-pin">PIN (6 dígitos)</Label>
                  <Input
                    id="op-pin"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    required
                    placeholder="••••••"
                    className="text-2xl h-14 rounded-xl bg-muted/40 font-mono tracking-[0.5em] text-center"
                  />
                </div>
                <Button type="submit" className="w-full h-12 rounded-xl text-base font-semibold shadow-elevated gap-2" disabled={opLoading}>
                  {opLoading ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}{opLoading ? "A entrar…" : "Entrar"}
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="admin">
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" className="h-12 rounded-xl bg-muted/40" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" inputMode="email" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Palavra-passe</Label>
                  <Input id="password" className="h-12 rounded-xl bg-muted/40" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
                </div>
                <Button type="submit" className="w-full h-12 rounded-xl text-base font-semibold shadow-elevated gap-2" disabled={loading}>
                  {loading ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}{loading ? "A entrar…" : "Entrar"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
          </div>
          <p className="text-xs text-muted-foreground text-center mt-6">
            Sem acesso? Contacte o administrador.
          </p>
        </div>
      </main>
    </div>
  );
}
