-- ============================================================
-- PATCH: separa "turno" de "rodada" no rastreador de combate
--
-- Rodada != turno: uma rodada é um ciclo completo (todo mundo já
-- agiu uma vez). "Passar o turno" move quem está primeiro na lista
-- pro final, e todo mundo sobe uma posição -- depois de N passagens
-- de turno (N = quantidade de participantes), fecha o ciclo e a
-- rodada avança sozinha.
-- ============================================================

alter table campaign_combat
  add column turns_passed_this_round integer not null default 0;
