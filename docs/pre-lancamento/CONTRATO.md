# Contrato comum às 14 etapas de pré-lançamento

Fonte: prompt de 08/09/2026. Auditoria de referência: 07/09/2026 (revisão analisada `1a72067646cc5c3c9ee08fd8ccab0961dc7d021e`).

1. Trabalhar sobre o código e a base atuais. Os números da auditoria são uma fotografia, não alvos. Confirmar cada problema por leitura antes de corrigir; não reaplicar o que já está correto.
2. Alterações localizadas. Preservar navegação, visual, cadastros, autenticação, atribuições por etapa, agrupamentos, receitas, reservas, etiquetas, códigos de barras, painel e integrações. Sem troca de stack nem atualizações gerais de dependências.
3. Preservar IDs, números de OP, etiquetas emitidas, histórico, tempos, movimentos e fotografias. Não apagar, não reinicializar, não marcar OP como concluídas para esconder problemas, não inventar produção/picagens/consumos.
4. Migrações com transação, controlo de concorrência, repetíveis sem duplicar e com contagem antes/depois. Dados não inferíveis com segurança são preservados e a exceção é registada.
5. Ensaios com fixtures isoladas, transações de teste ou recetor simulado. Nunca testar operações irreversíveis em OP reais. Preview e app publicada partilham a mesma base — não assumir isolamento.
6. Manter as duas linhas: estrutura→branco e corte→costura, convergência na estofagem, depois qualidade→embalagem. Conclusão de produção é na embalagem. Picagem completa e transferência confirmada continuam estados distintos.
7. Qualidade (etapa 05): duas bases, CAMA e SOFÁ, independentes do modelo. Deteção automática quando fiável, escolha no posto quando não. Preservar itens e histórico existentes.
8. Impressão (etapa 06): imprimir após gravar a aprovação da qualidade e manter/melhorar a impressão na embalagem. Imprimir ou reimprimir nunca avança etapas, pica volumes ou movimenta stock.
9. Não publicar nesta sequência. Preparar versão candidata. Nunca expor segredos ou dados sensíveis em logs e documentos.
10. Permissões verificadas no servidor e na base, não só na interface. Preservar as leituras necessárias aos operadores. Proibido resolver com admin para todos, RLS desativado ou cliente privilegiado sem autorização explícita.
11. Cada etapa deixa o projeto compilável e os percursos utilizáveis. Ao restringir, criar primeiro o caminho autorizado equivalente. Sem bypass de segurança por compatibilidade.
12. Correr build, tipos e lint. Distinguir falhas anteriores das introduzidas. Testes de regressão executados de facto — não afirmar que um fluxo passou por leitura de código.
13. Não pedir nova autorização para correções reversíveis já cobertas pelo prompt. Dependência externa inacessível ou decisão de negócio não inferível: completar o resto e registar exatamente o que ficou pendente. Etapa parcialmente bloqueada não é "concluída".

Relato final de cada etapa: alterado; preservado; migrações e linhas afetadas; testes e resultados; limitações abertas; estado exato. Terminar com "Aguardo o próximo prompt".
