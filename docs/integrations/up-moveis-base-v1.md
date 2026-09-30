# Integração UP Móveis Base → UP Fábrica — contrato v1

Estado: implementado do lado da Fábrica. **Não validado ponta a ponta** (requer ambos os lados configurados e um ensaio isolado real).

## Variáveis (server-only, Project Settings → Secrets)

| Nome | Uso |
|---|---|
| `UP_ERP_INTEGRATION_TOKEN` | Segredo partilhado. Entrada: comparado com `x-up-integration-token`. Saída: enviado no mesmo cabeçalho. Sem ele a receção responde 503 e o envio fica desligado. |
| `UP_ERP_URL` | Base do ERP. Eventos vão para `{UP_ERP_URL}/api/integrations/factory/events`. |
| `UP_ERP_ALLOW_TEST_MODE` | Só `"true"` num ambiente explicitamente de teste. Sem ele, `test_mode:true` → 403. Mesmo com ele, `test_mode` apenas valida — **não cria OPs**. |

`STOCK_INTAKE_URL/TOKEN` (Contagem) não são tocados nem duplicados.

## Entrada — `POST /api/integrations/erp/orders`

Alias idêntico (mesmo handler e autenticação): `POST /api/public/integrations/erp/orders` — usar se o site publicado estiver privado. As únicas rotas públicas novas são este alias e o worker abaixo; ambas exigem `x-up-integration-token` e não dependem do login do site.

Cabeçalho `x-up-integration-token` (comparação em tempo constante). Corpo (campos extra rejeitados):

```
{schema_version:1, source_system:"up-moveis-base", event_id:UUID, sale_id:UUID,
 sale_number:string(1..40, [A-Za-z0-9._/-]), line_id:UUID, product_id:UUID,
 product_code:string|null, description:string(1..2000), quantity:int(1..50),
 due_date:"YYYY-MM-DD"|null, customization:object|null (≤8KB), test_mode:boolean}
```

| HTTP | Significado |
|---|---|
| 201 | Criado: `{accepted:true,event_id,orders:[{id,order_number,unit_index}]}` |
| 200 | Reenvio idêntico (mesmo conteúdo, mesmo ou novo `event_id`): mesmos IDs, nenhuma OP nova |
| 400/413/422 | JSON inválido / demasiado grande / validação (`issues`) |
| 401 | Token ausente ou errado |
| 403 | `test_mode` não permitido |
| 409 | `event_conflict` (event_id já usado com outro conteúdo/linha) ou `line_conflict` (linha já recebida com conteúdo diferente) — requer análise, nunca cria OP |
| 503 | Integração desligada (sem segredo) |

Regras:
- Uma OP por unidade: `order_number = <sale_number>-NN`, continuando a sequência existente desse número. `customer_order = sale_number`. Etapas e volumes são criados pelos mesmos triggers que a criação manual.
- Unicidade transacional: `erp_order_links (source_system, sale_id, line_id, unit_index)` + `erp_inbound_events.event_id` (PK), com lock por linha.
- `description` guardada integral em `production_orders.product_description` e em `erp_order_links.description`; `customization` guardada como snapshot JSON.
- Produto `por_validar` **não pode iniciar etapas**: triggers em `order_stages`/`order_coli_stages` recusam a passagem a `em_curso`. Admin/escritório validam em Admin → Integração ERP → "Validar" (`erp_validate_mapping`): grava `erp_product_map`, aplica modelo/estrutura/medida/tecido às OPs ainda não iniciadas, refaz os volumes provisórios segundo a rota do modelo, e marca `validated_by/at`. Descrição e personalização originais não são alteradas.
- Catálogo **não é adivinhado**: só se aplica modelo/estrutura/medida/tecido se houver entrada ativa em `erp_product_map` para o `product_id`. Caso contrário a OP fica sem modelo, com nota `[ERP] Produto sem correspondência validada…` e `mapping_status = por_validar` (visível em Admin → Integração ERP).
- Rastreabilidade: `unit_index`/`line_quantity` em cada vínculo e "Unidade i/N" nas notas.

## Saída — `POST {UP_ERP_URL}/api/integrations/factory/events`

```
{schema_version:1, event_id:UUID, source_system:"up-fabrica", sale_id, line_id,
 order_id, unit_index, status:"produced"|"warehouse_received", quantity:1, occurred_at}
```

