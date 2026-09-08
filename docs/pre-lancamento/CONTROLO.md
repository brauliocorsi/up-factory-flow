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
| 03 | Coerência etapas OP/volume, rotas, reparação | **Concluída (parcial declarada)** | `create_order_colis`, `sync_order_stage_from_colis`, `admin.rotas-colis.tsx` | 2 migrações (08/09/2026) | resumo da OP recalculado sempre a partir dos volumes (retrabalho limpa conclusão); linha de resumo criada quando falta; 0 volumes sem etapas; aviso no ecrã de rotas para volumes sem etapas | 12 rotas CAM 01–04 continuam sem etapas configuradas (usam percurso completo até serem definidas); ensaios formais 1–4 volumes ainda não executados em base de teste |

| 04 | Eventos de etapa idempotentes e concorrentes | **Concluída (parcial declarada)** | `record_coli_stage_event` | 1 migração (08/09/2026) | "Iniciar" em volume pausado passa a contar como retoma (pausa contabilizada); encomenda cancelada rejeita todos os eventos; idempotência mantida com bloqueio `FOR UPDATE` | ensaios de concorrência real (dois inícios/duas finalizações simultâneas) ainda não executados |
| 05 | Qualidade CAMA/SOFÁ | **Concluída (parcial declarada)** | `quality.functions.ts` (`getQualityFamilies`, `submitQualityCheck`), `QualityCheckDialog.tsx` | 1 migração (08/09/2026: `family_code`, `intent_id`) | duas bases ativas confirmadas (CAM 7 itens, SOF 8 itens); sugestão automática por categoria/referência/descrição com correção manual e confirmação antes de perder respostas; submissão repetida devolve a mesma conferência; base vazia impede aprovação | histórico com cópia da versão do checklist limitado à cópia dos itens respondidos; ensaios manuais no posto ainda não feitos |
| 06 | Impressão pós-qualidade e na embalagem | **Concluída (parcial declarada)** | `PrintLabelButton.tsx`, `QualityCheckDialog.tsx`, `producao.index.tsx` | não prevista | após aprovação surge confirmação com "Imprimir etiqueta" e "Fechar"; mensagem deixa de afirmar impressão feita; iframe só é limpo no fim da impressão (ou após 120 s) e existe atalho para abrir a página da etiqueta | validação física de tamanho/leitura da etiqueta não realizada |
| 07 | Retrabalho | **Concluída (parcial declarada)** | `send_to_rework`, `enforce_stage_sequence` | 2 migrações (08/09/2026) | bloqueio da OP durante o pedido; pedido repetido nos 2 min devolve o mesmo evento; produto já transferido bloqueia com mensagem clara; âmbito opcional por volume; retrabalho deixa de dispensar as etapas anteriores; versão antiga da função removida | ensaios reais de retrabalho depois de qualidade/embalagem por operador ainda não executados |
| 08 | Stock: consumo, reserva, ajuste | **Concluída (parcial declarada)** | `consume_fabric_for_order`, `undo_fabric_consumption`, `adjust_stock_atomic`, `stock.functions.ts` | 1 migração (08/09/2026: `fabric_consumptions.reverted_at/reverted_by`) | consumo bloqueia a OP (duplo clique não dá baixa duas vezes); anulação passa a marcar (histórico preservado) e permite novo consumo; ajustes recusam valores inválidos, decimais em cascos/capas e baixas abaixo do reservado | concorrência na última unidade de casco/capa ainda não ensaiada |
| 09 | Importação e edição de identidade | **Concluída (parcial declarada)** | `bulkImportSimpleOrders`, `encomendas.importar-simples.tsx` | 1 migração (tabela `import_batches`) | intenção persistente por importação: clique repetido/resposta perdida devolve o lote anterior sem criar unidades novas; resumo do ficheiro guardado; acréscimo deliberado continua possível com nova preparação | edição autorizada de identidade com reconciliação total (receita/reservas/volumes/etiqueta) permanece limitada ao bloqueio já existente após início |
| 10 | Picagem por volume | **Parcial** | `picking.functions.ts`, `scan_picking_coli` | reutiliza etapas anteriores | leitura devolve erro previsto sem ecrã branco; estados persistentes já existentes mantidos; confirmação de envio revalidada na base | distinção explícita "Confirmação manual do próximo volume" e ensaios entre dois dispositivos ainda pendentes; teste com leitor real pendente |
| 11 | Transferência para stock | **Concluída (parcial declarada)** | `record_picking_dispatch`, `sendPickingBatchToStock`, `listPendingDispatch` | 1 migração (08/09/2026) | só encomendas preparadas no lote podem ser registadas; antes de marcar enviado a base revalida volumes picados e não cancelamento; recusas devolvidas ao ecrã; pendentes deixam de depender de um limite cego | recetor real não testado (apenas caminho local); reconciliação automática de resultados incertos continua manual, por decisão |
| 12 | Limites, paginação e SLA em lote | **Concluída (parcial declarada)** | `sla.functions.ts` (`getExpectedForOrders`), `listPendingDispatch` | não | metas deixam de ser cortadas nos primeiros 500 pares (até 5000, em lotes de 50, sem repetições); envios confirmados e picagens concluídas percorrem todas as páginas | medições de desempenho com histórico grande não realizadas (base real pequena: 94 OP) |
| 13 | Tempos por pessoa e ajustes de interface | **Concluída (parcial declarada)** | `coli_stage_time_logs`, `coli_stage_work_intervals`, `record_coli_stage_event`, `labor_by_person`, `analytics.functions.ts` (`getLaborByPersonDaily`), `admin.relatorios.tsx` | 1 migração (08/09/2026) | cada arranque/pausa/retoma/fim de volume passa a ficar registado com a pessoa; períodos de trabalho efetivo guardados com início e fim; novo quadro "Mão de obra por pessoa e por dia" reparte o tempo por dia (Europe/Lisbon), divide trabalho que atravessa a meia-noite, exclui encomendas de teste e exporta CSV; leitura e consulta restritas a admin/escritório; tipos 0 erros; `/admin/relatorios`, `/producao`, `/encomendas` → 200 | histórico só existe a partir desta migração (dias anteriores continuam a ser lidos pelo quadro antigo "Tempo por pessoa", baseado no total por volume); ensaios com vários operadores em simultâneo e verificação de um turno completo ainda não feitos |
| 14 | Fecho de permissões, integridade e regressão integrada | **Parcial** | inventário global, `docs/pre-lancamento/ENTREGA.md`, `TESTES-MANUAIS.md` | não | versões antigas de funções removidas onde detetadas; execução anónima revogada; tipos 0 erros; rotas principais 200 | regressão integrada de 14 percursos e matriz de perfis por chamadas diretas pendentes; 44 avisos `SECURITY DEFINER` mantidos por decisão (funções autorizam internamente) |

## 6. Regras de ensaio nesta sequência

Base única partilhada: qualquer OP criada para ensaio é marcada com `is_test = true` (ação já existente em Encomendas) e nunca se usam OP reais para ações irreversíveis. Envio de lote só contra recetor simulado.
