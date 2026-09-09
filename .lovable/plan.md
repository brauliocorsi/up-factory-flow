# Planeamento por tempo útil de trabalho

## Objetivo
Definir um tempo de produção por modelo (com destaque para a estofagem) e usar esse tempo no planeamento diário e semanal, para ver de imediato se o dia cabe no tempo útil dos trabalhadores presentes.

## O que vai passar a existir

### 1. Tempo de produção por modelo
Novo separador "Tempo por modelo" na área de tempos, com a lista de modelos (Cama, Sommier, ...) e um campo de minutos por operação, com a estofagem em primeiro lugar. Guarda direto na tabela de tempos por modelo que já existe, por isso os tempos já definidos mantêm-se.

- Cada linha mostra: categoria, modelo, minutos de estofagem e (opcional) das restantes operações.
- Modelos sem tempo de estofagem aparecem marcados a laranja com "Sem tempo definido".
- Só admin/escritório podem editar.

### 2. Planeamento diário: cabe ou não cabe
Em cada dia mostramos:
- Tempo útil disponível = jornada diária × número de pessoas presentes nessa operação nesse dia (usa as presenças já existentes).
- Tempo necessário = soma dos tempos dos produtos com data-alvo nesse dia.
- Resultado: verde (sobra), âmbar (perto do limite, 80–100%), vermelho (excede), com os minutos que faltam ou sobram.

### 3. Vista de semana
Nova vista "Semana" no ecrã de carga: linhas = operações, colunas = segunda a sexta, cada célula com percentagem e cor, mais uma linha de total da semana. Setas para avançar/retroceder semanas.
Ao clicar numa célula abre a lista das encomendas desse dia nessa operação, com os minutos de cada uma e o total, para se poder mover a data de saída ou tirar do planeamento até o dia ficar verde.

### 4. Aviso ao ativar produção
No separador Planeamento, ao ativar encomendas mostramos o efeito no dia da estofagem: minutos a acrescentar e se o dia passa a exceder o tempo disponível. A ativação continua permitida (é aviso, não bloqueio), mantendo a regra de que as folgas orientam mas nunca travam.
Encomendas cujo modelo não tem tempo de estofagem aparecem com aviso "tempo desconhecido — carga subestimada".

## Detalhes técnicos
- Sem novas colunas: o tempo por modelo reutiliza `stage_sla_model` (`category_code`, `model_code`, `stage`, `expected_minutes`) e a herança já implementada em `get_expected_minutes` (produto > modelo > categoria).
- Nova RPC `get_week_capacity_plan(_from date, _to date)` (SECURITY DEFINER, `search_path=public`, execução revogada a `anon`): devolve por operação e dia `capacity_minutes`, `load_minutes`, `items_count`, `has_unknown`, `over_minutes`; reaproveita a lógica de capacidade/carga de `get_global_capacity_load` (presenças + `daily_minutes` + `stage_lead_offsets`).
- Nova RPC `get_day_stage_orders(_stage, _date)` para o detalhe da célula (encomenda, produto, modelo, minutos, estado, data de saída).
- Novas server fns em `src/lib/planning.functions.ts`: `getWeekCapacityPlan`, `getDayStageOrders`; e em `src/lib/sla.functions.ts`: `listModelStageTimes` / `upsertModelStageTime` (verificação admin/escritório server-side, padrão `assertAdminOrOffice`).
- UI: novo componente `src/components/planning/WeekLoadGrid.tsx` + `DayLoadDialog.tsx`, integrados em `admin.planeamento.carga.tsx` (abas Dia | Semana), reutilizando `LoadCell`; separador "Tempo por modelo" em `admin.sla.tsx`.
- `PlanningTable.tsx` ganha coluna "Min. estofo" e o aviso de impacto na ativação; invalidação React Query de `stage-capload`, `week-capload`, `orders` e `planning`.
