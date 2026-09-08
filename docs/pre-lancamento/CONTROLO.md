# Controlo das 14 etapas de pré-lançamento

Atualizado: 08/09/2026. Contrato: `CONTRATO.md`.

## 1. Situação inicial verificada

- Revisão de código atual (candidata a testes): `72eb957f71864b5fd09d08a970490021a6e41379` (07/09/2026 23:51 UTC). A revisão da auditoria (`1a72067…d021e`) já não é a atual: as Fases 0–6 do plano anterior foram aplicadas depois dela.
- Commit publicado: **não identificável** pelas ferramentas disponíveis. Só é comparável por observação do URL publicado; nesta sequência não se publica.
- Base de dados: projeto único `yihgqoanxgkpiomgruxo`. **Preview e app publicada usam a mesma base.** Não há isolamento; ensaios têm de usar fixtures/marcação de teste.
- Migrações: 20 ficheiros em `supabase/migrations`, as últimas de 07/09/2026 (permissões, sequência de etapas, volumes, qualidade, picagem/despachos, indicadores).
- Recuperação de dados: sem cópia recuperável verificada por nós. O único mecanismo confirmado é o point-in-time/backup gerido pela plataforma de base de dados, **não verificado nem testado**. Ponto de recuperação de código (commit acima) não é cópia de dados. Antes de qualquer migração que altere dados existentes: exportar as tabelas envolvidas para ficheiro e registar contagens antes/depois.
- Verificações disponíveis e resultado de partida:
  - Tipos: `bunx tsgo --noEmit` → **0 erros**.
  - Lint: `bunx eslint .` → **4756 erros / 21 avisos, quase todos `prettier/prettier` (formatação) pré-existentes**. Linha de base; não introduzir novos.
  - Não existe suite de testes automatizados no projeto (sem `vitest` configurado). Testes de regressão terão de ser criados nas etapas seguintes.
  - Linter da base reporta avisos recorrentes de `SECURITY DEFINER` (pré-existentes, ver etapa 14).

## 2. Números atuais (leitura da base, 08/09/2026)

| Medida | Auditoria 07/09 | Agora |
|---|---|---|
| OP | 94 | 94 |
| Volumes (`order_colis`) | 253 | 253 |
| Volumes sem etapas | 251 | **0** |
| OP afetadas | 92 | **0** |
| Configurações de rota sem etapas | 12 | **12 (ainda em aberto)** |
| Etapas por OP / por volume | — | 752 / 2024 |
| Checklists ativos | CAM, SOF, GEN | CAM, SOF, GEN |
| Despachos de picagem | — | 0 |

Estados de OP: 89 em produção, 3 pendentes, 2 concluídas. OP marcadas como teste: 0.

OP 16758 (2 volumes) e 16906 (3 volumes): **já têm etapa de picagem em todos os volumes**, nenhuma picada ainda. O problema original está resolvido; a picagem está por fazer, não em falta.

## 3. Matriz de perfis e ações (estado atual a preservar)

Perfis (`app_role`): `admin` (1 utilizador), `escritorio` (1), `operador` (4), `picador` (1).

| Ação | admin | escritório | operador | picador |
|---|---|---|---|---|
| Iniciar/pausar/concluir etapas do seu posto | sim (exceção administrativa) | não | sim, só do posto atribuído e como próprio | não |
| Agrupar/concluir grupo (estrutura, corte) | sim | não | sim, no seu posto | não |
| Conferência de qualidade | sim | não | sim, se atribuído a qualidade | não |
| Imprimir etiqueta | sim | sim | sim, no seu posto | sim |
| Picagem (ler volumes) | sim | sim | não | sim |
| Enviar lote / reconciliar | sim | sim | não | sim |
| Ajuste de stock, cancelamento, conclusão de produção para stock | sim | sim | não | não |
| Importar, editar OP, prioridades, datas, backlog | sim | sim | não | não |
| Gestão de utilizadores/operadores e catálogos | sim | parcial (catálogos) | não | não |
| Configurações (modo de identificação) | sim | não | não | não |

Modo de identificação atual: `sessao` (operador resolvido pela conta autenticada). O modo `codigo` (posto partilhado) continua a existir no código.

Leituras que os postos precisam e que hoje podem estar tapadas por `block_operators`: checklists de qualidade e itens, modelos/referências/rolos de tecido no corte, `app_settings`. A rever na etapa 02, distinguindo "sem configuração", "sem stock" e "sem permissão".

## 4. Nível de execução por etapa (funcionamento atual, verificado)

