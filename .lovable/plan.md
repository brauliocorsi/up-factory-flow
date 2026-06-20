## Fase B — Quadro do planeador (backlog, ativar em lote, carga firme + sombra) — revisto

Apenas ADIÇÕES. Não toca em Fase A, produção, picagem, lotes, importador.

---

### 1. Base de dados (1 migração)

Sem tabelas novas. Apenas funções (SECURITY DEFINER, `search_path = public`):

- `get_backlog()` returns jsonb — encomendas `status = 'pendente'` com `order_id`, `customer_order`, `order_number`, `product_description`, `model_name`, `measure`, `structure_type`, `color`, `fabric_type`, `due_date`, `target_estrutura`, `target_estof`, `status` (ok/atrasada_folga/risco_saida, mesma régua que `get_stage_target_dates`). Ordena por `due_date asc, customer_order`.
- `get_activation_suggestions()` returns jsonb — agrupa backlog cujo `target` da 1ª etapa relevante (`estrutura` ou `corte`) `<= current_date + 5 dias úteis`. Dois eixos:
  - corte: `model_id + measure + fabric_type`
  - estrutura: `structure_type + measure`
  Devolve grupos com `key`, `kind`, `order_ids[]`, `count`, `earliest_target`, `earliest_due_date`.
- `get_global_capacity_load(_from date, _to date)` returns jsonb — para cada etapa em (`estrutura`,`corte`,`costura`,`branco`,`estofagem`,`qualidade`,`embalagem`) × cada dia útil no intervalo:
  - `capacity_minutes` (mesma lógica que Fase A)
  - `load_firm_minutes` — peças `production_orders.status = 'em_producao'` com `target_date == dia` **dentro de [_from,_to]**, + atrasado acumulado no dia de hoje (peças `em_producao`, `os.status <> 'concluida'`, `target_date < hoje`).
  - `load_shadow_minutes` — peças `status = 'pendente'` com `target_date == dia` **estritamente dentro de [_from,_to]** (nada fora da janela, nada de atrasado acumulado — backlog não tem compromisso firme).
  - `items_firm`, `items_shadow`, `has_unknown`.
- `activate_orders(_order_ids uuid[])` returns jsonb — exige admin **ou** escritório (`has_role(auth.uid(),'admin') OR has_role(auth.uid(),'escritorio')`; senão `RAISE EXCEPTION 'forbidden'`). Para cada id `pendente`: `try_reserve_for_order(id)`; sucesso → `status='em_producao'`. Já `em_producao` → skip. Falha individual → `failed[]` com `reason`. Devolve `{ activated:[], skipped:[], failed:[{order_id,reason}] }`.

GRANTs `EXECUTE` a `authenticated` em todas as quatro. Role check de `activate_orders` é dentro da função.

Camada C: nenhuma destas funções devolve receita/stock/custo.

---

### 2. Backend (`src/lib/planning.functions.ts`, estender)

Server fns autenticados:

- `getBacklog()`, `getActivationSuggestions()`, `getGlobalCapacityLoad({from,to})`.
- `activateOrders({ order_ids })` — `assertAdminOrOffice(context)` antes do RPC (defesa em profundidade; check final é no SQL).

Sem alterações às fns da Fase A.

---

### 3. UI

**Gate de acesso (firme)** — `/admin/planeamento` **inteiro** (Folgas, Jornada, Presenças, Backlog, Carga global) restrito a admin/escritório. Implementar `beforeLoad` no ficheiro de rota que verifica role via `useMySession`/RPC `has_role`; se não admin/escritório → `redirect('/')`. Mesmo gate em `/admin/planeamento/carga`. Operador continua a ver apenas a sua fila em `/producao` (Fase A).

**Aba "Backlog"**
- Bloco "Sugestões para ativar" no topo: cards com `kind`, contagem, prazo mais próximo, badge risco, botão "Ativar grupo".
- Tabela: checkbox + nº cliente + produto + medida + tecido + estrutura + due_date + badge status. Header com "Ativar selecionadas (N)".
- Após `activateOrders`: toast `X ativadas, Y falhadas`; lista expansível das falhas.
- Invalida `["backlog"]`, `["activation-suggestions"]`, `["global-load"]`, e queries Fase A relevantes.

**Aba "Carga global"**
- Selector de intervalo (default próximos 10 dias úteis).
- Tabela: linhas = etapas, colunas = dias. Cada célula é um `LoadCell` com:
  - Barra **firme** sólida (largura = firm/cap).
  - **Sombra** tracejada sobreposta a seguir à firme (largura = shadow/cap, encavalitada quando excede cap).
  - Cor da célula baseada em **firm/cap apenas**: verde ≤80%, amarelo 80–100, vermelho >100. **A sombra nunca dispara cor.**
  - Quando `firm+shadow > cap` e `firm/cap ≤ 100%`: **contorno tracejado vermelho** subtil à volta da barra como aviso "potencial sobrecarga se ativares o backlog". Distinto do vermelho sólido.
  - Texto: `firm/cap min` em destaque, `+shadow` em cinza claro.
- Legenda fixa: "sólido = ativado (stock reservado) · tracejado = backlog previsto · contorno tracejado = potencial sobrecarga se ativares".
- Banner `has_unknown` quando aplicável.
- Clicar etapa → `/admin/planeamento/carga?stage=...` (Fase A; pequena extensão para ler `search` e pré-selecionar).

**Componentes novos**: `src/components/planning/LoadCell.tsx`, `BacklogTable.tsx`, `ActivationSuggestions.tsx`.

---

### 4. TODOs

- Fase C: encaixe automático de encomendas novas em lotes já agendados.
- Sombra "what-if" por grupo de sugestão (quanto absorveria se ativado).

---

### 5. Verificação

- Migração inclui GRANTs `EXECUTE`.
- `/admin/planeamento` e `/admin/planeamento/carga` bloqueiam operador/picador no `beforeLoad`.
- `activate_orders` rejeita operador/picador (server-side, testar via SQL).
- Smoke: ativar uma peça do backlog → sai da sombra e entra no firme, **soma total `firm+shadow` mantém-se constante** no dia.
- Smoke: dia com firme baixo + sombra alta → célula **verde/amarela pela régua do firme**, sombra visível, contorno tracejado vermelho se `firm+shadow > cap`.
- Sombra nunca conta peças com `target_date` fora de `[from,to]` nem atraso acumulado.
- Sem regressão em Fase A / produção / picagem / lotes / importador.
