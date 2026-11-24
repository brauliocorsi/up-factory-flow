CREATE OR REPLACE VIEW public.fabric_availability AS SELECT ref_tec, name, supplier_ref, supplier_number, fabric_type, collection, color, color_code, price_class, meters, min_meters, location, needs_review,
 CASE WHEN (meters <= (0)::numeric) THEN 'SEM STOCK'::text WHEN (meters <= min_meters) THEN 'POUCO'::text ELSE 'DISPONIVEL'::text END AS status,
 fabric_code6
FROM public.fabric_catalog WHERE active;