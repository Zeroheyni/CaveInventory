-- Fase 6: banco de NPCs -- reaproveita a tabela characters (mesmo
-- inventário/ficha que já existe pra player) em vez de criar uma
-- tabela paralela. NPC não pertence a nenhuma conta de jogador --
-- owner_id vira nulo pra essas linhas, então a trava de "um
-- personagem por dono por campanha" (characters_campaign_owner_unique,
-- db/022) nem precisa mudar: unique constraint nunca considera duas
-- linhas com owner_id nulo como duplicata entre si.
alter table characters alter column owner_id drop not null;

alter table characters add column is_npc boolean not null default false;
alter table characters add column npc_sheet_type text check (npc_sheet_type in ('completa','simples'));
-- só relevante pra ficha simples -- completa sempre tem status (igual player).
alter table characters add column npc_has_status boolean not null default true;
-- ficha simples sem status não tem vitalidade/estamina pra calcular HP/estamina
-- máximos pela fórmula -- essas colunas, quando preenchidas, vencem a fórmula
-- (ver hpMax/estaminaMax em characterSheet.js).
alter table characters add column hp_max_override integer;
alter table characters add column estamina_max_override integer;
-- dano da ficha simples -- texto livre, sem fórmula (NPC simples não tem
-- status/equipamento pra calcular, igual a arma de player calcula).
alter table characters add column npc_damage text;

alter table characters add constraint characters_npc_owner_check
  check ((is_npc and owner_id is null) or (not is_npc and owner_id is not null));

-- mestre cria/edita/apaga os NPCs da própria campanha -- as policies
-- que já existem ("dono vê e edita", "mestre vê/edita todos") não dão
-- insert/delete pro mestre em linha de outro dono, e aqui não tem
-- dono nenhum mesmo, então precisa de uma policy própria.
create policy "personagem: mestre gerencia npcs" on characters
  for all using (is_npc and is_master() and campaign_id = current_campaign_id())
  with check (is_npc and is_master() and campaign_id = current_campaign_id());

-- NPC não é jogador -- não pode aparecer na lista de "pra quem transferir
-- moeda" junto dos players de verdade.
create or replace function list_campaign_players(p_campaign_id uuid)
returns table(character_id uuid, character_name text, username text)
language sql security definer stable as $$
  select c.id, c.name, p.username
  from characters c
  join profiles p on p.id = c.owner_id
  where c.campaign_id = p_campaign_id
    and not c.is_npc
    and (current_campaign_id() = p_campaign_id or is_superadmin())
  order by p.username;
$$;
