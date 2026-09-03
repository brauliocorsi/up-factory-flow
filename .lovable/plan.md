# Stock de tecidos + botão "Consumir" no Corte

Objetivo: gerir metros de tecido por referência/cor e dar baixa manualmente na etapa de Corte, usando os metros definidos no modelo. Nada do fluxo atual de produção muda.

## 1. Metros por modelo

- Cada modelo (cama/sommier) ganha um campo **Metros por unidade**.
- Editável no Catálogo, na secção de Modelos, junto ao nome/código.
- É este valor que o botão "Consumir" usa.

## 2. Stock de tecidos (ecrã já existente, melhorado)

Em `Stock > Rolos de tecido`:
- Continua a registar: Referência (ex. OPERA), Cor, Nome, Metros, Mínimo, Localização.
- Novo **filtro por Tipo de tecido** (ex. Aveludado) e por texto, para encontrar rapidamente a referência.
- Na criação/edição do rolo, a lista de Referências passa a poder ser filtrada por tipo de tecido (usa a ligação já existente entre tipo e referência).
- Alerta visual de stock baixo mantém-se; entradas de stock continuam pelo botão de ajuste.

## 3. Botão "Consumir" no Corte

No card de Corte de cada encomenda (chão de fábrica), novo botão **Consumir tecido**:
1. Abre uma janela com: filtro opcional por Tipo de tecido → escolha de **Referência** → escolha de **Cor**.
2. Pré-seleciona automaticamente a referência/cor da encomenda quando existirem.
3. Mostra os **metros a consumir** vindos do modelo da encomenda (editável apenas por admin/escritório, para corrigir casos pontuais).
4. Mostra os metros disponíveis do rolo escolhido; avisa se forem insuficientes.
5. Ao confirmar: dá baixa dos metros no rolo, registra o movimento de stock com a encomenda, e o card passa a mostrar "Tecido consumido: X m (OPERA / BEGE)".

Regras:
- Um consumo por encomenda: duplo clique ou nova tentativa não dá baixa duas vezes (mostra aviso). Admin/escritório podem anular um consumo, o que devolve os metros.
- Podem consumir: operador do posto de Corte, admin e escritório.
- Erros esperados (sem rolo, sem metros definidos no modelo, já consumido) aparecem como aviso/toast — nunca ecrã branco.

## 4. Consumo automático desligado

Hoje o sistema dá baixa de metros automaticamente ao concluir o Corte. Esse comportamento é desligado, para não haver baixa dupla — a baixa passa a ser só pelo botão "Consumir". Todo o resto do trigger (cascos e capas na estofagem) fica exatamente igual.

## Notas técnicas

- Migração: `models.meters_per_unit numeric`; nova tabela `fabric_consumptions` (`order_id` único, `roll_id`, `meters`, `operator_id`, `created_at`) com GRANTs e RLS (leitura autenticados; escrita via RPC).
- RPC `consume_fabric_for_order(_order_id, _roll_id, _meters, _operator_code)` — `SECURITY DEFINER`, `search_path = public`, atómica (`FOR UPDATE`), valida role/posto, insere em `fabric_consumptions` + `stock_movements`, devolve `{ok:false,message}` em erros esperados. RPC `undo_fabric_consumption(_order_id)` para admin/escritório. `EXECUTE` revogado de `PUBLIC`/`anon`.
- Trigger `order_stages_after_complete_consume`: remove-se apenas o bloco `IF NEW.stage = 'corte'` de metros; restante inalterado.
- Novas server functions em `src/lib/stock.functions.ts` (`consumeFabric`, `undoFabricConsumption`, `getFabricConsumption`) com `requireSupabaseAuth` e guards de role já existentes em `roleGuards.ts`.
- UI: `admin.catalogo.tsx` (campo metros no modelo), `stock.tecidos.tsx` (filtros), `producao.index.tsx` (botão + diálogo `ConsumeFabricDialog`), invalidação por Realtime já ativa em `fabric_rolls`.
- Regenerar os types do backend após a migração.
