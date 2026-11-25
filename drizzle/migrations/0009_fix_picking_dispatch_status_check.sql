ALTER TABLE public.picking_dispatches DROP CONSTRAINT picking_dispatches_status_check;
ALTER TABLE public.picking_dispatches ADD CONSTRAINT picking_dispatches_status_check CHECK (status IN ('pendente', 'enviado', 'erro', 'incerto', 'reenviado'));

-- Regression checks against the actual installed constraint; no dispatch rows are written.
DO $test$
DECLARE
  expression text;
  candidate text;
  allowed boolean;
BEGIN
  SELECT pg_get_expr(conbin, conrelid) INTO expression
    FROM pg_constraint
    WHERE conrelid = 'public.picking_dispatches'::regclass
      AND conname = 'picking_dispatches_status_check';
  IF expression IS NULL THEN
    RAISE EXCEPTION 'Missing picking dispatch status constraint';
  END IF;
  FOREACH candidate IN ARRAY ARRAY['pendente', 'enviado', 'erro', 'incerto', 'reenviado'] LOOP
    EXECUTE 'SELECT ' || expression || ' FROM (SELECT $1::text AS status) AS dispatch' INTO allowed USING candidate;
    IF allowed IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Valid picking status rejected: %', candidate;
    END IF;
  END LOOP;
  EXECUTE 'SELECT ' || expression || ' FROM (SELECT $1::text AS status) AS dispatch' INTO allowed USING 'invalido';
  IF allowed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Invalid picking status accepted';
  END IF;
END;
$test$;