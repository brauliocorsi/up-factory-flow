# Aba de Encomendas: planeamento, prioridade e trabalho do dia

## Objetivo
Um separador de planeamento na página de Encomendas onde o escritório decide o que está **Ativo** na produção e o que fica apenas **Planeado**, com 3 graus de prioridade (Urgente, Média, Baixa) sempre visíveis a quem produz.

## O que vai existir

### 1. Prioridade em 3 graus
- Reaproveita o campo numérico já existente: 3 = Urgente, 2 = Média, 1 = Baixa (0 tratado como Baixa).
- Badge colorido consistente em toda a app: Urgente (vermelho), Média (âmbar), Baixa (neutro).
- Alteração da prioridade a partir da lista de encomendas (menu rápido por linha) e em lote para as linhas selecionadas.
- Só admin e escritório podem alterar; operadores e picadores apenas veem.

### 2. Separador "Planeamento" dentro de Encomendas
Tabela com filtros (pesquisa, modelo, prioridade, estado, data de saída) e seleção múltipla, mostrando por encomenda:
- Estado de planeamento: **Planeado/Ativo** (visível e a produzir no chão de fábrica) ou **Pendente** (não planeado, não aparece na produção).
- Prioridade, data de saída, data-alvo da etapa mais antecipada, e sinalização de atraso.
Ações em lote: **Planear/Ativar** (passa a Ativo → entra na produção), **Tirar de planeamento** (volta a Pendente, só se nenhuma etapa já foi iniciada), **Definir prioridade**.

**Planeado = Ativo**: uma encomenda "planeada" está ativa para produzir; as "não planeadas" ficam Pendente e não surgem no chão de fábrica.

### 3. Trabalho do dia (folgas nunca bloqueiam)
Filtro rápido "Hoje" nesse separador, com a regra:
- Etapas finais (estofagem, qualidade, embalagem, picagem) entram no dia pela **data de saída**.
- Casco/estrutura, corte, costura e branco entram **antecipadamente**, pela data-alvo calculada com as folgas por etapa já configuradas em Planeamento > Folgas.

As folgas são **apenas orientação de planeamento**, nunca uma travagem:
- Qualquer etapa pode ser iniciada assim que a etapa anterior estiver concluída, mesmo que a data-alvo ainda esteja no futuro — se o casco, o branco e o corte/costura acabaram antes do previsto, o estofador adianta-se.
- A única condição para avançar é a sequência: passo anterior concluído (e o material reservado, como já hoje acontece).
- Encomendas adiantadas aparecem no ecrã de produção com etiqueta "adiantada" em vez de serem escondidas do posto.

### 4. Barra de urgentes no chão de fábrica
Faixa fixa no topo do ecrã de produção com as encomendas Urgentes ativas (número da encomenda, produto, etapa atual, data de saída), visível a todos os utilizadores, independentemente do posto selecionado. Pode ser recolhida, mas não desativada.

## Detalhes técnicos
- Migração: nada de novas colunas; apenas normalizar `production_orders.priority` para o domínio 1–3 (valores >3 passam a 3, 0 passa a 1) e índice em `(priority DESC, due_date)`.
- Server fns em `src/lib/orders.functions.ts`: `setOrdersPriority` (lote) e `deactivateOrders` (volta a `pendente`, valida que não existe `order_stages` com `started_at`), ambas com verificação de role admin/escritório igual ao padrão de `assertAdminOrOffice`. A ativação reutiliza `activateOrders` já existente.
- Nova fn `listPlanningOrders` que devolve encomendas com prioridade, estado, `due_date` e datas-alvo por etapa (via `get_stage_target_dates`), mais um sinalizador `due_today` calculado com as folgas por etapa.
- Nova fn `listUrgentActive` para a faixa de urgentes; leitura mínima de colunas, acessível a qualquer utilizador autenticado.
- UI: `src/routes/_authenticated/encomendas.index.tsx` passa a ter Tabs (Lista | Planeamento); novos componentes `src/components/planning/PlanningTable.tsx`, `PriorityBadge.tsx`, `PrioritySelect.tsx`, e `src/components/production/UrgentBar.tsx` integrado em `producao.index.tsx`.
- Ordenação por prioridade aplicada também à fila prioritária por etapa (desempate: prioridade, depois data-alvo).
- Toda a interação usa `useServerFn` + React Query com invalidação de `orders`, `dashboard`, `stage-queue` e `production`.
