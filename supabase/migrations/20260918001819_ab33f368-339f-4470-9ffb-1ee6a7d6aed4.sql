BEGIN;

REVOKE ALL ON FUNCTION public.models_check_family() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ref_fabric_refs_sync_type() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fabrics_prepare() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.production_orders_check_structure() FROM PUBLIC;

INSERT INTO public.ref_categories (code, name, active)
VALUES ('SOF', 'Sofá', true)
ON CONFLICT (code) DO UPDATE SET active = true;

-- camas em falta: Simples (010-022) e Coxim (114, 138)
INSERT INTO public.models (code, name, structure_code, category_id, active)
SELECT v.code, v.name, v.structure_code, (SELECT id FROM public.ref_categories WHERE code = 'CAM'), true
FROM (VALUES
  ('010','Alexa','01'), ('011','Belo','01'), ('012','Button','01'), ('013','Chanel','01'),
  ('014','Diana','01'), ('015','Harmony','01'), ('016','Imola','01'), ('017','Jeez','01'),
  ('018','Leonor','01'), ('019','Minerva','01'), ('020','Smart','01'), ('021','Sonata','01'),
  ('022','Sonho','01'), ('114','Atena','02'), ('138','Diamante','02')
) AS v(code, name, structure_code)
ON CONFLICT (category_id, code) DO NOTHING;

-- sofás: 21 Simples, 7 Deslizante, 5 Sofá-Cama
INSERT INTO public.models (code, name, sofa_family_code, category_id, active)
SELECT v.code, v.name, v.family, (SELECT id FROM public.ref_categories WHERE code = 'SOF'), true
FROM (VALUES
  ('001','Cometa','01'), ('002','Saturno','01'), ('003','Star','01'), ('004','Urano','01'),
  ('005','Alpha','01'), ('006','Antares','01'), ('007','Apolo','01'), ('008','Atila','01'),
  ('009','Atlas','01'), ('010','Celeste','01'), ('011','Chicago','01'), ('012','Júpiter','01'),
  ('013','Lince','01'), ('014','Lino','01'), ('015','Madrid','01'), ('016','Marte','01'),
  ('017','Mónaco','01'), ('018','Moon','01'), ('019','Plutão','01'), ('020','Vénus','01'),
  ('021','Zeus','01'),
  ('100','Krypton','02'), ('101','Orion','02'), ('102','Cordova','02'), ('103','Livorno','02'),
  ('104','Mercúrio','02'), ('105','Netuno','02'), ('106','Titã','02'),
  ('200','Helena','03'), ('201','Hermes','03'), ('202','Komby','03'), ('203','Mira','03'),
  ('204','Rover','03')
) AS v(code, name, family)
ON CONFLICT (category_id, code) DO NOTHING;

COMMIT;