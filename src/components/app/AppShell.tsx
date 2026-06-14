import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutGrid, ListOrdered, LogOut, Factory, Upload, Library, Boxes, HardHat,
  Settings, Wrench, PackageCheck, ClipboardCheck, Clock, Barcode, ChevronDown,
  Menu, Shield, Package, Truck, BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useMySession } from "@/hooks/useMySession";

/**
 * Estrutura agrupada da navegação.
 * - Itens "soltos" (sem grupo) aparecem como botão único no topo.
 * - Grupos aparecem como dropdown no desktop e como secção no menu mobile.
 */
type NavItem = { to: string; label: string; icon: typeof LayoutGrid };
type NavGroup = { label: string; icon: typeof LayoutGrid; items: NavItem[] };

const primary: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutGrid },
];

const groups: NavGroup[] = [
  {
    label: "Produção",
    icon: HardHat,
    items: [
      { to: "/producao", label: "Produção", icon: HardHat },
      { to: "/picagem", label: "Picagem", icon: Barcode },
      { to: "/retrabalho", label: "Retrabalho", icon: Wrench },
    ],
  },
  {
    label: "Encomendas",
    icon: ListOrdered,
    items: [
      { to: "/encomendas", label: "Encomendas", icon: ListOrdered },
      { to: "/importar", label: "Importar", icon: Upload },
    ],
  },
  {
    label: "Stock",
    icon: Package,
    items: [
      { to: "/stock", label: "Stock geral", icon: Boxes },
      { to: "/stock/produto-final", label: "Produto final", icon: PackageCheck },
    ],
  },
  {
    label: "Administração",
    icon: Shield,
    items: [
      { to: "/admin/catalogo", label: "Catálogo", icon: Library },
      { to: "/admin/relatorios", label: "Relatórios", icon: BarChart3 },
      { to: "/admin/rotas-colis", label: "Rotas Colis", icon: Truck },
      { to: "/admin/qualidade", label: "Qualidade", icon: ClipboardCheck },
      { to: "/admin/sla", label: "SLA", icon: Clock },
      { to: "/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
];

// Atalhos rápidos para a barra inferior em mobile (5 slots no máx.)
const mobileQuick: NavItem[] = [
  { to: "/", label: "Início", icon: LayoutGrid },
  { to: "/producao", label: "Produção", icon: HardHat },
  { to: "/encomendas", label: "Encomendas", icon: ListOrdered },
  { to: "/stock", label: "Stock", icon: Boxes },
];

function isActive(pathname: string, to: string) {
  if (to === "/") return pathname === "/";
  // /stock não deve marcar /stock/produto-final como activo
  if (to === "/stock") return pathname === "/stock" || pathname.startsWith("/stock/");
  return pathname === to || pathname.startsWith(to + "/");
}

function groupActive(pathname: string, group: NavGroup) {
  return group.items.some((i) => isActive(pathname, i.to));
}

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);
  const { role, operator } = useMySession();
  const isOperator = role === "operador";

  // Filtragem por role: operador só vê Produção/Picagem/Retrabalho.
  const visiblePrimary = isOperator ? [] : primary;
  const visibleGroups = isOperator
    ? groups
        .filter((g) => g.label === "Produção")
        .map((g) => ({
          ...g,
          items: g.items.filter((i) =>
            ["/producao", "/picagem", "/retrabalho"].some(
              (p) => i.to === p || i.to.startsWith(p + "/"),
            ),
          ),
        }))
    : groups;
  const visibleMobileQuick = isOperator
    ? mobileQuick.filter((n) =>
        ["/producao", "/picagem", "/retrabalho"].some(
          (p) => n.to === p || n.to.startsWith(p + "/"),
        ),
      )
    : mobileQuick;
  const homeLink = isOperator ? "/producao" : "/";

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
        <div className="flex h-14 items-center px-3 sm:px-4 gap-2 sm:gap-3">
          <Link to={homeLink} className="flex items-center gap-2 shrink-0">
            <div className="size-8 rounded-md bg-primary text-primary-foreground grid place-items-center shadow-sm">
              <Factory className="size-5" />
            </div>
            <div className="leading-tight hidden xs:block sm:block">
              <div className="text-sm font-bold">UP Produção</div>
              <div className="text-[10px] text-muted-foreground hidden sm:block">
                {isOperator && operator ? operator.name : "UP Móveis"}
              </div>
            </div>
          </Link>

          {/* Desktop nav: item solto + dropdowns por grupo */}
          <nav className="hidden md:flex items-center gap-1 ml-4">
            {visiblePrimary.map((n) => {
              const active = isActive(pathname, n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition ${
                    active ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-accent"
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
            {visibleGroups.map((g) => {
              const active = groupActive(pathname, g);
              return (
                <DropdownMenu key={g.label}>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition outline-none ${
                        active ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-accent"
                      }`}
                    >
                      {g.label}
                      <ChevronDown className="size-3.5 opacity-70" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[14rem]">
                    <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {g.label}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {g.items.map((i) => {
                      const Icon = i.icon;
                      const itemActive = isActive(pathname, i.to);
                      return (
                        <DropdownMenuItem key={i.to} asChild>
                          <Link
                            to={i.to}
                            className={`flex items-center gap-2 cursor-pointer ${
                              itemActive ? "bg-accent text-accent-foreground font-medium" : ""
                            }`}
                          >
                            <Icon className="size-4 text-muted-foreground" />
                            <span>{i.label}</span>
                          </Link>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            {/* Mobile: botão "Menu" abre sheet com tudo organizado */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="sm" className="md:hidden gap-2">
                  <Menu className="size-5" />
                  <span className="sr-only">Menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[86%] max-w-sm p-0 flex flex-col">
                <SheetHeader className="px-4 py-4 border-b">
                  <SheetTitle className="flex items-center gap-2 text-left">
                    <div className="size-8 rounded-md bg-primary text-primary-foreground grid place-items-center">
                      <Factory className="size-5" />
                    </div>
                    <div className="leading-tight">
                      <div className="text-sm font-bold">UP Produção</div>
                      <div className="text-[10px] text-muted-foreground font-normal">UP Móveis</div>
                    </div>
                  </SheetTitle>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto p-3 space-y-5">
                  {visiblePrimary.length > 0 && (
                    <div>
                      <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Principal
                      </div>
                      <div className="space-y-0.5">
                        {visiblePrimary.map((n) => (
                          <MobileLink key={n.to} item={n} pathname={pathname} onNavigate={() => setMobileOpen(false)} />
                        ))}
                      </div>
                    </div>
                  )}

                  {visibleGroups.map((g) => (
                    <div key={g.label}>
                      <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {g.label}
                      </div>
                      <div className="space-y-0.5">
                        {g.items.map((i) => (
                          <MobileLink key={i.to} item={i} pathname={pathname} onNavigate={() => setMobileOpen(false)} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="p-3 border-t">
                  <Button variant="outline" size="sm" onClick={signOut} className="w-full gap-2">
                    <LogOut className="size-4" />
                    Sair
                  </Button>
                </div>
              </SheetContent>
            </Sheet>

            <Button variant="ghost" size="sm" onClick={signOut} className="gap-2 hidden md:inline-flex">
              <LogOut className="size-4" />
              <span>Sair</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 pb-20 md:pb-6">{children}</main>

      {/* Bottom nav (mobile) — 4 atalhos + Menu */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${Math.min(visibleMobileQuick.length + 1, 5)}, minmax(0, 1fr))` }}
        >
          {visibleMobileQuick.map((n) => {
            const active = isActive(pathname, n.to);
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] transition ${
                  active ? "text-primary font-medium" : "text-muted-foreground"
                }`}
              >
                <Icon className={`size-5 ${active ? "" : "opacity-80"}`} />
                <span className="truncate max-w-full px-1">{n.label}</span>
              </Link>
            );
          })}
          <button
            onClick={() => setMobileOpen(true)}
            className={`flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] transition ${
              mobileOpen ? "text-primary font-medium" : "text-muted-foreground"
            }`}
          >
            <Menu className="size-5" />
            <span>Menu</span>
          </button>
        </div>
      </nav>
    </div>
  );
}

function MobileLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate: () => void;
}) {
  const active = isActive(pathname, item.to);
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition ${
        active ? "bg-primary text-primary-foreground font-medium shadow-sm" : "hover:bg-accent text-foreground"
      }`}
    >
      <Icon className={`size-4 ${active ? "" : "text-muted-foreground"}`} />
      <span>{item.label}</span>
    </Link>
  );
}