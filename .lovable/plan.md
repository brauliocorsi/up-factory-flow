# Plano de produção e cálculo por hora

## Objetivo
Transformar o planeamento num quadro de decisão: **o que fazer primeiro, quando fazer e se a equipa tem tempo disponível**. Manter as encomendas, os volumes, o histórico e os circuitos atuais.

## 1. Plano de produção mais profissional
- Organizar a área em **Encomendas a planear**, **Plano semanal** e **Carga por posto**, sem duplicar listas.
- Mostrar no topo: encomendas planeadas, saídas em atraso, horas necessárias, horas disponíveis e produtos sem tempo definido.
- Apresentar uma matriz semana × posto, com horas em vez de grandes totais em minutos, ocupação e excesso de carga.
- Abrir cada dia/posto para consultar as encomendas que justificam a carga; manter as ações existentes de datas, prioridade e ativação.
- Simplificar a lista para encomenda, produto, prioridade, saída e situação; recolher as restantes informações e ações.
- Reutilizar a ordem da fila prioritária existente, para não apresentar uma ordem diferente no escritório e aos operadores.
- Filtros coerentes: semana, posto, planeadas/por planear, prioridade, atraso e pesquisa por encomenda/produto.
- Distinguir **sem equipa**, **sem tempo definido**, **carga excedida** e **dentro da capacidade**. Não anunciar um plano como viável quando faltam tempos.

## 2. Nova tela «Cálculo de produção»
O tipo de cálculo aguarda a sua resposta: **custo**, **capacidade**, ou **ambos**.

### Capacidade, se escolhida
- Selecionar modelo/produto, etapa, quantidade e colaboradores.
- Usar os tempos por modelo já definidos; permitir ajustes apenas na simulação, identificados como tal.
- Indicar horas úteis disponíveis por colaborador no período, descontando pausas quando ainda não estejam descontadas.
- Mostrar horas de trabalho necessárias, horas disponíveis, unidades completas possíveis e horas em falta/sobra.
- Separar horas de mão de obra de duração em calendário: duas pessoas não reduzem automaticamente todas as etapas para metade.
- Não contar o mesmo colaborador a tempo inteiro em vários postos na mesma simulação.

### Custo, se escolhido
- Introduzir o valor/hora de cada colaborador e o tempo de mão de obra por etapa.
- Mostrar custo por etapa, custo de mão de obra por unidade e total do lote.
- Valores/hora ficam apenas na simulação nesta primeira versão; não inventar salários nem alterar fichas de colaboradores.
- Identificar o resultado como **custo de mão de obra**, não custo total do produto: materiais, energia e despesas gerais ficam fora.

### Comum
- Resultado detalhado por etapa, com campos numéricos claros e unidades explícitas (min, h, €/h).
- Tempo desconhecido não vale zero: resultado incompleto, com identificação das etapas em falta.
- A simulação não altera datas, prioridades, tempos oficiais ou encomendas.
- Disponível a admin/escritório, seguindo as permissões atuais; custos não são mostrados aos operadores.

## 3. Limites desta primeira versão
- Sem alterações ao ERP, à Picagem, ao stock, às etiquetas ou aos registos existentes.
- Sem prometer planeamento automático, arrastar encomendas ou atribuições individuais persistentes; essas funções exigem uma segunda fase própria.
- Manter os tempos por modelo e a jornada configurada atualmente. Os valores do cálculo são estimativas, não garantias de entrega.

## Detalhes técnicos
- Renovar `src/components/planning/PlanningTable.tsx`, `PlanningPanel.tsx` e `WeekLoadGrid.tsx`, integrados em `src/routes/_authenticated/encomendas.index.tsx`.
- Reutilizar as leituras autorizadas de `src/lib/planning.functions.ts`, os tempos de `src/lib/sla.functions.ts` e a ordenação já usada na fila prioritária.
- Criar `src/routes/_authenticated/planeamento.calculo.tsx`, pequenos componentes em `src/components/planning/` e funções puras de cálculo em `src/lib/productionCalculations.ts`.
- Acrescentar acesso à tela em `src/components/app/AppShell.tsx`; títulos e descrições próprios na nova página.
- Sem migrações previstas para esta primeira versão: taxas horárias e ajustes da simulação não são persistidos.
- Registar as decisões estruturais em `AGENTS.md` e manter as tarefas em `roadmap.md`.

## Verificação
- Testes dos cálculos de minutos/horas, quantidade, custos, tempos em falta e prevenção de dupla contagem de colaboradores.
- Conferir o plano com dados reais e sessão iniciada, preservando as ações existentes.
- Testar a simulação com entradas concretas e confirmar os totais apresentados.
- Verificar computador, largura atual de 723 px e telemóvel: sem informações sobrepostas ou deslocamento lateral da página.

## Ordem de execução
1. Fechar o tipo de cálculo pela resposta à pergunta.
2. Renovar as vistas de planeamento com os dados existentes.
3. Construir a tela de cálculo escolhida.
4. Testar cálculos, permissões existentes e apresentação; apresentar o resultado.