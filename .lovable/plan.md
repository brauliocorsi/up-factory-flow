# Filtros, pesquisa por produto e Líder de Produção

## 1. Filtros mais bonitos (área de operadores)
- Os botões "Só pendentes / Em curso / Só concluídas / Prontas para iniciar / Só as minhas" passam a um grupo de "pílulas" arredondadas com ícone e contador (ex.: "Em curso · 3"), uma cor por estado, e seleção clara.
- Em telemóvel ficam numa linha deslizante; "Fila prioritária" fica como ícone ao lado.
- Botão "Limpar filtros" aparece quando há filtros ativos.

## 2. Pesquisa única: encomenda ou produto
- A caixa passa a "Procurar nº encomenda ou produto…" e encontra por número, descrição do produto, modelo ou tecido (sem ligar a acentos/maiúsculas).
- Botão X para limpar.

## 3. Líder de Produção
- **Administração (Configurações > Operadores):** interruptor "Líder de produção" em cada operador. Pode haver mais de um.
- **Operador:** botão "Chamar líder" (ícone de mão levantada) na barra superior. Abre uma janela para escolher o motivo rápido (Dúvida, Falta de material, Problema na máquina, Qualidade, Outro) + nota opcional. Mostra "Pedido enviado" e pode cancelar.
- **Líder:** na sua tela aparece um botão "Pedidos" com contador e som/alerta ao chegar um novo. Lista: quem chamou, posto/etapa, encomenda em curso, motivo, há quanto tempo. Ações: "A caminho" (o operador vê "O líder vem a caminho") e "Resolvido".
- **Líder chama operador:** botão "Chamar operador" — escolhe um ou vários operadores e:
  - "Pedir presença" → aparece no ecrã do operador um aviso grande "O líder pede a sua presença" com botão "Vou já".
  - "Enviar recado" → texto escrito aparece como mensagem temporária no ecrã do operador (fecha sozinha após 30 s ou ao tocar "Visto").
- Tudo em tempo real, sem recarregar.

## Detalhes técnicos
- Coluna `operators.is_leader boolean default false`; só admin/escritório altera (validado na BD).
- Tabela `floor_calls` (id, kind: `help_request` | `presence` | `message`, from_operator_id, to_operator_id nulo = todos os líderes, reason, message, order_id/stage opcionais, status: `aberto|a_caminho|resolvido|visto|cancelado`, created_at, updated_at). GRANT + RLS: remetente e destinatário (via operators.user_id = auth.uid()), líderes veem pedidos de ajuda, admin/escritório veem tudo.
- RPCs `create_floor_call`, `update_floor_call_status` com `assert_operator_is_session`; só líderes criam `presence/message`.
- Realtime na tabela para notificações; componentes `LeaderCallButton`, `LeaderInbox`, `OperatorCallToast` montados no AppShell.
- Pesquisa: filtro em `producao.index.tsx` também sobre `product_description`/modelo/tecido com normalização de acentos.
