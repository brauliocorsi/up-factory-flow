# Encomendas em Picagem e etiquetas com código de produto

## Resultado
- Manter na lista de encomendas todas as ordens cuja produção terminou, mas que ainda estão em Picagem ou aguardam envio ao armazém.
- Distinguir claramente os estados «A aguardar picagem», «Em picagem» e «Pronta para armazém», sem as tratar visualmente como histórico concluído.
- Reorganizar a etiqueta de 62×29 mm para destacar o código real e formatado do produto.
- Manter a identificação individual do volume necessária à leitura na Picagem.

## Alterações
1. Ajustar a consulta e os filtros da lista para excluir apenas encomendas canceladas ou já enviadas ao armazém, mantendo as concluídas pela Embalagem enquanto o envio não ocorrer.
2. Calcular o estado operacional a partir da etapa de Picagem e mostrá-lo na tabela e nos cartões móveis.
3. Incluir nos dados da etiqueta o código completo do produto guardado na encomenda; retirar dele apenas o sufixo técnico da encomenda quando aplicável.
4. Dar destaque ao código do produto e ao respetivo código de barras, mantendo também o código do volume para a leitura correta na Picagem.
5. Confirmar impressão, leitura dos códigos e apresentação em computador e telemóvel, sem alterar colis, agendamento ou regras das etapas.

## Nota técnica
- `concluida` continua a significar produção terminada na Embalagem; `em_armazem` continua a significar transferência concluída.
- A etiqueta não substituirá silenciosamente o identificador do volume: terá o código do produto para identificação e o código do coli para o fluxo de Picagem.
