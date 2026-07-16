import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

// Local typed wrapper — supabase.auth.oauth namespace is beta.
type AuthorizationDetails = {
  client?: { name?: string; client_id?: string } | null;
  redirect_uri?: string | null;
  scope?: string | null;
  redirect_url?: string;
  redirect_to?: string;
};
type OAuthResult = { data: AuthorizationDetails | null; error: { message: string } | null };
function oauthApi() {
  return (supabase.auth as unknown as {
    oauth: {
      getAuthorizationDetails: (id: string) => Promise<OAuthResult>;
      approveAuthorization: (id: string) => Promise<OAuthResult>;
      denyAuthorization: (id: string) => Promise<OAuthResult>;
    };
  }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Falta authorization_id");
    const { data } = await supabase.auth.getSession();
    const next = location.pathname + location.searchStr;
    if (!data.session) throw redirect({ to: "/auth", search: { next } });
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauthApi().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: ConsentPage,
  errorComponent: ({ error }) => (
    <main className="min-h-screen grid place-items-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>Não foi possível carregar este pedido</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {String((error as Error)?.message ?? error)}
          </p>
        </CardContent>
      </Card>
    </main>
  ),
});

function ConsentPage() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const api = oauthApi();
    const { data, error } = approve
      ? await api.approveAuthorization(authorization_id)
      : await api.denyAuthorization(authorization_id);
    if (error) { setBusy(false); setError(error.message); return; }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) { setBusy(false); setError("O servidor de autorização não devolveu um redirect."); return; }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? "Aplicação externa";

  return (
    <main className="min-h-screen grid place-items-center bg-gradient-to-br from-background to-accent p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Ligar {clientName} à UP Produção</CardTitle>
          <CardDescription>
            Isto permite que {clientName} use esta app em teu nome. As permissões e políticas do backend continuam a aplicar-se.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {details?.redirect_uri && (
            <p className="text-xs text-muted-foreground break-all">
              Redirect: {details.redirect_uri}
            </p>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => decide(true)} disabled={busy}>
              {busy ? "A processar…" : "Aprovar"}
            </Button>
            <Button className="flex-1" variant="outline" onClick={() => decide(false)} disabled={busy}>
              Recusar
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}