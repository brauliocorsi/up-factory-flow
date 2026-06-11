
# Sistema de Picagem por Código de Barras + Entrada em Stock UP

Objetivo: na etapa final (`picagem`), o operador lê os colis com a pistola, o sistema valida que todos os colis da encomenda foram lidos, finaliza a etapa automaticamente e envia em lote para o projeto **Contagem Stock UP**, que dá entrada — criando o produto se ainda não existir.

A etiqueta atual **não muda** — o código de barras continua a ser o `order_number`. A identificação do coli é feita por sequência (1/2, 2/2, …) no próprio ecrã de picagem.

## 1. Novo ecrã `/picagem` (UP Produção)

Ficheiro: `src/routes/_authenticated/picagem.tsx`. Entrada nova no `AppShell`.

Layout grande, otimizado para pistola scanner:

- Campo de leitura autofocado, que reganha foco após cada leitura (pistola injeta texto + `Enter`).
- Picker do **operador** (tem de estar atribuído à etapa `picagem`).
- **Lista de encomendas em picagem** (lado direito): para cada encomenda mostra os colis esperados (de `model_packages` filtrados pela `structure_type`) com estado por coli: pendente / lido / extra.
- Ao ler um barcode:
  1. Resolve a encomenda por `order_number` ou `barcode`.
  2. Verifica que está na etapa `picagem`.
  3. Conta quantos colis dessa encomenda já foram lidos na sessão e atribui o próximo na sequência.
  4. Atualiza visualmente o card.
- Quando nº de leituras = `package_total` → encomenda fica **"Completa"** (verde) e o servidor finaliza a etapa `picagem` via `record_stage_event` (isto também aciona o trigger existente que cria o `finished_goods`).
- Encomendas sem `model_packages` definidos = **1 coli único** (mesmo fallback da impressão).
- Botão grande **"Enviar lote (N encomendas)"** dispara o envio das completas.
- Feedback sonoro/visual em cada leitura (beep WebAudio + toast verde/vermelho).
- Defesas anti-ecrã-branco; leituras desconhecidas/repetidas mostram toast e não estouram.

## 2. Backend mínimo no UP Produção

Server functions novas em `src/lib/picking.functions.ts`:

- `resolveOrderForPicking({ code })` — procura por `order_number`/`barcode`, devolve dados + colis esperados + estado da etapa `picagem`.
- `finalizePickingForOrder({ orderId, operatorCode })` — finaliza a etapa via RPC `record_stage_event` existente.
- `sendPickingBatch({ orderIds })` — chama o webhook do Contagem Stock UP com o payload de cada encomenda; regista resposta.

Nova tabela `picking_dispatches` (histórico):

```
picking_dispatches(
  id, order_id (FK), batch_id (uuid),
  dispatched_at, status ('enviado'|'erro'|'reenviado'),
  response_code int, response_body text,
  operator_id, created_at, updated_at
)
```

Com GRANTs + RLS (authenticated leitura, service_role tudo). Sem alterações às tabelas existentes.

Secrets a adicionar: `STOCK_INTAKE_URL`, `STOCK_INTAKE_TOKEN`.

## 3. No projeto destino "Contagem Stock UP" (call separada)

Rota pública `src/routes/api/public/stock-in.ts`:

- `POST` recebe JSON:
  ```
  {
    batch_id,
    items: [{
      order_number, product_code, barcode,
      product_description, model, measure,
      fabric_type, fabric_ref, color,
      quantity, dispatched_at
    }]
  }
  ```
- Valida header `x-up-token` contra secret `STOCK_INTAKE_TOKEN` com `timingSafeEqual`.
- Para cada `item`:
  1. **Procura o produto** em `products` por `barcode` (e fallback `product_code`).
  2. **Se não existe** → cria com `barcode`, `code`, `description`, `model`, `measure`, `fabric_type`, `fabric_ref`, `color`, `quantity = 0` (e marca `auto_created = true`).
  3. **Dá entrada**: incrementa `quantity` em `+1` (ou `item.quantity`) e regista linha em `stock_in_movements` com `source = 'up_producao'`, `order_number`, `dispatched_at`, `batch_id`.
- Devolve `{ ok, accepted: N, created: M, updated: K }`.
- CORS mínimo (chamada server-to-server).

Resultado: produtos novos aparecem sozinhos no Contagem Stock UP, e o stock é atualizado em cada envio.

## 4. Pontos importantes

- **Etiqueta inalterada** — barcode = `order_number` do início ao fim.
- A sequência dos colis (1/2, 2/2…) é puramente lógica no ecrã de picagem.
- A finalização passa pela RPC existente → respeita SLA, dependências, e cria automaticamente o `finished_goods`.
- "Picar vários ao mesmo tempo" funciona em sequência contínua: o sistema identifica a encomenda por leitura e atribui sempre o próximo coli em falta dessa encomenda.
- Envio em lote agrupa todas as encomendas completas num único `POST`.
- Idempotência: o Contagem Stock UP usa `(batch_id, order_number)` como chave única para não duplicar entradas em caso de reenvio.
- Português europeu; código limpo, comentado.

## Próximos passos após aprovação

1. Migração: `picking_dispatches` (+ GRANTs/RLS) e pedido dos secrets `STOCK_INTAKE_URL` / `STOCK_INTAKE_TOKEN`.
2. `src/lib/picking.functions.ts` (resolve / finalize / sendBatch).
3. `src/routes/_authenticated/picagem.tsx` + entrada no menu.
4. Em call separada: criar `/api/public/stock-in` no projeto **Contagem Stock UP** com a lógica de "existe? entra. não existe? cria + entra."

Confirmas para avançar?