- `produced`: a OP passou a `concluida`, o que só acontece quando **todos os volumes concluem Embalagem**. Não significa receção em armazém.
- `warehouse_received`: a OP passou a `em_armazem`, o que no fluxo existente só acontece quando o lote de Picagem foi aceite (HTTP 2xx) pelo sistema Contagem (`record_picking_dispatch`) ou um envio incerto foi reconciliado por admin. **Confirma a transmissão aceite ao sistema de stock, não uma conferência física adicional.** O stub `transferToExternalSystem` de produto final não gera eventos.
- Só OPs com vínculo em `erp_order_links` geram eventos; o histórico não é enviado. Um evento por (OP, status) — `UNIQUE(order_id, event_status)`.
- Outbox `erp_outbox`, estados: `pendente` → `a_enviar` → `entregue` | `erro` | `incerto`. Só `entregue` com resposta 2xx **e** corpo `{accepted:true,event_id:<igual>}`. Sem resposta/timeout ou 2xx sem ACK → `incerto` (reconciliar). Reenvios usam sempre o mesmo `event_id`; o ERP deve ser idempotente por `event_id`.
- `warehouse_received` só é reservado depois de `produced` estar `entregue`.
- Concorrência: `erp_outbox_claim(owner, limit, lease)` reserva com `FOR UPDATE SKIP LOCKED` e lease de 60 s; `erp_outbox_complete(event_id, owner, …)` só aceita o resultado do owner com lease ativo (resultado tardio é descartado). Leases expirados voltam a ser reservados. Backoff: 1 min × 2^(tentativas−1), máx. 6 h. Erros da base são propagados.
- `/api/integrations/factory/events` é a rota do ERP (a Fábrica é cliente); não existe na Fábrica.

## Worker agendável — `POST /api/public/integrations/erp/outbox-worker`
- Header `x-up-integration-token`. Sem `UP_ERP_URL`/token → 503. Com `erp_integration_settings.worker_enabled=false` (omissão) → `{ok:true,skipped:"worker_disabled"}` sem enviar.
- Só admin liga (`erp_set_worker_enabled`) e só depois de pelo menos um ACK válido num envio manual (`last_ack_at`).
- **Nenhum agendamento está ativo.** Para ativar mais tarde (depois do ensaio), agendar um `POST` a cada 5–15 min com pg_cron + pg_net para `https://project--f61d95c9-0846-4475-8cd9-c96c7da62357.lovable.app/api/public/integrations/erp/outbox-worker` com o header, guardando o token no Vault (nunca em migração).
- A política de quando o ERP dá entrada de stock está por confirmar com o proprietário; aqui apenas se registam os dois momentos separadamente.

## Limitações atuais
- Worker existe mas está desligado e sem agendamento; envio atual é manual.
- Política de stock (produzido vs recebido) pendente do proprietário; não ativada.
- Três funções (`erp_validate_mapping`, `erp_set_worker_enabled`, `erp_outbox_retry_now`) são executáveis por utilizadores autenticados por desenho; verificam a função (admin/escritório) internamente.
- Nenhum segredo configurado; integração desligada até configuração pelo proprietário.

## Testes executados (revisão 2)
- `src/lib/erpOutbox.test.ts` (4): ACK/owner, rede→incerto, erros da base propagados, lease perdido.
- Ensaio SQL revertido: claim A=1, claim B do mesmo evento=0; após expirar, B recupera; conclusão tardia de A rejeitada; backoff 2 min na 2.ª tentativa; início de etapa bloqueado em `por_validar`; operador não valida nem liga worker; admin sem ACK não liga worker; admin valida → `mapeado`, personalização preservada, volumes refeitos.

## Testes executados (revisão 1)
- `src/lib/erpIntegration.test.ts` (12): validação/limites, hash de idempotência/conflito, token, classificação de ACK/erro/rede.
- Ensaio SQL em bloco revertido (sem gravar): quantidade 2 → 2 OPs `-01/-02` com 8 etapas e volumes; reenvio → mesmos IDs; conteúdo diferente → `line_conflict`; event_id reutilizado → `event_conflict`; descrição integral e nota "por validar"; concluir 1 de 2 unidades → 1 evento `produced` (produção parcial).
