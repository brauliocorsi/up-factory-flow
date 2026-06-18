ALTER TABLE public.shells DROP CONSTRAINT IF EXISTS shells_code_key;
ALTER TABLE public.covers DROP CONSTRAINT IF EXISTS covers_code_key;
ALTER TABLE public.shells ADD CONSTRAINT shells_code_state_key UNIQUE (code, state);
ALTER TABLE public.covers ADD CONSTRAINT covers_code_state_key UNIQUE (code, state);