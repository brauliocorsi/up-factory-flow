# Tempo ocioso, motivos de pausa, lista por data e "Cancelar início"

Cinco partes, aplicadas por esta ordem. Cada uma deixa a app a funcionar e não mexe no que já funciona.

## 1. Motivos de pausa (Configurações)
- Novo cartão "Motivos de pausa" em Configurações: criar, renomear, ordenar, ativar/desativar (nunca apagar).
- Vem já com: Organização de Material, Casa de Banho, Escritório, Falta de material, Manutenção de máquina, Outro.
- Na produção, ao carregar em **Pausar**, abre uma janela com os motivos em botões grandes (fácil no telemóvel). Sem motivo não pausa. "Outro" pede uma nota curta.
- O motivo fica guardado em cada pausa, com hora de início e de fim.

## 2. Botão "Cancelar início" (engano)
- Aparece só na etapa que o próprio operador iniciou, durante os primeiros 10 minutos e se ainda não houve pausa/conclusão.
- Pede confirmação ("Iniciaste por engano?"). A etapa volta a **Pendente**, sem operador e sem tempo contado; fica registo de que foi cancelada (para auditoria).
- Admin/escritório podem cancelar sempre, a qualquer operador.
- Validado também na base de dados (outro operador não consegue cancelar).

## 3. Tempo ocioso e pausas por colaborador
Definição de **tempo ocioso**: minutos dentro do horário (08:00–10:00, 10:15–12:00, 13:30–16:00, 16:15–17:30) em que o operador, estando presente nesse dia, não tinha nenhuma etapa a correr nem em pausa justificada. Os intervalos da fábrica não contam.
- Novo local **Relatórios > Ocioso e pausas**: escolher dia ou semana e ver, por colaborador:
  - tempo produtivo, tempo em pausa (total e por motivo), tempo ocioso, % de ocupação;
  - linha do tempo do dia (produzir / pausa com motivo / ocioso).
  - Exportar CSV.
- No **Painel de Produção** (ecrã da fábrica): novo bloco "Ocioso e pausas hoje" com cada operador, minutos ociosos, minutos de pausa e o motivo da pausa atual.

## 4. Painel: todas as encomendas de cada operador
- Em "Quem está a produzir", cada operador passa a mostrar a lista completa das encomendas em que está a trabalhar (número, etapa, volume "1 de 2", a produzir/em pausa com motivo e contador), em vez de só a primeira e "+N".
- Mesma melhoria na aba "Operadores" do Chão de fábrica.

## 5. Cartões na tela dos operadores: ordem por data e SLA
- Lista ordenada pela **data de produção da etapa** (data de saída menos a folga configurada por etapa), depois prioridade. As que estão a correr continuam no topo.
- Cada cartão mostra: "Produzir até: dd/mm" e "Saída: dd/mm".
- Etiqueta de prazo: **Atrasado** (vermelho, passou a data de produção), **Hoje** (âmbar), **No prazo** (verde); sem data de saída → "Sem data".

## Detalhes técnicos
- Nova tabela `pause_reasons` (label, sort_order, active) com GRANT + RLS (leitura autenticados, escrita admin/escritório).
- Nova tabela `stage_pauses` (order_coli_stage_id / order_stage_id, operator_id, reason_id, notes, started_at, ended_at) — preenchida pelas RPCs `record_coli_stage_event` / `record_stage_event` (parâmetro opcional `_reason_id`; obrigatório no evento `pause` vindo da UI); o `resume`/`finish` fecha a pausa aberta.
- Nova RPC `cancel_stage_start(_id, _operator_code)`: valida autor (ou admin/escritório), janela de 10 min, sem pausas; repõe status, operador, tempos; regista evento `cancel_start` nos logs e sincroniza o resumo da encomenda.
- Nova RPC `get_idle_report(_from, _to)`: cruza `coli_stage_work_intervals` + `stage_pauses` com os blocos do turno (Europe/Lisbon) e `stage_day_assignment` (presença); devolve por operador/dia produtivo, pausa por motivo, ocioso. Reutilizada no painel.
- `get_public_factory_panel`: `operators` passa a incluir array `orders` por operador e bloco `idle_today`.
- Cartões: reutilizar `get_stage_target_dates` / `stage_lead_offsets` para a data de produção por etapa; ordenação em `producao.index.tsx` e `StageGroupView`.
- Motivos-base inseridos na própria migração.
