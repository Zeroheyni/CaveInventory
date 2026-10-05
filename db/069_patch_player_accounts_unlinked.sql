-- ============================================================================
-- Conta de jogador NÃO é vinculada a mesa: quem se vincula à mesa é o PERSONAGEM.
--   * o vínculo conta<->mesa (campaign_members, usado pelo RLS) passa a ser consequência: nasce quando o mestre
--     cria/atribui um personagem da mesa àquela conta e some quando a conta fica sem personagem naquela mesa
--   * list_player_accounts(): mestre/ADM enxergam as contas de jogador pra poder atribuir personagem
--     (conta nova, sem mesa, não aparece nas policies de `profiles`)
-- ============================================================================

create or replace function list_player_accounts()
returns table(id uuid, username text)
language sql stable security definer set search_path = public as $$
  select p.id, p.username from profiles p
  where (is_admin() or is_any_master()) and p.role = 'player' and not p.is_superadmin
  order by lower(p.username)
$$;
grant execute on function list_player_accounts() to authenticated;

create or replace function master_create_character(p_campaign_id uuid, p_name text, p_owner_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not is_master_of(p_campaign_id) then raise exception 'só o mestre da campanha cria personagens'; end if;
  if p_name is null or length(trim(p_name)) < 1 then raise exception 'dê um nome ao personagem'; end if;
  if not exists (select 1 from profiles where id = p_owner_id) then raise exception 'conta do jogador não encontrada'; end if;
  insert into campaign_members (campaign_id, user_id, role) values (p_campaign_id, p_owner_id, 'player')
    on conflict (campaign_id, user_id) do nothing;
  insert into characters (campaign_id, owner_id, name) values (p_campaign_id, p_owner_id, trim(p_name))
    returning id into v_id;
  return v_id;
end $$;

create or replace function assign_character_owner(p_character_id uuid, p_owner_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c characters%rowtype;
begin
  select * into c from characters where id = p_character_id for update;
  if c.id is null then raise exception 'personagem não encontrado'; end if;
  if not is_master_of(c.campaign_id) then raise exception 'só o mestre da campanha atribui personagens'; end if;
  if c.is_npc then raise exception 'NPC não tem dono'; end if;
  if not exists (select 1 from profiles where id = p_owner_id) then raise exception 'conta do jogador não encontrada'; end if;
  insert into campaign_members (campaign_id, user_id, role) values (c.campaign_id, p_owner_id, 'player')
    on conflict (campaign_id, user_id) do nothing;
  update characters set owner_id = p_owner_id where id = p_character_id;
end $$;

-- quando a conta fica sem personagem na mesa, o vínculo (e as permissões por mesa dela) sai junto
create or replace function trg_cleanup_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.owner_id is not null
     and (tg_op = 'DELETE' or new.owner_id is distinct from old.owner_id or new.campaign_id is distinct from old.campaign_id) then
    if not exists (select 1 from characters where campaign_id = old.campaign_id and owner_id = old.owner_id and id <> old.id) then
      delete from campaign_members where campaign_id = old.campaign_id and user_id = old.owner_id and role = 'player';
    end if;
  end if;
  return null;
end $$;

drop trigger if exists characters_cleanup_member on characters;
create trigger characters_cleanup_member after update or delete on characters
  for each row execute function trg_cleanup_member();
