
# Plano — UP Produção (Prompt 1)

App web mobile-first para gerir etapas de produção de estofos da UP Móveis. Este prompt cria a base: Lovable Cloud, modelo de dados, autenticação, Dashboard Kanban em tempo real e Lista de Encomendas. Importação Excel, tela de operação e picagem ficam para os próximos prompts.

## 1. Backend (Lovable Cloud)

Ativar Lovable Cloud e criar migration única com:

**Enums**
- `production_stage`: estrutura, corte, costura, branco, estofagem, qualidade, embalagem, picagem
- `order_status`: pendente, em_producao, concluida, cancelada
- `stage_status`: pendente, em_curso, concluida, bloqueada
- `app_role`: admin, operador, escritorio

**Tabelas (todas em `public` com GRANTs + RLS)**
- `user_roles` (user_id, role) + função `has_role` SECURITY DEFINER (padrão Lovable, evita recursão).
- `operators` — code, name, role, active.
- `models` — name, code, active.
- `production_orders` — order_number (único), barcode, product_description, model_id, measure, fabric_type, fabric_ref, color, structure_type, entry_date, due_date, status, priority, notes, created_by, created_at.
- `order_stages` — order_id, stage, status, started_at, finished_at, operator_id, duration_minutes, check_valid, notes. Unique(order_id, stage).
- `semi_finished_stock` — stage, model_id, description, quantity, min_quantity, location, updated_at.

**Políticas RLS**
- Authenticated: SELECT em tudo.
- `production_orders` / `order_stages`: INSERT/UPDATE para operador e escritorio.
- `operators` / `models` / `semi_finished_stock`: CRUD só admin.
- `user_roles`: SELECT do próprio; admin gere.

**Triggers**
- `calc_duration`: BEFORE UPDATE em `order_stages`, quando status → concluida calcula `duration_minutes`.
- `enforce_estofagem_flow`: BEFORE UPDATE em `order_stages` para stage=estofagem; se novo status=em_curso, verifica que estrutura E costura da mesma encomenda estão `concluida` + `check_valid=true`; caso contrário força `bloqueada` e levanta aviso.
- `create_default_stages`: AFTER INSERT em `production_orders` cria as 8 etapas com status=pendente.

**Realtime**
- `production_orders` e `order_stages` adicionados à publication `supabase_realtime`.

**Seed (via insert tool após migration)**
- 3 operadores estofadores (códigos 01, 02, 03).
- 4 modelos: Armani, Lisa, Dubai, Gomos.
- 5 encomendas exemplo em etapas diferentes (manipular `order_stages` para encenar Kanban povoado, incluindo 1 atrasada e 1 bloqueada).

## 2. Auth

- Página pública `/auth` — login email+password (sem signup público).
- Layout protegido em `src/routes/_authenticated/route.tsx` (gerido pela integração Supabase, `ssr: false`, redirect `/auth`).
- `attachSupabaseAuth` em `src/start.ts`.
- Hook `useAuth` lê sessão + role via `has_role` (server fn).
- Listener `onAuthStateChange` único em `__root.tsx` (invalida router + queries em SIGNED_IN/OUT/USER_UPDATED).

## 3. Rotas e UI

Todas as páginas de app sob `_authenticated/`:

- `/` — **Dashboard Kanban** (`_authenticated/index.tsx`)
  - 4 cards topo: pendentes, em produção, concluídas hoje, bloqueadas.
  - Kanban com 8 colunas (uma por etapa). Cartão = encomenda na etapa atual (etapa mais avançada não concluída).
  - Cartão: nº, descrição, modelo, tempo na etapa (relativo, pt-PT), borda vermelha se due_date passou, badge de prioridade.
  - Subscrição Realtime nas duas tabelas → invalida `["dashboard"]`.
  - **Mobile (<768px)**: tabs horizontais com scroll por etapa, mostra lista vertical de cartões da etapa selecionada.
- `/encomendas` (`_authenticated/encomendas.tsx`)
  - Tabela: Nº, Produto, Modelo, Medida, Tecido, Entrada, Saída prevista, Estado, Etapa atual.
  - Filtros: estado, modelo, intervalo de datas. Pesquisa por nº.
  - Mobile: cartões empilhados em vez de tabela.

**Layout app**
- Top bar com logo "UP Produção", nome do utilizador, botão sair.
- Bottom nav fixa no mobile (Dashboard, Encomendas); sidebar no desktop.

## 4. Design

- Tailwind + shadcn/ui. Inter via `@import` em `styles.css`.
- Tema claro, acento `--primary` = #2563EB (em oklch), radius 8px (0.5rem).
- Tokens semânticos no `styles.css` (background, foreground, card, primary, destructive p/ atrasos, muted, success p/ concluído).
- Mobile-first: targets de toque ≥44px, tipografia legível à distância, espaçamentos generosos.

## 5. Server functions / data

- `src/lib/orders.functions.ts` — `listOrders(filters)`, `getDashboardData()` (cards + grupos por etapa) com `requireSupabaseAuth`.
- `src/lib/operators.functions.ts` (placeholder, usado depois).
- TanStack Query: loaders chamam `ensureQueryData`; componentes usam `useSuspenseQuery`. `defaultPreloadStaleTime: 0` já configurado.

## 6. Fora do âmbito (próximos prompts)

Importação Excel, tela de operação (código + iniciar/finalizar), stock detalhado, picagem por scanner, integração externa.

## Detalhes técnicos

```
src/
  routes/
    __root.tsx                       (listener auth, providers)
    auth.tsx                         (login)
    _authenticated/
      route.tsx                      (gate, gerido pela integração)
      index.tsx                      (Dashboard Kanban)
      encomendas.tsx                 (Lista)
  components/
    AppShell.tsx, BottomNav.tsx, Sidebar.tsx
    kanban/KanbanBoard.tsx, KanbanColumn.tsx, OrderCard.tsx, MobileStageTabs.tsx
    orders/OrdersTable.tsx, OrderFilters.tsx, OrderCardMobile.tsx
    stats/StatCards.tsx
  hooks/useAuth.ts, useRealtime.ts
  lib/
    orders.functions.ts
    format.ts                        (datas/tempo pt-PT, formatDistance)
    validations.ts                   (schemas Zod, prep p/ futuros forms)
supabase/migrations/<timestamp>_init_up_producao.sql
```

Validação Zod preparada (schemas em `validations.ts`) mesmo que neste prompt não haja forms de criação — fica pronto para o prompt 2.
