-- Fase 8 — corrige bug: discord_config.channel_id era NOT NULL desde a
-- Fase 3 (só existia o canal de transporte público). Com o canal de
-- combate (combat_channel_id, db/033) virando independente, o mestre pode
-- querer vincular só o canal de combate sem nunca ter vinculado o de
-- transporte -- o upsert de setCampaignCombatChannel (src/admin.js) então
-- tenta inserir uma linha nova sem channel_id e quebra a constraint.
-- Os dois canais agora são opcionais e independentes.

alter table discord_config alter column channel_id drop not null;
