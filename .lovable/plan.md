# Catálogo de produtos: integridade referencial e sincronização

## Estado atual verificado na base

- 49 modelos, todos na categoria CAM (Simples 001-009, Coxim 110-137, Alongada 201-214, Especial 300). A categoria SOF está vazia.
- Os nomes dos modelos repetem a estrutura ("Armani Simples", "Gomos Alongada").
- 45 coleções de tecido; só 20 têm tipo atribuído. Existem os duplicados Vénus/Venus e Quines/Quinnes.
- 4 estruturas: 01 Simples, 02 Coxim, 03 Alongada, 04 Especial. 28 medidas (22 na gama 5xx). 59 cores. 3 tipos de tecido.
- 161 ordens de produção, todas em curso (pendente/em produção). Destas: 8 com modelo, 2 com estrutura, 2 com referência de tecido, 152 com cor. Ou seja, quase nenhuma ordem depende dos campos que vamos passar a validar — o risco de partir ordens é muito baixo.
- Colis por estrutura já estão corretos (Simples 2, Coxim 3, Alongada 4, Especial 3) e os cascos genéricos já usam ESTR+estrutura+medida.

## Contas das coleções (já fechadas)

Regra confirmada: só ficam ativas as 21 coleções a que deu tipo explicitamente. Tudo o resto é desativado.
- Ativas: 14 Aveludado + 6 Microfibra + 1 Pele Sintética = **21**.
- Desativadas: as 22 da sua lista (Quines incluída) + Venus (19) + Quinnes (37) = **24**.
- 21 + 24 = 45, que é exatamente o total atual. Confirmei que **não sobra nenhuma coleção sem tipo**, portanto não haverá lista extra para confirmar.

## Parte 1 — Integridade referencial

### Modelo → estrutura
- `models` ganha `structure_code` (FK `ref_structures.code`), preenchida a partir do sufixo atual do nome, e depois NOT NULL para camas.
- Nomes dos modelos limpos: "Armani Simples" passa a "Armani". Gomos continua a ser dois modelos (119 Coxim, 205 Alongada).
- Trigger em `production_orders`: se a ordem tem modelo e estrutura, a estrutura tem de ser a do modelo. Ordens antigas sem estes campos não são tocadas.
- Interface: primeiro o modelo, a estrutura aparece preenchida e bloqueada. Deixa de haver escolha de estrutura.

### Coleção → tipo de tecido
- `ref_fabric_refs` ganha `fabric_type_code` (FK `ref_fabric_types.code`), NOT NULL para as coleções ativas; as desativadas ficam com o tipo que hoje têm ou por preencher.
- Interface: escolher o tipo filtra as coleções; escolher a coleção preenche e bloqueia o tipo.

### Tabela `fabrics` (tecido concreto)
Nova tabela com `ref_tec` (chave), tipo, coleção, `supplier_ref`, cor e `active`, com validação de que `ref_tec` = TEC + tipo(2) + coleção(2) + sequência(2) e que tipo/coleção/cor batem com o código. A sequência é gerada por coleção.
`production_orders` ganha `ref_tec` opcional (FK) — obrigatório nas novas ordens criadas pela interface, opcional para as 161 antigas, que continuam com os campos de texto atuais.

## Parte 2 — Dados

- Desativar as 24 coleções (as 22 da lista, com Quines, mais Venus 19 e Quinnes 37). **Nada é apagado.**
- Atribuir tipo às coleções ativas: Aveludado (01) a Opera, Trota, Vena, Alicia, Mix, Pierre, Avanti, Lyla, Masseto, Ringo, Susan, Vénus, Bass, Chester; Microfibra (02) a Kenya, Célia, Sydney, Nice, Prince, Jakarta; Pele Sintética (03) a Mikonos.
- Acrescentar 15 modelos de cama: Simples nos próximos códigos livres (010 em diante) e Coxim em 114 e 138.
- Criar `ref_sofa_families` (01 Simples, 02 Deslizante, 03 Sofá-Cama) e os 33 modelos de sofá com os códigos indicados, na categoria SOF. As famílias ficam em tabela própria para não misturar significados com as estruturas de cama; cada modelo aponta para estrutura (cama) ou família (sofá), conforme a categoria.

## Parte 3 — Códigos e nomes

Gerador central, usado pela criação de encomendas e pelas etiquetas:
- Cama: CAM + modelo(3) + estrutura(2) + medida(3) + tecido(6) + variante (N/F).
- Sofá: SOF + modelo(3) + família(2) + largura(3) + tecido(6) + lado da chaise (N/E/D/R).
- Sommier: SOM + modelo(3) + elevatório(1) + fundos(1) + medida(3) + tecido(6).
- O bloco de tecido são os 6 dígitos do `ref_tec` depois de "TEC".
- Cama usa código de medida (gama 5xx assinalada como sob-medida na interface); sofá usa largura real em cm.
- Nomes gerados: "Cama Lisa Simples 200x160cm - Célia 15 Light Grey", "Sofá Krypton Deslizante Chaise Esq 230cm - ...", "Sofá-Cama ...". A estrutura aparece uma vez e a categoria no singular — corrige o caso "Camas Armani Simples Simples ...".
- Lado da chaise mostrado com ícone e explicação, padronizado em **ODF (Olhando De Frente)**.

