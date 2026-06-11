# Contador de tempo contínuo na Produção

## Problema

No card de uma etapa em curso, o tempo mostrado avança bem enquanto a aba está aberta, mas quando o utilizador muda para outra etapa e volta, o contador "reinicia" para o valor que o servidor tem guardado em `productive_seconds`.

Causa: `productive_seconds` em `order_stages` só é atualizado nos eventos `pausar` / `finalizar`. Enquanto a etapa está a correr, o cliente só conhece esse valor antigo e usa `Date.now()` do momento do mount como referência — ao remontar (mudar de aba e voltar), a referência é reposta e o tempo "atual" perdido.

## Solução (mínima, sem mexer no schema)

Derivar no servidor o instante em que o segmento ativo começou (último `iniciar` ou `retomar` em `stage_time_logs`), e usar isso no cliente como âncora estável.

### Servidor — `src/lib/production.functions.ts`

1. Adicionar campo `current_segment_started_at: string | null` ao tipo `ProductionStageOrder`.
2. Em `getProductionData`, após carregar as etapas, para as que estão `em_curso` e não `is_paused`, fazer uma query a `stage_time_logs`:
   - filtrar por `order_stage_id in (...)` e `event in ('iniciar','retomar')`,
   - ordenar por `event_at desc`,
   - manter o mais recente por `order_stage_id`.
3. Preencher `current_segment_started_at` com esse `event_at` (ou `null` quando não aplicável: pausada, bloqueada, pendente, concluída).

### Cliente — `src/routes/_authenticated/producao.index.tsx` (`StageCard`)

1. Remover o `baselineRef` baseado em `Date.now()` no mount.
2. Calcular `liveSeconds`:
   - se `running` e `current_segment_started_at` existir:
     `productive_seconds + max(0, floor((Date.now() - new Date(current_segment_started_at).getTime()) / 1000))`
   - caso contrário: `productive_seconds`.
3. Manter o `tick` de 1s já existente para forçar o re-render.
4. Manter a lógica de avisos SLA (80% / excedido) inalterada — passa a usar este `liveSeconds` correto e contínuo.

## Resultado esperado

- Mudar de aba e voltar mantém o tempo a crescer sem saltos para trás.
- Pausar / retomar / finalizar continuam a comportar-se como hoje (o servidor reinicia o segmento no `retomar`).
- Sem alterações de base de dados nem nas server functions de escrita.
