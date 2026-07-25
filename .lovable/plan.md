## Objetivo
Adicionar barra de pesquisa e filtros globais no dashboard (`/`), aplicados às vistas **Kanban**, **Lista** e **Mobile**.

## Filtros
- **Pesquisa** por nº encomenda (também aceita `customer_order`) e descrição do produto
- **Modelo** (dropdown, ex.: cama Alice, Luxúria…) — reutiliza `listModels()`
- **Tecido** (dropdown) — carregado via `ref_fabric_types` já existente
- **Medida** (dropdown) — carregado via `ref_measures`
- **Etapa atual** (dropdown com as 8 etapas)

Todos combináveis, com botão "Limpar".

## Alterações

### `src/lib/orders.functions.ts`
- `DashboardOrder`: adicionar `measure: string | null`, `fabric_type: string | null`, `customer_order: string | null`.
- `getDashboardData`: incluir `measure, fabric_type, customer_order` no `.select(...)` e no card devolvido.

### `src/routes/_authenticated/index.tsx`
- Adicionar componente `<DashboardFilters>` acima das Tabs, com estado local `{ q, modelId, fabric, measure, stage }`.
- Carregar opções de filtros em paralelo com `useQuery` (`listModels`, `listRefTypes('fabric_types')`, `listRefTypes('measures')`) — usar helpers já existentes em `catalog.functions.ts` (verifico e reutilizo, senão adiciono um endpoint mínimo).
- Aplicar `filterOrders(data, filters)` — função pura que devolve `DashboardData` filtrado (mantém `byStage` e recalcula subset). Passar o resultado para `KanbanBoard`, `MobileStageView` e `OrdersListView`.
- Quando `stage` está definido, esvaziar as outras colunas para o Kanban mostrar só uma; na Lista/Mobile filtra as linhas.

### `src/components/dashboard/OrdersListView.tsx`
- Remover o input local de pesquisa (fica redundante com o filtro global). A vista passa a listar apenas o que o pai já filtrou.

### Kanban/Mobile
- Sem alterações — recebem `DashboardData` filtrado por `byStage`.

## Notas técnicas
- Filtros são case-insensitive, funcionam offline sobre o payload já em memória (sem refetch).
- Etapa: se seleccionada, `byStage` só mantém essa chave preenchida.
- Estado no cliente (sem URL params) para manter o scope pequeno; posso trocar para `validateSearch` depois se pedires.
