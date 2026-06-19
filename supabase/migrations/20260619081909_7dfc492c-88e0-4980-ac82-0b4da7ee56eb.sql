
-- 1) New enum values
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'em_armazem';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'picador';
