# Ocioso e pausas também para trabalho sem volumes

## Problema
Quase todo o trabalho é registado por volume e já conta bem. As encomendas sem volumes (produções para stock, linhas livres) registam o tempo noutro sítio:
- o motivo de pausa escolhido não fica guardado;
- o tempo de trabalho não entra no relatório "Ocioso e pausas" nem no bloco do painel, por isso aparece como ocioso;
- no painel ao vivo, a pausa aparece só como "pausa", sem o motivo.

## O que muda
1. As pausas destas encomendas passam a ser guardadas com o motivo, como as dos volumes.
2. O tempo trabalhado nelas passa a contar como produtivo no relatório e no painel.
3. O painel ao vivo mostra o motivo da pausa também nestes casos.
Nada muda no que já funciona por volume.

## Detalhes técnicos
- Migração: `stage_pauses.order_coli_stage_id` passa a aceitar nulo; nova coluna `order_stage_id` (FK order_stages) e uma regra que exige uma das duas.
- Novo trigger em `stage_time_logs` (espelho de `coli_logs_track_pauses`): abre a pausa em `pausar`, fecha em `retomar`/`finalizar`, e grava os intervalos trabalhados numa nova tabela `stage_work_intervals` (GRANT + RLS iguais a `coli_stage_work_intervals`).
- `set_open_pause_reason` continua igual (procura a pausa aberta do operador, seja qual for a origem).
- `idle_report_impl`: o bloco `work` junta `stage_work_intervals` e etapas `order_stages` em curso sem volumes; pausas já vêm de `stage_pauses`.
- `get_public_factory_panel` (running): motivo lido pelo `order_stage_id` quando não há volume.
- Manter os GRANT EXECUTE a service_role/authenticated em todas as funções recriadas.
