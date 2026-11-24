-- Desfazer a correção das camas de 24/11/2026 (só correr se for pedido).
-- Dados:
UPDATE public.models SET laminate_standard=false WHERE laminate_standard;
UPDATE public.models SET active=true, retired=false WHERE retired AND code IN ('111','117','118','122','125','129','132','135');
UPDATE public.models SET active=false WHERE code IN ('200','211','212','215','216','217','218','219')
  AND category_id=(SELECT id FROM public.ref_categories WHERE code='CAM'); -- desativa, não apaga
UPDATE public.fabric_catalog SET fabric_code6=NULL WHERE ref_tec='TEC000027';
-- Esquema (0008 e 0007), via nova migração:
-- CREATE OR REPLACE VIEW sem fabric_code6 exige DROP VIEW + recriar (definição anterior em 0008).
-- DROP TRIGGER production_orders_code_status_trg ON public.production_orders;
-- DROP FUNCTION public.production_orders_code_status();
-- Colunas production_orders.laminate_code/code_status, models.laminate_standard/retired,
-- fabric_catalog.fabric_code6 e a tabela ref_laminates ficam marcadas DEPRECATED (não se apagam).