Todas as 8 etapas existem por volume, com 253 registos cada: estrutura, corte, costura, branco, estofagem, qualidade, embalagem, picagem. `order_stages` (752 registos) funciona como **resumo derivado** da OP.

- Por volume, com avanço independente: estrutura, corte, costura, branco, estofagem, embalagem, picagem.
- Agrupáveis (opcional, sem deixar de existir cartão individual): estrutura e corte.
- Qualidade: existe por volume, mas a decisão de aprovação é da OP com o checklist da família (a firmar na etapa 05).
- Conclusão de produção: embalagem de **todos** os volumes.
- Dependências reais (não a ordem do enum): estrutura→branco; corte→costura; estrutura+corte+branco+costura→estofagem; estofagem→qualidade→embalagem→picagem.

## 5. Registo das 14 etapas

| # | Etapa | Estado | Ficheiros/funções previstos | Migração | Evidência | Pendências |
|---|---|---|---|---|---|---|
| 01 | Base verificável e controlo | **Concluída** | `docs/pre-lancamento/*` | não | leituras da base, tipos OK, linha de base de lint | recuperação de dados não verificada; commit publicado não identificado |
| 02 | Autorização servidor + SQL, leituras dos postos | **Concluída (parcial declarada)** | `production.functions.ts` (`updateAppSettings`, `setOperatorStages`), SQL `assert_picking_actor`, `scan_picking_coli`, `start_shell_batch`, `repair_missing_coli_stages`, `assert_operator_is_session`, políticas `block_operators`/`block_pickers` | 4 migrações (08/09/2026) | tipos 0 erros; `/`, `/producao`, `/picagem`, `/admin/qualidade`, `/stock/tecidos`, `/encomendas` → 200; linter da base sem novos avisos (44 = linha de base) | 5 operadores ativos sem conta ligada (03, 04, 07, 09, 10) ficam bloqueados no modo `sessao` até serem ligados; escritas diretas em `production_orders`/`order_stages` ainda por substituir (etapa 14); sem ensaio com utilizador de cada perfil (só uma conta por perfil na base real) |
| 03 | Coerência etapas OP/volume, rotas, reparação | **Parcial** | `create_order_colis` | 1 migração (08/09/2026) | função reescrita idempotente (acrescenta volumes/etapas em falta, sem duplicar); 0 volumes sem etapas | 12 rotas sem etapas continuam por configurar; `sync_order_stage_from_colis` e reparação por OP ainda a rever no resto da etapa 03 |

| 04 | Eventos de etapa idempotentes e concorrentes | Não iniciada | `record_stage_event`, `record_coli_stage_event` | prevista | — | — |
| 05 | Qualidade CAMA/SOFÁ | Não iniciada | `quality.functions.ts`, `QualityCheckDialog.tsx`, admin de qualidade | prevista | — | — |
| 06 | Impressão pós-qualidade e na embalagem | Não iniciada | `PrintLabelButton`, `ProductionLabel`, rota de impressão | não prevista | — | validação física da etiqueta |
| 07 | Retrabalho | Não iniciada | `send_to_rework`, `finished_goods` | prevista | — | — |
| 08 | Stock: consumo, reserva, ajuste | Não iniciada | `undo_fabric_consumption`, `try_reserve_for_order`, `adjust_stock_atomic` | prevista | — | — |
| 09 | Importação e edição de identidade | Não iniciada | `bulkImportSimpleOrders`, `updateOrder` | prevista | — | — |
| 10 | Picagem por volume | Não iniciada | `picking.functions.ts`, `scan_picking_coli` | prevista | — | teste com leitor real |
| 11 | Transferência para stock | Não iniciada | `sendPickingBatchToStock`, `record_picking_dispatch`, `listPendingDispatch` | prevista | — | recetor real |
| 12 | Limites, paginação e SLA em lote | Não iniciada | `sla.functions.ts` (`getExpectedForOrders`), consultas de listas | possível (índices) | — | — |
| 13 | Tempos por pessoa e ajustes de interface | Não iniciada | `analytics.functions.ts`, `producao.index.tsx` | não prevista | — | — |
| 14 | Fecho de permissões, integridade e regressão integrada | Não iniciada | inventário global | prevista | — | avisos `SECURITY DEFINER` |

## 6. Regras de ensaio nesta sequência

Base única partilhada: qualquer OP criada para ensaio é marcada com `is_test = true` (ação já existente em Encomendas) e nunca se usam OP reais para ações irreversíveis. Envio de lote só contra recetor simulado.
