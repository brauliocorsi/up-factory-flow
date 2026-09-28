# Project rules

- Keep `production_orders.status = concluida` visible as operational until Picagem transfers it to `em_armazem`, because Embalagem completion is not warehouse receipt.
- Production labels carry separate product and coli barcodes, because the product identifies the article while the coli barcode drives Picagem.