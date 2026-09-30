# Project rules

- Keep `production_orders.status = concluida` visible as operational until Picagem transfers it to `em_armazem`, because Embalagem completion is not warehouse receipt.
- Production labels carry separate product and coli barcodes, because the product identifies the article while the coli barcode drives Picagem.- ERP (UP Móveis Base) integration is additive: inbound via `/api/integrations/erp/orders` + `erp_ingest_order`, outbound via `erp_outbox` filled by status trigger, because only ERP-linked OPs may emit events and history must stay untouched (see docs/integrations/up-moveis-base-v1.md).
