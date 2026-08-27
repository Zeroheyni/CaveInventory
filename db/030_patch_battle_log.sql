-- Fase 8 — log de eventos da luta atual (dano, cura, entrada/saída de
-- combatente, aplicação/remoção de condição). Um único mecanismo de
-- eventos com coluna `type`, não uma tabela por tipo. É apagado quando o
-- combate termina (endCombat) -- só mostra a luta ATUAL, sem acumular
-- histórico entre lutas (decisão de produto, não técnica).

create table battle_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  type text not null check (type in ('dano','cura','entrada','saida','condicao_aplicada','condicao_removida')),
  participant_name text not null,
  actor_character_id uuid references characters(id) on delete set null,
  amount integer,
  detail text,
  created_at timestamptz not null default now()
);
create index battle_log_campaign_idx on battle_log(campaign_id, created_at desc);

alter table battle_log enable row level security;

create policy "log de batalha: campanha vê" on battle_log
  for select using (campaign_id = current_campaign_id());
-- mestre grava qualquer evento; jogador só grava eventos do próprio
-- personagem (mesma regra que já vale pra HP/estamina em combat_participants,
-- ver db/015_patch_combat.sql:74-76). RPCs security definer (condições,
-- db/031) não passam por essa policy -- rodam como owner da função.
create policy "log de batalha: mestre ou dono do combatente grava" on battle_log
  for insert with check (
    campaign_id = current_campaign_id()
    and (is_master() or actor_character_id in (select id from characters where owner_id = auth.uid()))
  );
create policy "log de batalha: mestre limpa" on battle_log
  for delete using (campaign_id = current_campaign_id() and is_master());
create policy "log de batalha: superadmin mexe" on battle_log
  for all using (is_superadmin()) with check (is_superadmin());

alter publication supabase_realtime add table battle_log;
alter table battle_log replica identity full; -- DELETE de limpeza (fim de combate) filtra por campaign_id, não é PK
