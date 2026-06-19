## Fase A — Planeamento puxado pela data de saída (revisto)

Motor de planeamento que parte do `due_date` e calcula PARA TRÁS as datas-alvo de cada etapa. Operador nunca é bloqueado — só recebe badge (verde/amarelo/vermelho). Capacidade por etapa × dia. Datas-alvo NUNCA gravadas: calculadas ao vivo.

---

### 1. Base de dados (1 migração)

**Tabelas novas**

- `stage_lead_offsets(stage production_stage PK, days_before_estofo int NOT NULL DEFAULT 0)`
  - Seed: `estrutura=2, corte=2, branco=1, costura=1, estofagem=0, qualidade=0, embalagem=0, picagem=0`.
- `stage_day_assignment(operator_id uuid, stage production_stage, work_date date, present bool default true, PK(operator_id, stage, work_date))`.

**`app_settings`**: chave `planning.daily_minutes` (default `450`).

**RLS/GRANT**
- `stage_lead_offsets`: SELECT a `authenticated`; ALL apenas admin (`has_role`).
- `stage_day_assignment`: SELECT a `authenticated`; INSERT/UPDATE/DELETE só admin.
- GRANTs explícitos a `authenticated` + `service_role`.

**Funções (SECURITY DEFINER, search_path=public)**

- `add_business_days(_d date, _n int) returns date` — soma/subtrai dias úteis (seg–sex).
- `prev_business_day(_d date) returns date` — recua até sexta se cair em sáb/dom.
- `get_stage_target_dates(_order_id uuid) returns table(stage, target_date date, status text)`
  - `base := prev_business_day(due_date)` (normaliza fins de semana).
  - `target_date(etapa) := add_business_days(base, -offset)`.
  - `target_estof := target_date('estofagem')`.
  - **Status por etapa (régua dupla):**
    - `risco_saida` se `current_date > target_estof` OU `current_date > due_date`.
    - `atrasada_folga` se `current_date > target_date` da própria etapa (mas ainda `<= target_estof`).
    - `ok` caso contrário.
- `get_stage_queue(_stage production_stage) returns jsonb` — fila ordenada por `target_date asc`, com order_id, customer_order, product_description, target_date, due_date, status, expected_minutes. Filtra `production_orders.status IN ('pendente','em_producao')` e `order_stages.status <> 'concluida'`.
- `get_stage_capacity_load(_stage production_stage, _from date, _to date) returns jsonb` — para cada dia:
  - `capacity_minutes` = presentes (de `stage_day_assignment`, fallback `operator_stages`) × `daily_minutes`.
  - `load_minutes` para `dia > current_date`: soma de `expected_minutes` cujas `target_date == dia`.
  - `load_minutes` para `dia == current_date`: peças com `target_date == hoje` **+ todas as etapas ainda não concluídas com `target_date < hoje` (atrasado acumulado)**.
  - `items_count`, `has_unknown` (true se alguma peça contou como 0 por SLA NULL).
  - Documentar: "carga = planeado do dia + atrasado acumulado no dia de hoje".

**Camada C**: novas funções não expõem receita/stock/custo.

---

### 2. Backend (`src/lib/planning.functions.ts`)

Server fns autenticados:
- `listLeadOffsets`, `upsertLeadOffset` (admin).
- `getDailyMinutes`, `setDailyMinutes` (admin).
- `getStageTargetDates({ order_id })`.
- `getStageQueue({ stage, limit?, offset? })` — paginação.
- `getStageCapacityLoad({ stage, from, to })`.
- `listDayAssignments({ from, to })`, `setDayPresence({ operator_id, stage, work_date, present })` (admin).

Verificação admin via `rpc('has_role', { _role: 'admin' })` nas fns admin.

---

### 3. UI

**Admin — `/admin/planeamento`** (nova rota, gate admin)
- Aba "Folgas" — tabela editável `stage_lead_offsets`.
- Aba "Jornada" — input `daily_minutes`.
- Aba "Presenças do dia" — quadro etapa × operador para `work_date` selecionável.

**Operador — `/producao` (extensão)**
- Painel "Fila prioritária" por etapa: top 20 + botão "Ver todas" (paginação ou expandir). Nunca esconder trabalho.
- `StageGroupView` (corte/estrutura): mostrar `target_date` do grupo = mínima do grupo, com badge.
- `OrderCard`: pill com data-alvo da etapa atual + badge.

**Admin — `/admin/planeamento/carga`**
- Selector de etapa + intervalo (próx 14 dias).
- Tabela/gráfico dia × {capacidade, carga, %}. Verde ≤80%, amarelo 80–100, vermelho >100.
- Banner "alguns produtos sem SLA — carga subestimada" quando `has_unknown` em qualquer dia.
- Nota visível: "Hoje inclui trabalho atrasado por concluir".

---

### 4. TODOs no código

- Eficiência por operador via `stage_time_logs` × SLA teórico.
- Fase B: planner drag-and-drop.
- Fase C: encaixe automático de lotes.
- Feriados (tabela de exceções para `add_business_days`).

---

### 5. Não tocar

Produção, convergência, picagem, lotes, importador simples, agrupamentos, Camada C.

### 6. Verificação final

- Migração: GRANTs + RLS em ambas as tabelas novas.
- `/admin/planeamento` só admin; `/producao` sem regressão para operador.
- `get_stage_queue` não devolve campos sensíveis.
- Smoke: criar encomenda com due_date numa segunda → target_date estrutura cai na quarta anterior; due_date num sábado → base vira sexta antes de recuar.
