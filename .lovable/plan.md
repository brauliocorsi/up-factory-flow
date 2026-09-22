# Corte: sugerir automaticamente os tecidos em stock

Objetivo: ao abrir "Consumir tecido" no Corte, o sistema identifica o tecido da encomenda e sugere logo os rolos em stock que servem, por ordem de confiança. Nada do fluxo de consumo muda — só a identificação e a sugestão.

## O que muda para quem está no posto

1. A janela abre já com o tecido da encomenda identificado, numa linha de cabeçalho: coleção + cor (ex. "Célia · Light Grey"), e de onde veio (ficha do tecido da encomenda ou o texto da encomenda).
2. Abaixo, uma lista de **rolos sugeridos**, em grupos:
   - **Corresponde** — mesma coleção e mesma cor.
   - **Mesma coleção, cor diferente** — marcado com aviso, para o caso de a cor não estar registada na ficha.
   - **Outros rolos** — só aparece se não houver nenhum dos anteriores, ou se abrir "ver todos".
3. Cada rolo mostra nome, coleção/cor e metros disponíveis; fica desativado (e assinalado) quando tem menos metros do que os necessários.
4. O operador escolhe o rolo com um clique; o primeiro rolo que corresponde e tem metros suficientes vem pré-selecionado.
5. Se nada corresponder, mensagem clara: "Não há rolos em stock desta coleção" + possibilidade de escolher manualmente pelos seletores atuais (coleção/cor), que se mantêm como estão.

## Como o tecido da encomenda é identificado

Por esta ordem, até encontrar:

1. Ficha de tecido da encomenda (código TEC) → coleção e cor.
2. Texto da encomenda (coleção e cor escritos), traduzido para os códigos do catálogo por nome ou código.

Hoje muitas fichas TEC têm a coleção preenchida mas a cor em branco, por isso a cor vem quase sempre do texto da encomenda — daí o grupo "mesma coleção, cor diferente" ser importante em vez de um único rolo escolhido às escondidas.

## Notas técnicas

- `getFabricConsumeContext` (src/lib/stock.functions.ts): passa a selecionar `ref_tec` na encomenda e a ler a linha de `fabrics` correspondente (`fabric_ref_code`, `color_code`, `fabric_type_code`). Devolve novo bloco `suggestion`: `{ fabric_ref_code, color_code, source: 'ref_tec' | 'texto' | null }` e `suggested_rolls`: rolos já classificados (`match` | `same_ref` | `other`) com os metros. Continua a devolver `rolls`, `fabric_refs`, `colors`, `fabric_types` para os seletores manuais — sem quebrar quem já os usa.
- Resolução nome→código reutiliza a lógica atual do diálogo, movida para o servidor (comparação case-insensitive por `code` ou `name` em `ref_fabric_refs` / `ref_colors`).
- `ConsumeFabricDialog.tsx`: substitui a escolha implícita do rolo (`roll` derivado por ordenação) por seleção explícita `selectedRollId`, alimentada por `suggested_rolls`; `consumeFabric` continua a receber `roll_id` + `meters`, sem alteração de RPC nem de validações de base de dados.
- Sem migração de base de dados. `bunx tsgo --noEmit` no fim.
