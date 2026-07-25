## Objetivo

Tornar o quadro de Produção mais visual para o operador em duas frentes:

1. **Fila de Prioritárias como barra lateral** — sempre visível ao lado da lista da etapa ativa, com número da encomenda + estado de prioridade (no prazo / atrasada / risco de saída), em vez de um painel largo por cima.
2. **Distinguir claramente o estado de cada encomenda na etapa** (não iniciada / em curso / pausada / concluída) e garantir que o cronómetro corre sem reiniciar.

---

## 1. Barra lateral "Fila prioritária"

Ficheiros:
- `src/components/planning/StageQueuePanel.tsx` — nova variante `variant="sidebar"` mais compacta (uma coluna estreita, sticky). Cada linha:
  - Badge colorido de prioridade: verde (no prazo), âmbar (atrasada) ou vermelho (risco de saída).
  - `order_number` grande e monoespaçado.
  - Data-alvo por baixo em texto pequeno.
  - Clicar na linha faz scroll até ao cartão correspondente da lista principal (`document.getElementById(...)`).
- `src/routes/_authenticated/producao.index.tsx` — passar a página para grelha `lg:grid-cols-[1fr_280px]`:
  - Coluna principal: identificação + tabs + filtros + lista de cartões (StageCard/StageGroupView).
  - Coluna lateral (sticky top): `<StageQueuePanel stage={activeStage} variant="sidebar" />`.
  - Em mobile (`<lg`), a barra colapsa para um botão "Fila prioritária (N)" que abre um `Sheet` com o mesmo conteúdo (evita ocupar altura preciosa no telefone).
- Adicionar `id={`stage-card-${item.id}`}` no `Card` do `StageCard` para permitir scroll a partir da barra lateral.

## 2. Estado visível + cronómetro correto

**Problema atual:** o filtro "Só prontas para iniciar" está ligado por defeito e esconde as encomendas com `status === "em_curso"` e `concluida`, por isso o operador não vê o que já começou. Em etapas como Branco, o cartão desaparece ao clicar "Iniciar".

Ficheiros:
- `src/routes/_authenticated/producao.index.tsx`:
  - Trocar o toggle único "Só prontas para iniciar" por **três chips de estado**, todos ligados por defeito: `Não iniciadas` · `Em curso` · `Concluídas hoje`. O filtro "Só as minhas etapas" mantém-se.
  - `isReadyToStart` deixa de ser usado como filtro — passa a controlar apenas se o botão Iniciar está ativo dentro do cartão.
  - Ajustar `getProductionData` (`src/lib/production.functions.ts`) para incluir também etapas `concluida` de coli único quando finalizadas nas últimas 12 h (para poderem aparecer na chip "Concluídas hoje"). Sem isto a chip fica sempre vazia.
  - No `StageCard`, adicionar uma faixa de estado no topo bem visível:
    - `NÃO INICIADA` (cinza) · `A PRODUZIR` (verde) · `EM PAUSA` (âmbar) · `CONCLUÍDA` (esmeralda) · `BLOQUEADA` (vermelho).
    - Cor da borda esquerda já reflete isto, mas passa a haver texto grande no cabeçalho para leitura rápida.
  - Ordenar a lista da etapa por estado: primeiro `em_curso`, depois `pendente`, depois `concluida`.

**Cronómetro:**
- Verificar em runtime que `current_segment_started_at` está a ser preenchido corretamente após um `iniciar`/`retomar` (função server já lê `stage_time_logs`). O `setInterval(1s)` no componente pai só força re-render — o cálculo `liveSeconds` na `StageCard` já usa `Date.now() - segmentStartMs`, portanto não deve reiniciar. Se o utilizador reportar reset, a causa mais provável é o `refetchInterval: 30000` a devolver `productive_seconds` inconsistente enquanto o segmento corre; solução: ao atualizar, se `running && segmentStartMs`, manter o `productive_seconds` do snapshot anterior se for maior. Adicionar essa guarda em `StageCard` via `useRef` do último `productive_seconds` visto para o `id`.

## Verificação

- `tsgo` limpo.
- Abrir `/producao` em Branco: iniciar uma encomenda → o cartão continua visível com faixa verde "A PRODUZIR" e o cronómetro sobe segundo a segundo; pausar → faixa âmbar; finalizar → aparece em "Concluídas hoje".
- Barra lateral mostra a mesma encomenda com badge de prioridade; clicar salta para o cartão.
- Mobile: barra lateral colapsada num Sheet acessível pelo botão "Fila prioritária".

## Fora do âmbito

- Regras de priorização (já vêm de `get_stage_queue`).
- Retrabalho, colis multi-coli e agrupamento Corte/Estrutura mantêm-se como estão.
