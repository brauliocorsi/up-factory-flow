# UP Fábrica — Testes manuais antes do lançamento

Regras: usar sempre encomendas marcadas como teste. Nunca enviar stock real. Não escrever palavras-passe aqui.

## Percurso 1 — Uma cama de teste do início ao fim
Perfil: escritório (criar) + um operador por posto.
1. Criar 1 encomenda de cama, quantidade 1, e marcá-la como teste. Resultado esperado: aparece no planeamento como pendente.
2. Ativar a encomenda. Esperado: passa a ativa e aparece nos postos.
3. Estrutura: iniciar, pausar, retomar, concluir. Esperado: o tempo corre, a pausa conta, e só quem iniciou pode continuar.
4. Corte: iniciar e usar "Consumir tecido". Esperado: os metros descem uma vez; clicar duas vezes não desce a dobrar.
5. Costura, branco, estofagem: concluir. Esperado: só abre quando as anteriores estão feitas.
6. Qualidade: escolher a base Cama, responder tudo, aprovar. Esperado: com um item "não conforme" não deixa aprovar.
7. Imprimir etiqueta depois de aprovar. Esperado: abre a janela de impressão; cancelar não muda nada no sistema.
8. Embalagem: concluir todos os volumes. Esperado: a encomenda fica concluída e sai das listas ativas.

Resultado observado: ______________________

## Percurso 2 — Volumes independentes
1. Encomenda com 2 volumes. Trabalhar só o volume 1 até embalagem.
Esperado: o volume 1 avança sozinho; a encomenda só fica concluída quando o volume 2 também acaba.

Resultado observado: ______________________

## Percurso 3 — Retrabalho
1. Depois da qualidade, enviar para trás (por exemplo costura), com motivo.
Esperado: as etapas afetadas reabrem, o produto deixa de estar pronto para transferir, e clicar duas vezes não cria dois registos.
2. Tentar retrabalho de uma encomenda já enviada para o armazém. Esperado: mensagem a pedir correção administrativa.

Resultado observado: ______________________

## Percurso 4 — Picagem e envio (com recetor simulado)
1. Abrir a encomenda na picagem e ler os volumes um a um. Esperado: contagem correta; ler o mesmo volume outra vez avisa que já está lido.
2. Fechar e reabrir noutro equipamento. Esperado: mantém o que já foi lido.
3. Enviar lote. Esperado: só encomendas com todos os volumes picados são enviadas; as outras aparecem como recusadas com o motivo.
4. Clicar em enviar duas vezes. Esperado: não há duplicação; estado fica claro.

Resultado observado: ______________________

## Percurso 5 — Importação
1. Importar um ficheiro de teste com 3 linhas. Esperado: cria as unidades indicadas.
2. Clicar em importar outra vez sem mudar nada. Esperado: aviso de que já tinha sido feito, sem criar unidades novas.
3. Preparar nova importação do mesmo ficheiro (novo passo). Esperado: acrescenta unidades, de forma deliberada.

Resultado observado: ______________________

## Percurso 6 — Permissões
1. Entrar como operador de um posto. Esperado: vê apenas o seu posto; não consegue ajustar stock nem cancelar encomendas.
2. Tentar continuar uma operação iniciada por outra pessoa. Esperado: bloqueado, com mensagem.

Resultado observado: ______________________

## Pendente de teste real
- Leitor de código de barras físico.
- Impressora e tamanho real da etiqueta.
- Recetor de stock verdadeiro (aqui só foi testado o lado da fábrica).
- Tempos por pessoa em grupos e mudança de dia (correção ainda não feita).
