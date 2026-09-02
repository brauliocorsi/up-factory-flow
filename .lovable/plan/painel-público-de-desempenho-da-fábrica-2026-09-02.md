# Painel público de desempenho da fábrica

Nova página de ecrã (TV) com URL público protegido por código de acesso, que mostra em tempo quase-real o ritmo de produção do dia e quem está a trabalhar em quê. O dashboard interno atual fica inalterado.

## O que o painel mostra

Layout de ecrã cheio, pensado para TV, dividido em duas colunas.

Coluna esquerda — desempenho do dia:

- Semáforo grande verde/vermelho (o índice principal), com percentagem e um contador que sobe/desce em tempo real.
- Relógio do turno: em que bloco de trabalho estamos, quantos minutos úteis já passaram e quantos faltam.
- Três cartões secundários:
  - Ritmo: minutos produtivos registados hoje vs minutos úteis já decorridos.
  - Encomendas do dia: concluídas vs previstas para hoje (data de saída).
  - SLA: tempo esperado vs tempo real das etapas concluídas hoje.
- Barra/gráfico por bloco horário do dia (8:00–10:00, 10:15–12:00, 13:30–16:00, 16:15–17:30) pintada a verde quando o bloco cumpriu e vermelho quando não.

Coluna direita — operadores em tempo real:

- Um cartão por operador ativo com apenas nome do operador e encomenda ativa (número), estado (a produzir / em pausa) e cronómetro a correr.
- Nada de dados técnicos (tecido, medida, receita, stock).

## Horário de trabalho usado nas contas

```text
08:00 - 10:00   trabalho   120 min
10:00 - 10:15   pausa
10:15 - 12:00   trabalho   105 min
12:00 - 13:30   almoço
13:30 - 16:00   trabalho   150 min
16:00 - 16:15   pausa
16:15 - 17:30   trabalho    75 min
                total útil 450 min/dia
```

Os minutos úteis decorridos são calculados a partir da hora atual (Lisboa), ignorando pausas. Fora do horário o painel mostra o resumo fechado do dia. Fins de semana mostram "sem turno".

## Semáforo (verde/vermelho)

Índice principal = ritmo do dia, ponderado pelo número de operadores presentes:

```text
esperado  = minutos_úteis_decorridos x operadores_ativos
realizado = minutos produtivos registados hoje
índice    = realizado / esperado
```

- Verde: índice ≥ 90%
- Amarelo: 75–90%
- Vermelho: < 75%

Os cartões de Encomendas do dia e de SLA têm o mesmo código de cores e servem de contexto; o semáforo grande é o do ritmo.

## Acesso

- Rota pública `/painel` que pede um código de acesso (aceito também via `?c=CODIGO` para configurar a TV uma vez).
- O código é guardado como segredo do backend e validado no servidor a cada pedido de dados. Sem código válido, nenhum dado é devolvido.
- O painel não abre acesso anónimo às tabelas: os dados só saem por esta função de servidor, já agregada e sem campos sensíveis.

## Atualização em tempo real

- Cronómetros e o relógio do turno correm localmente no ecrã (atualização por segundo), sem pedidos ao servidor.
- Os dados agregados são recarregados a cada 10 segundos.
- Nota: subscrição direta à base de dados a partir do browser exigiria abrir leitura anónima às tabelas de produção, o que contraria as restrições de segurança já implementadas. O efeito visual é equivalente (cronómetros a correr + refresh curto), mantendo os dados fechados.

## Detalhes técnicos

Backend:
- Nova migração: nada de esquema novo; apenas uma função SQL agregadora `get_public_factory_panel()` (SECURITY DEFINER, `search_path = public`, EXECUTE revogado a `anon`/`public`) que devolve JSON com: índice de ritmo, minutos produtivos do dia, encomendas do dia (previstas/concluídas), agregado de SLA do dia, buckets por bloco horário e a lista de operadores ativos (nome, número de encomenda, etapa, pausado, `started_at`).
- Segredo `FACTORY_PANEL_CODE` para o código de acesso.
- `src/lib/publicPanel.functions.ts`: `getPublicPanel` (server fn pública, sem `requireSupabaseAuth`) que valida o código contra o segredo, e só depois chama a função SQL através do cliente privilegiado carregado dentro do handler.

Frontend:
- `src/routes/painel.tsx`: rota pública (fora de `_authenticated`), com `head()` próprio (título/descrição, `noindex`), ecrã de introdução do código e o painel.
- `src/components/panel/ShiftClock.tsx`, `PerformanceGauge.tsx`, `ShiftBlocksChart.tsx`, `LiveOperatorsPanel.tsx`.
- `src/lib/shift.ts`: definição dos blocos horários, minutos úteis decorridos, bloco atual — reutilizável e testável.
- Cores por tokens semânticos do tema (verde/âmbar/vermelho), tipografia grande para leitura à distância, layout responsivo mobile-first que escala para TV.

Fora de âmbito: alterações ao dashboard interno `/`, novos KPIs internos e permissões de operador.
