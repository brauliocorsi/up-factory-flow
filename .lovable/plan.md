# Correção reversível dos registos de camas (CAM / laminado / PERCAM)

Nada é aplicado antes da sua confirmação. O ERP fica desligado. Não se apagam linhas. Não se mexe em `TESTE-2411-17399`, `TESTE-2411-17452`, `17328-01` nem `17328-02`.

## Estado verificado hoje (leitura)

- Os modelos CAM 110–139 estão todos ativos com estrutura `02`. Os 201–210, 213 e 214 estão ativos com `03`. O `300` Maria Flor está com `04`.
- Não existem `200`, `211`, `212`, `215`, `216`, `217`, `218` nem `219`.
- `production_orders.finishing` tem a restrição `CHECK (finishing IN ('F','N'))`.
- O gatilho do `gc_code` só põe em maiúsculas e copia para o `barcode`. Não valida o formato.
- `formatProductCode` só reconhece CAM/SOF de 18 caracteres e SOM de 17.

## Colisões com o código atual (preciso da sua resposta)

1. **Os 6 dígitos do tecido.** Hoje `fabricBlock()` tira os dígitos da `ref_tec` (`TEC000027` → `000027`). Para a Bass Cream isso dá um código **errado** (devia ser `012007`). Proposta: o gerador passa a usar só a nova coluna de 6 dígitos. Sem esse valor, não gera o código e a encomenda fica «tecido por validar». Assim, os tecidos que ainda não estão mapeados deixam de gerar CAM pela app até alguém os preencher. Confirma?
2. **Modelos de laminado de série com número de coxim.** Kali é `120` e Tróia é `133`, ambos `02`, e não estão retirados. Vou marcá-los como laminado de série tal como estão. Confirma?
3. **Zurique `139`.** Este número está em [CONFIRMAR]. Proposta: não marcar a flag de laminado de série nesta leva.
4. **Reversibilidade.** As migrações deste projeto só andam para a frente. Para cada uma, escrevo o desfazer completo num ficheiro `docs/migrations/2026-11-camas-down.sql`, que corre só se for pedido. Serve?

## O que faço após confirmação

### C. Esquema (migração aditiva)
- Nova tabela `ref_laminates` (`code` L01–L06, `name`, `label`, `synonyms text[]`, `active`). Fica com leitura para contas com papel e escrita só para admin/escritório. Os valores são os da sua tabela, sem `L00`.
- `production_orders.laminate_code text NULL` com FK para `ref_laminates`. O `finishing` fica intocado.
- `production_orders.code_status text NULL`, preenchido por gatilho só em inserções e atualizações novas: `ok` / `por_normalizar` (EAN-13 ou outro formato) / `tecido_por_validar`. As encomendas existentes ficam a NULL e não são reescritas.
- `models.laminate_standard boolean DEFAULT false` e `models.retired boolean DEFAULT false`, com comentário «não usar».
- `fabric_catalog.fabric_code6 text NULL UNIQUE`, com CHECK `^\d{6}$`. É distinto da `ref_tec`.
- Atualizo o comentário do `gc_code` para aceitar CAM 18/21, PERCAM 21/24, SOF 18, SOM 17 e EAN-13.

### Dados (via consultas, não migração)
- `fabric_catalog`: só `TEC000027` Bass Cream → `012007`. Para os outros tecidos, um ecrã de admin lista os que ainda não têm os 6 dígitos. Os dígitos são preenchidos à mão ou por CSV, nunca adivinhados.
- **D 1.1:** `111, 117, 118, 122, 125, 129, 132, 135` → `active=false, retired=true`. As receitas e os cascos ficam como estão.
- **D 1.2:** criar `200` Angel, `211` Prisma, `212` Quadrados, `215` Zeus, `216` Esmeralda, `217` Liverpool, `218` Munique e `219` Roland, todos CAM `03` Alongada. Também crio a ligação em `model_structures`. Os volumes vêm da regra da estrutura, porque nenhum destes modelos tem número de volumes definido.
- Flag `laminate_standard=true`: Kali 120, Tróia 133, Esmeralda 216, Londres 208, Munique 218, Zeus 215, Dublin 202 e Eclipse 203.

### E. Gerador, leitor de nomes e etiquetas
- `productCodes.ts`:
  - `buildBedCode` recebe `laminateCode` e `personalized`. Gera CAM 18, CAM+Lxx 21, PERCAM 21 ou PERCAM+Lxx 24.
  - Recusa os 8 números retirados (lista `RETIRED_BED_MODELS`).
  - Os 6 dígitos vêm de `fabric_code6`.
- `bedProductName`: `Cama {Modelo} {Família}[ Flutuante] {Medida}cm - {Tecido}[ - Laminado {Cor}][ - resto]`. Com PERCAM: `<nome> [PERS: …]`.
- `encomendas.nova.tsx`: novo seletor de laminado (Sem laminado, L01–L06). Nos modelos de série vem pré-escolhido `L02` e não há opção «sem». Os modelos retirados ficam escondidos.
- `productParse.ts`: extrai a cor pelos sinónimos (Ouro Rose/Rose → L03, Prateado/Prata → L02, Dourado/fita ou faixa dourada → L01, Espelho → L05, Bronze → L04, Inox → L06). Nos modelos de série sem cor indicada aplica L02. O laminado deixa de contar como personalização.
- `encomendas.importar-produtos.tsx`, `importar-simples.tsx` e `packages.functions.ts`: passam o laminado e aceitam códigos de 21 e 24 caracteres.
- `ProductionLabel.tsx`: segmenta CAM 18/21 e PERCAM 21/24, com `Lxx` como último bloco. Os outros códigos saem em bloco, com o aviso «código por normalizar».

### F. Aviso «código por normalizar»
- Etiqueta laranja na lista de encomendas, no detalhe e na etiqueta impressa. Mostra «sem código CAM» quando é EAN e «tecido por validar» quando faltam os 6 dígitos.

### Testes
- Testes unitários: Munique 218/03/160/012020/N/L02 dá 21 caracteres; os números retirados são recusados; «Laminado Ouro Rose» → L03; «Prateado» → L02 com o nome «Laminado Prata»; Kali sem cor → L02; EAN-13 → por_normalizar; o segmentador das etiquetas.

### G. Relatório final
- Lista dos modelos criados e desativados, das colunas e tabelas novas, dos ficheiros alterados e do que ficou pendente.

## [CONFIRMAR]: fora desta leva
- Copiar as receitas dos números antigos para os novos (118→216, 125→218, 122→217, 129→211, 132→219).
- Destino do `110` Angel Coxim (fica ativo).
- `300` Maria Flor e a estrutura `04` (sem alteração).
- Numeração simples: 012 Button, 013 Chanel, deslize 015–023, conflitos 008/009/010/011/014/020 e Belo/012.
- `114` Atena, `138` Diamante, `139` Zurique (sem número novo nem flag).
- Preencher os 6 dígitos dos restantes tecidos.
- Ligação ao ERP (fica desligada).