## Parte 4 — Cascos e colis

- Simples e Coxim: casco genérico ESTR+estrutura+medida (já é o que existe).
- Alongada e Especial: casco por modelo ESTR+modelo+estrutura+medida; onde faltar, é criado.
- Colis: Simples 2, Coxim 3, Alongada 4, Especial 3, com exceção de Angel, Versace e Dublin em Alongada com 5 colis.

## Parte 5 — Importação por Excel com reconhecimento automático

Novo importador com pré-visualização obrigatória, sem nunca importar às cegas.

Reconhecimento por linha de texto livre:
- **Modelo**: procurado em qualquer posição da frase, com tolerância a acentos, maiúsculas e palavras pelo meio ("Cama cabeceira Alongada 258cm Angel" → Angel). Quando há mais de um candidato, a linha fica em DÚVIDA.
- **Estrutura/família**: nunca lida do texto; vem sempre do modelo.
- **Medida**: 190x140→140, 195x150→150, 200x160→160, 200x180→180, 190x90→090, 200x90→091. Aceita ×, vírgula decimal e erros como "190x900" ou "2000x120". Medidas precedidas de Cab., Cabeceira, Ilhargueiro ou Peseira são ignoradas para a medida da cama. Medidas fora da lista procuram-se na gama 5xx e, se não existirem, cria-se o próximo código livre 5xx marcado como sob-medida.
- **Tecido**: procura o nome da coleção e o que vem a seguir (número do fornecedor e/ou cor) e liga ao `ref_tec` de `fabrics`. Sem correspondência exata → DÚVIDA.
- **Variante**: cama com "flutuante"/"mural" → F, senão N. Sofá: ODF/VDF com Drt/Dir → D, com Esq → E, "chaise" sem lado → R, sem chaise → N.
- **Personalizações** extraídas para campo próprio, sem entrar no código: altura de cabeceira (Cab. 300cm → cab:300), ilhargueiro, furos para tomadas, laminado, espelhos, listras, peseira.

Fluxo: carregar Excel → pré-visualização linha a linha com modelo, estrutura, medida, tecido, variante, personalizações e código gerado, cada linha marcada RECONHECIDA / DÚVIDA / NÃO RECONHECIDA → correção manual por seletores nas linhas duvidosas → confirmação → importação → relatório final do que entrou e do que ficou de fora. A importação continua idempotente pelo mesmo mecanismo já usado hoje (`import_batches` com identificador de lote e resumo do ficheiro).

## Parte 6 — Linhas livres nas encomendas

Passa a ser possível registar numa encomenda linhas que não são produto de catálogo: assistências, reparações, portes, serviços, peças soltas e produtos de terceiros.
- Cada linha livre tem descrição, quantidade, observações e um tipo opcional (Assistência, Reparação, Serviço, Peça, Outro).
- Sem código de produto, modelo, tecido nem casco; não passa pelo gerador de códigos nem pelas validações de catálogo, o que exige que as validações novas só se apliquem a linhas de catálogo.
- Distinção visual clara na encomenda e nas listas.
- Entra na produção/expedição sem exigir receita nem volumes: fecha por conclusão direta, sem cascos nem colis.
- Uma encomenda pode misturar linhas de catálogo e linhas livres.

## Como protejo as 161 ordens

- Nenhum registo é apagado; desativação por `active = false`.
- Colunas novas entram opcionais, são preenchidas e só depois ficam obrigatórias, e só onde já há dados válidos.
- O trigger de coerência modelo/estrutura só valida quando os dois campos existem, e aplica-se a gravações novas.
- Migrações repetíveis, com contagens antes e depois; nenhuma ordem existente é alterada.

## Notas técnicas

- Migrações em Postgres: `models.structure_code`, `models.sofa_family_code`, `ref_fabric_refs.fabric_type_code`, `ref_sofa_families`, `fabrics`, `production_orders.ref_tec`, triggers de coerência e de formato de `ref_tec`, GRANT + RLS iguais aos das tabelas de catálogo já existentes.
- Código: `src/lib/catalog.functions.ts` (novos campos e leitura de famílias/tecidos), novo módulo de geração de códigos e nomes, `src/routes/_authenticated/encomendas.nova.tsx` (ordem modelo → estrutura bloqueada, tecido pelo `ref_tec`, largura para sofá), `src/routes/_authenticated/admin.catalogo.tsx` (gestão de coleções por tipo, famílias de sofá e tabela de tecidos).
- A tabela `fabrics` nasce vazia: não recebi a lista de tecidos concretos (referência do fornecedor + cor). Fica a interface para os criar, e o `ref_tec` só passa a obrigatório nas ordens novas quando existirem tecidos registados.
