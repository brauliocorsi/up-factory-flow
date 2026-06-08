## Criar utilizador de teste

Criar o utilizador `brauliocorsi@gmail.com` com password `123456`, e-mail já confirmado, e atribuir-lhe o papel `escritorio` (para conseguir ver e gerir todas as encomendas no dashboard).

### Passos

1. Inserir o utilizador diretamente em `auth.users` via SQL com:
   - `email = brauliocorsi@gmail.com`
   - password com hash bcrypt de `123456`
   - `email_confirmed_at = now()` (e-mail já confirmado, sem precisar de link)
   - `aud = 'authenticated'`, `role = 'authenticated'`
   - entrada correspondente em `auth.identities`

2. Inserir em `public.user_roles` o papel `escritorio` para esse user_id (necessário caso contrário as RLS bloqueiam leitura/escrita).

### Notas

- Password `123456` é muito fraca e apenas aceitável para teste local. Recomendo trocar após o primeiro login.
- Se preferir o papel `admin` em vez de `escritorio`, diga-me antes de executar.
