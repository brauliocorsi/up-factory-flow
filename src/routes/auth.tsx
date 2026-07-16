import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Factory } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" ? s.next : "",
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/" });
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
    navigate({ to: fallback, replace: true });
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
    const email = `op-${code.trim().toLowerCase()}@upmoveis.local`;
    const { error } = await supabase.auth.signInWithPassword({ email, password: pin });
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
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Sessão iniciada");
    goNext("/");
  }

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-background to-accent p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto size-12 rounded-lg bg-primary text-primary-foreground grid place-items-center mb-2">
            <Factory className="size-6" />
          </div>
          <CardTitle>UP Produção</CardTitle>
          <CardDescription>Inicie sessão para aceder ao chão de fábrica</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="operador">Operador</TabsTrigger>
              <TabsTrigger value="admin">Admin</TabsTrigger>
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
                    className="text-xl h-12 font-mono uppercase tracking-widest text-center"
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
                    className="text-2xl h-12 font-mono tracking-[0.5em] text-center"
                  />
                </div>
                <Button type="submit" className="w-full h-11" disabled={opLoading}>
                  {opLoading ? "A entrar…" : "Entrar"}
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="admin">
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" inputMode="email" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Palavra-passe</Label>
                  <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
                </div>
                <Button type="submit" className="w-full h-11" disabled={loading}>
                  {loading ? "A entrar…" : "Entrar"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
          <p className="text-xs text-muted-foreground text-center mt-4">
            Sem acesso? Contacte o administrador.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}