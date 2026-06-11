import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { LayoutGrid, ListOrdered, LogOut, Factory, Upload, Library, Boxes, HardHat, Settings, Wrench, PackageCheck, ClipboardCheck, Clock, Barcode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutGrid },
  { to: "/producao", label: "Produção", icon: HardHat },
  { to: "/picagem", label: "Picagem", icon: Barcode },
  { to: "/retrabalho", label: "Retrabalho", icon: Wrench },
  { to: "/encomendas", label: "Encomendas", icon: ListOrdered },
  { to: "/stock", label: "Stock", icon: Boxes },
  { to: "/stock/produto-final", label: "Produto final", icon: PackageCheck },
  { to: "/importar", label: "Importar", icon: Upload },
  { to: "/admin/catalogo", label: "Catálogo", icon: Library },
  { to: "/admin/qualidade", label: "Qualidade", icon: ClipboardCheck },
  { to: "/admin/sla", label: "SLA", icon: Clock },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="flex h-14 items-center px-4 gap-3">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-md bg-primary text-primary-foreground grid place-items-center">
              <Factory className="size-5" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-bold">UP Produção</div>
              <div className="text-[10px] text-muted-foreground hidden sm:block">UP Móveis</div>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-1 ml-6">
            {nav.map((n) => {
              const active = n.to === "/" ? pathname === "/" : pathname.startsWith(n.to);
              return (
                <Link key={n.to} to={n.to} className={`px-3 py-2 rounded-md text-sm font-medium transition ${active ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto">
            <Button variant="ghost" size="sm" onClick={signOut} className="gap-2">
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Sair</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 pb-20 md:pb-6">{children}</main>

      {/* Bottom nav (mobile) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t bg-card overflow-x-auto">
        <div className="flex min-w-max">
          {nav.map((n) => {
            const active = n.to === "/" ? pathname === "/" : pathname.startsWith(n.to);
            const Icon = n.icon;
            return (
              <Link key={n.to} to={n.to} className={`flex-1 min-w-[72px] flex flex-col items-center justify-center gap-1 py-3 text-[11px] ${active ? "text-primary" : "text-muted-foreground"}`}>
                <Icon className="size-5" />
                {n.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}