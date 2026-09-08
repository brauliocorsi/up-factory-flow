CREATE OR REPLACE FUNCTION public.assert_operator_is_session(_op public.operators)
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_mode text;
BEGIN
  -- Sem sessão: contexto de serviço/automatismos da base.
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  IF _op.user_id = auth.uid() THEN
    RETURN;
  END IF;

  -- Administração/escritório podem corrigir registos em nome de terceiros.
  IF public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'escritorio') THEN
    RETURN;
  END IF;

  SELECT identification_mode INTO v_mode FROM public.app_settings WHERE id = 1;

  IF _op.user_id IS NULL THEN
    IF COALESCE(v_mode, 'sessao') = 'sessao' THEN
      RAISE EXCEPTION 'O código % não está ligado a nenhuma conta. Usa a tua própria conta.', _op.code;
    END IF;
    RETURN; -- posto partilhado: comportamento existente
  END IF;

  RAISE EXCEPTION 'O código % pertence a outro utilizador. Usa a tua própria conta.', _op.code;
END;
$function$;