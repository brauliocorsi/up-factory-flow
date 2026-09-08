# UP Fábrica — Entrega da versão candidata (pré-lançamento)

Data: 08/09/2026. Não publicado. Esta versão é candidata a testes operacionais.

## 1. O que mudou nesta sequência

### Retrabalho (etapa 07)
- O pedido de retrabalho bloqueia a encomenda enquanto corre, para dois pedidos ao mesmo tempo não se atropelarem.
- Repetir o pedido nos primeiros 2 minutos devolve o mesmo registo, em vez de criar outro.
- Produto já transferido para o armazém externo não pode ser reaberto por aqui: aparece uma mensagem a pedir correção administrativa.
- Passa a ser possível mandar apenas um volume para trás, mantendo os outros a avançar.
- Reparar deixa de dispensar as etapas anteriores.
- A versão antiga da função foi removida (não fica nada exposto em paralelo).

### Stock (etapa 08)
- "Consumir tecido" bloqueia a encomenda: dois cliques rápidos deixam de dar baixa a dobrar.
- Anular consumo deixa de apagar o registo: fica marcado como anulado, com autor e data, e permite consumir de novo.
- Ajustes de stock recusam valores inválidos, meias-unidades em cascos/capas e baixas abaixo do que está reservado.

### Importação (etapa 09)
- Cada importação passa a ter um identificador próprio guardado na base (tabela de lotes).
- Clique repetido ou resposta perdida devolve o mesmo lote, com aviso, sem criar encomendas a dobrar.
- Acrescentar mais unidades à mesma encomenda do cliente continua possível, preparando nova importação.

### Picagem e transferência (etapas 10 e 11)
- Só encomendas realmente preparadas no lote podem ser registadas como enviadas.
- Antes de marcar enviado, a base volta a confirmar volumes todos picados e encomenda não cancelada; as recusadas aparecem no ecrã.
- A lista de "por enviar" deixa de depender de um limite cego: uma encomenda antiga continua a aparecer mesmo com centenas já enviadas.

### Metas e listas grandes (etapa 12)
- As metas de tempo já não são cortadas nos primeiros 500 pares; vão até 5000, em lotes, sem repetições.
- Listas de picagens concluídas e envios confirmados percorrem todas as páginas.

## 2. Ficheiros e funções tocados
- `src/lib/orders.functions.ts`, `src/routes/_authenticated/encomendas.importar-simples.tsx`
- `src/lib/picking.functions.ts`, `src/lib/sla.functions.ts`, `src/lib/stock.functions.ts`
- Base de dados: `send_to_rework`, `enforce_stage_sequence`, `consume_fabric_for_order`, `undo_fabric_consumption`, `adjust_stock_atomic`, `record_picking_dispatch`, nova tabela de lotes de importação, novas colunas de anulação de consumo.

## 3. Resultados reais de verificação
- Tipos: 0 erros.
- Páginas abertas com sucesso: produção, encomendas, importar, picagem, histórico de picagem, relatórios, stock de tecidos, rotas de volumes, qualidade.
- Verificador de segurança da base: 44 avisos, iguais à linha de base (funções que validam permissões dentro delas próprias).

## 4. Dependências externas e limites
- Recetor de stock real não testado: só o caminho local foi verificado.
- Leitor de código de barras e impressora não testados fisicamente.
- Base real pequena (94 encomendas), pelo que não há medições de desempenho com histórico grande.

## 5. Estado por tema

| Tema | Estado |
|---|---|
| F07 Retrabalho | Implementado — falta teste real no posto |
| F09 Stock | Implementado — falta ensaio da última unidade em simultâneo |
| F12 Importação | Corrigido e verificado (repetição devolve o mesmo lote) |
| F06/F15 Transferência e picagem | Implementado — falta recetor e leitor reais |
| F13 Limites e paginação | Corrigido e verificado |
| F14 Tempos por pessoa | Pendente — exige novo histórico por intervalos nos volumes |
| Fecho global de permissões e regressão completa | Pendente |

## 6. Recuperação
Se algo correr mal num ensaio: marcar as encomendas de teste como teste, cancelar as que não devem seguir, e anular consumo de tecido pela ação própria (fica histórico). Nenhuma ação desta entrega apaga registos.

## 7. Primeiro teste a fazer
Ver `TESTES-MANUAIS.md`, percurso 1 (uma cama de teste do início ao fim).
