-- Automação de combate do Magic Learning: Pontos de Ação (6 por rodada, ação e reação saem do mesmo total) e Exaustão por participante.
--   pa_left / pa_round : PA que restam e em QUE rodada isso vale (rodada nova = 6 de novo, calculado na leitura -- nada a resetar)
--   exh_round          : rodada em que o participante "agiu exausto" (0 PE: rola 1d6 de PA e ganha +1 de exaustão; as ações dessa rodada não gastam PE)
--   exaustao           : nível de exaustão (−2 em testes e CE por nível; desmaia no limite da ficha)
alter table combat_participants add column if not exists pa_left integer;
alter table combat_participants add column if not exists pa_round integer;
alter table combat_participants add column if not exists exh_round integer;
alter table combat_participants add column if not exists exaustao integer not null default 0;
