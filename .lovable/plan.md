# Preparação para lançamento — correção por fases

Base: análise de 7 de setembro (F01–F16). Princípio geral: **não alterar o que já funciona**. Cada fase é fechada, verificada e só depois se avança. Nada de refazer o sistema.

## Regras de trabalho em todas as fases

- Nenhuma alteração de comportamento fora do problema da fase.
- Cada correção de regras no servidor mantém o ecrã do operador a funcionar como hoje (só passa a recusar o que não devia ser permitido).
- Reparações de dados existentes: primeiro contagem antes/depois, sem apagar histórico, sem duplicar volumes.
- Ao fim de cada fase: lista curta de ensaios feitos e resultado.

## Fase 0 — Fixar a versão e o que está publicado (F16)

- Mostrar a versão da aplicação num canto do ecrã de diagnóstico, para saber sempre o que os operadores estão a usar.
- Confirmar que o endereço usado na fábrica serve a versão validada.
- Sem alterações de regras nesta fase.

## Fase 1 — Permissões e identidade (F02, F03, F04)

Estas três andam juntas: fechar acessos sem fechar o trabalho legítimo.

- Matriz de ações por perfil (administrador, escritório, operador, picador) aplicada **dentro** das operações sensíveis: ajuste de stock, cancelamento, conclusão de produção para stock.
- Deixar de aceitar escritas diretas nas tabelas de volumes e etapas por contas operacionais; tudo passa pelas ações registadas.
- Corrigir a regra `stage_sla_model` que ficou permissiva por engano.
- Ligar cada registo de início/pausa/conclusão à pessoa autenticada, em vez de aceitar o código de outra pessoa.
- Exigir administrador antes de qualquer alteração de credenciais de operador, e não deixar alterações a meio.
- Dar ao posto as leituras de que precisa (checklist de qualidade, modelos/rolos de tecido, definições), por via autorizada, distinguindo "sem configuração", "sem stock" e "sem permissão".

Ensaios: operador de qualidade vê o checklist certo; operador de corte vê rolos; nenhum consegue ajustar stock, cancelar ordens ou registar em nome de outro.

## Fase 2 — Volumes e etapas (F01, F07)

- Definir a autoridade de cada etapa: quais pertencem à ordem e quais a cada volume (decisão em aberto abaixo).
- Impedir ativar uma configuração de rota sem etapas; falha de criação passa a ser erro visível, nunca "concluído".
- Migração que acrescenta **apenas** o que falta aos 251 volumes existentes, preservando identificadores, etiquetas e histórico, repetível sem efeitos extra.
- Resumo da ordem passa a derivar dos volumes quando o trabalho é por volume, para os dois lados nunca discordarem.
- Retrabalho reabre também as etapas dos volumes e retira o produto da disponibilidade para transferência, usando as dependências reais (as duas linhas paralelas), não uma lista linear.

Ensaios: ordens com 2, 3 e 4 volumes; retrabalho de um volume após qualidade/embalagem; picar cada volume das ordens de teste.

## Fase 3 — Estados, qualidade e stock (F05, F08, F09, F10)

- Transições permitidas explícitas: não iniciar o que já está em curso, não concluir o que já está concluído; repetição de pedido devolve o resultado anterior em vez de mexer no tempo ou no responsável.
- Qualidade gravada numa só operação: conferência, itens e conclusão da etapa juntos; sem submeter com fotografias a meio; validação no servidor de que a etapa é a de qualidade daquela ordem e que o checklist está completo.
- Aprovação com item NOK passa a exigir motivo e perfil autorizado (decisão em aberto).
- Stock: anulação de consumo uma única vez; reserva de capa só se ainda houver saldo; movimento registado igual à variação real do saldo.
- Ordem "pendente" deixa de poder ser iniciada no posto (decisão em aberto); mensagem clara "Aguarda libertação do escritório".

Ensaios: dois dispositivos a iniciar a mesma etapa; duplo clique em concluir; duas ordens a disputar a última capa; duas anulações de consumo ao mesmo tempo.

## Fase 4 — Alterações de ordens e importação (F11, F12)

- Separar campos administrativos (prazo, observação, prioridade) da identidade do produto (modelo, medida, estrutura, tecido).
- Identidade só muda antes do primeiro início; depois é recusada ou segue procedimento explícito, com reetiquetagem.
- Importação passa a reconhecer o mesmo ficheiro/pedido repetido, mostrar o que já existe e o que vai criar, e só acrescentar unidades quando é intencional.

## Fase 5 — Transferência para stock e listas grandes (F06, F13, F15)

- Registar a intenção de transferência antes do envio, com identificador estável reutilizado em nova tentativa; marcar como transferido só com confirmação do destino.
- Validar no servidor a elegibilidade das ordens antes de enviar (não canceladas, todos os volumes picados, não enviadas).
- Ecrã de reconciliação para envios com resposta incerta.
- Retirar limites que escondem dados sem avisar: metas calculadas por lote, pendências filtradas antes de limitar, listas paginadas.
- Picagem parcial reconstruída ao reabrir noutro dispositivo, com estados por picar / parcial / picada / enviada, e texto corrigido sobre "em armazém".

## Fase 6 — Indicadores e piloto (F14)

- Tempo por pessoa e por período calculado a partir dos intervalos reais, separando duração do processo, mão de obra e espera.
- Aviso de operação esquecida em curso (havia 20 etapas em curso sem pausa, algumas com mais de 116 horas).
- Marcar os registos de teste para não contaminarem indicadores.
- Percurso completo com um utilizador de cada posto, etiquetas reais, telemóvel/tablet, e piloto acompanhado antes de alargar.

## Decisões de negócio a fechar (bloqueiam Fases 2 e 3)

1. Que etapas pertencem a cada volume? (proposta: embalagem e picagem por volume; produção ao nível da ordem)
2. "Pendente" exige libertação do escritório antes do primeiro início? (proposta: sim)
3. Aprovar com NOK: permitido a quem, com motivo obrigatório? (proposta: só administrador/escritório)
4. A picagem comprova presença física de cada volume, ou aceita confirmação administrativa?
5. Qual é o acontecimento exato que autoriza o produto a entrar no stock: embalagem concluída, todos os volumes picados, ou confirmação do destino?

## Notas técnicas

- Fase 1 e 3 implicam migrações de base de dados (verificação de perfil dentro das funções privilegiadas, revogação de execução direta, políticas corrigidas, bloqueio de linha nas funções de evento e de stock).
- Fase 2 implica uma migração de reparação de dados idempotente, precedida de contagens de controlo.
- Fase 5 implica nova tabela/estado de intenção de transferência com identificador estável.
- Sem alterações no painel público, etiquetas, agrupamentos e realtime, exceto o que as fases indicam.
