ALTER TABLE public.operators ADD COLUMN IF NOT EXISTS is_leader boolean NOT NULL DEFAULT false;

CREATE TABLE public.floor_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('help_request','presence','message')),
  from_operator_id uuid REFERENCES public.operators(id) ON DELETE SET NULL,
  to_operator_id uuid REFERENCES public.operators(id) ON DELETE CASCADE,
  reason text,
  message text,
  stage text,
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','a_caminho','resolvido','visto','cancelado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.floor_calls TO authenticated;
GRANT ALL ON public.floor_calls TO service_role;
ALTER TABLE public.floor_calls ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.my_operator_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT id FROM public.operators WHERE user_id = auth.uid() AND active LIMIT 1 $$;
CREATE OR REPLACE FUNCTION public.i_am_leader() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.operators WHERE user_id = auth.uid() AND active AND is_leader) $$;

CREATE POLICY "floor_calls_read" ON public.floor_calls FOR SELECT TO authenticated USING (
  from_operator_id = public.my_operator_id()
  OR to_operator_id = public.my_operator_id()
  OR (kind = 'help_request' AND public.i_am_leader())
  OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'escritorio')
);

CREATE TRIGGER floor_calls_updated BEFORE UPDATE ON public.floor_calls FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.create_floor_call(_kind text, _to uuid[], _reason text, _message text, _stage text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE me uuid := public.my_operator_id(); t uuid; n int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão inválida'; END IF;
  IF _kind = 'help_request' THEN
    IF me IS NULL THEN RAISE EXCEPTION 'A tua conta não está ligada a um operador'; END IF;
    IF EXISTS(SELECT 1 FROM floor_calls WHERE from_operator_id=me AND kind='help_request' AND status IN ('aberto','a_caminho')) THEN
      RAISE EXCEPTION 'Já tens um pedido ao líder em aberto';
    END IF;
    INSERT INTO floor_calls(kind, from_operator_id, reason, message, stage) VALUES ('help_request', me, left(_reason,80), left(_message,500), _stage);
    RETURN 1;
  ELSIF _kind IN ('presence','message') THEN
    IF NOT (public.i_am_leader() OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'escritorio')) THEN
      RAISE EXCEPTION 'Só o líder de produção pode chamar operadores';
    END IF;
    IF _kind='message' AND coalesce(trim(_message),'')='' THEN RAISE EXCEPTION 'Escreve o recado'; END IF;
    FOREACH t IN ARRAY coalesce(_to,'{}') LOOP
      INSERT INTO floor_calls(kind, from_operator_id, to_operator_id, message) VALUES (_kind, me, t, left(_message,500));
      n := n+1;
    END LOOP;
    IF n=0 THEN RAISE EXCEPTION 'Escolhe pelo menos um operador'; END IF;
    RETURN n;
  END IF;
  RAISE EXCEPTION 'Tipo inválido';
END $$;

CREATE OR REPLACE FUNCTION public.update_floor_call_status(_id uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c floor_calls; me uuid := public.my_operator_id(); staff boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão inválida'; END IF;
  SELECT * INTO c FROM floor_calls WHERE id=_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
  staff := has_role(auth.uid(),'admin') OR has_role(auth.uid(),'escritorio');
  IF c.kind='help_request' THEN
    IF _status='cancelado' AND (c.from_operator_id=me OR staff) THEN NULL;
    ELSIF _status IN ('a_caminho','resolvido') AND (public.i_am_leader() OR staff) THEN NULL;
    ELSE RAISE EXCEPTION 'Sem permissão'; END IF;
  ELSE
    IF _status='visto' AND (c.to_operator_id=me OR staff) THEN NULL;
    ELSIF _status='cancelado' AND (c.from_operator_id=me OR staff) THEN NULL;
    ELSE RAISE EXCEPTION 'Sem permissão'; END IF;
  END IF;
  UPDATE floor_calls SET status=_status WHERE id=_id;
END $$;

CREATE OR REPLACE FUNCTION public.set_operator_leader(_operator_id uuid, _value boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.assert_office_or_admin('definir líder de produção');
  UPDATE operators SET is_leader=_value WHERE id=_operator_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.create_floor_call(text,uuid[],text,text,text), public.update_floor_call_status(uuid,text), public.set_operator_leader(uuid,boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_floor_call(text,uuid[],text,text,text), public.update_floor_call_status(uuid,text), public.set_operator_leader(uuid,boolean), public.my_operator_id(), public.i_am_leader() TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.floor_calls;