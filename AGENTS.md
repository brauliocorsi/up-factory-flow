# Project rules

- Keep `production_orders.status = concluida` visible as operational until Picagem transfers it to `em_armazem`, because Embalagem completion is not warehouse receipt.
- Production labels copy the Contagem Stock UP 62x29 layout (title, info line, one full-width CODE/CODE-C<n> barcode), because both apps must print identical labels for the same product.
- ERP (UP Móveis Base) integration is additive: inbound via `/api/integrations/erp/orders` + `erp_ingest_order`, outbound via `erp_outbox` filled by status trigger, because only ERP-linked OPs may emit events and history must stay untouched (see docs/integrations/up-moveis-base-v1.md).
- Production orders carry the GestãoClick product code in `production_orders.gc_code` (non-unique; barcode mirrors it via trigger) and colis use CODE / CODE-C<n>, because identical products share identical labels; always resolve barcodes within an order, never assume uniqueness.
- Bed codes: `finishing` is only the N/F variant; the laminate strip lives in `production_orders.laminate_code` (L01–L06, no L00) and the 6 fabric digits come from `fabric_catalog.fabric_code6`, never from `ref_tec`, because internal TEC refs do not match the CAM fabric digits. Rules live in `src/lib/laminates.ts` + `productCodes.ts`; undo guide in docs/migrations/2026-11-camas-down.sql.

- Keep order workspace filters client-side over the existing authorised order lists and scope responsive table layouts to order/planning/import views, because presentation changes must not modify workflow permissions or import semantics.
