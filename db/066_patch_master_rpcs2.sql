-- ============================================================================
-- FASE 4 (apoio ao cliente) -- RPCs que faltavam para mestre/ADM (aditivo)
--
--   admin_set_campaign_master   ADM passa a campanha pra outra conta de mestre (vira membro `master`;
--                               o dono antigo continua como membro, mas rebaixado a `player` se não tiver mais nada)
--   master_delete_campaign      mestre DA campanha (ou ADM) exclui a campanha
--   master_delete_character     mestre DA campanha (ou ADM) exclui UM personagem (não mexe na conta)
--   list_campaign_members       membros da campanha com apelido/papel/flags (membro da mesa lê; evita depender de profiles.campaign_id)
-- ============================================================================

create or replace function admin_set_campaign_master(p_campaign_id uuid, p_master_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old uuid;
begin
  if not is_admin() then raise exception 'só o ADM troca o dono de uma campanha'; end if;
  if not exists (select 1 from profiles where id = p_master_id) then raise exception 'conta não encontrada'; end if;
  select master_id into v_old from campaigns where id = p_campaign_id for update;
  if not found then raise exception 'campanha não encontrada'; end if;
  update campaigns set master_id = p_master_id where id = p_campaign_id;
  insert into campaign_members (campaign_id, user_id, role) values (p_campaign_id, p_master_id, 'master')
    on conflict (campaign_id, user_id) do update set role = 'master';
  if v_old is not null and v_old <> p_master_id then
    update campaign_members set role = 'player' where campaign_id = p_campaign_id and user_id = v_old;
  end if;
end $$;

create or replace function master_delete_campaign(p_campaign_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_master_of(p_campaign_id) then raise exception 'só o mestre da campanha a exclui'; end if;
  delete from campaigns where id = p_campaign_id;
end $$;

create or replace function master_delete_character(p_character_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_camp uuid;
begin
  select campaign_id into v_camp from characters where id = p_character_id;
  if v_camp is null then raise exception 'personagem não encontrado'; end if;
  if not is_master_of(v_camp) then raise exception 'só o mestre da campanha exclui personagens dela'; end if;
  delete from characters where id = p_character_id;
end $$;

create or replace function list_campaign_members(p_campaign_id uuid)
returns table(user_id uuid, username text, role text, can_see_others_hp boolean, can_see_hidden_initiative boolean,
              is_transport_admin boolean, discord_user_id text)
language sql stable security definer set search_path = public as $$
  select m.user_id, p.username, m.role, m.can_see_others_hp, m.can_see_hidden_initiative, m.is_transport_admin,
         case when is_master_of(p_campaign_id) then p.discord_user_id else null end
  from campaign_members m
  join profiles p on p.id = m.user_id
  where m.campaign_id = p_campaign_id and is_member_of(p_campaign_id)
  order by (m.role = 'master') desc, lower(p.username)
$$;

grant execute on function admin_set_campaign_master(uuid, uuid), master_delete_campaign(uuid),
  master_delete_character(uuid), list_campaign_members(uuid) to authenticated;
