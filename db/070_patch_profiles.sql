-- ============================================================================
-- Perfil da conta (jogador, mestre e ADM): nome de exibição, foto e bio.
--   * `username` continua sendo o apelido de LOGIN (vira o e-mail sintético); `display_name` é o nome mostrado
--   * cada conta edita só o próprio perfil (grant por coluna: theme, display_name, avatar_url, bio)
--   * foto em storage `avatars` sob o prefixo users/<id da conta>/
--   * listas de membros/jogadores devolvem o nome de exibição e a foto
-- ============================================================================

alter table profiles
  add column if not exists display_name text,
  add column if not exists avatar_url text,
  add column if not exists bio text;

alter table profiles drop constraint if exists profiles_display_name_len;
alter table profiles add constraint profiles_display_name_len check (display_name is null or char_length(display_name) <= 40);
alter table profiles drop constraint if exists profiles_bio_len;
alter table profiles add constraint profiles_bio_len check (bio is null or char_length(bio) <= 280);

grant update (display_name, avatar_url, bio) on profiles to authenticated;

-- storage: além de personagem/tabuleiro, a conta escreve em users/<próprio id>/...
create or replace function storage_can_write_avatar_path(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  seg1 text := split_part(p_name, '/', 1);
  seg2 text := split_part(p_name, '/', 2);
  v_owner uuid;
  v_camp uuid;
begin
  if seg1 = 'users' then
    return auth.uid() is not null and seg2 = auth.uid()::text;
  end if;
  if seg1 = 'boards' then
    if seg2 !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
    select campaign_id into v_camp from boards where id = seg2::uuid;
    return v_camp is not null and is_master_of(v_camp);
  end if;
  if seg1 !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  select owner_id, campaign_id into v_owner, v_camp from characters where id = seg1::uuid;
  if v_camp is null then return false; end if;
  return v_owner = auth.uid() or is_master_of(v_camp);
end $$;

drop function if exists list_campaign_members(uuid);
create or replace function list_campaign_members(p_campaign_id uuid)
returns table(user_id uuid, username text, role text, can_see_others_hp boolean, can_see_hidden_initiative boolean,
              is_transport_admin boolean, discord_user_id text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select m.user_id, coalesce(nullif(p.display_name, ''), p.username), m.role, m.can_see_others_hp, m.can_see_hidden_initiative,
         m.is_transport_admin, case when is_master_of(p_campaign_id) then p.discord_user_id else null end, p.avatar_url
  from campaign_members m
  join profiles p on p.id = m.user_id
  where m.campaign_id = p_campaign_id and is_member_of(p_campaign_id)
  order by (m.role = 'master') desc, lower(coalesce(nullif(p.display_name, ''), p.username))
$$;
grant execute on function list_campaign_members(uuid) to authenticated;

drop function if exists list_player_accounts();
create or replace function list_player_accounts()
returns table(id uuid, username text, login text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(p.display_name, ''), p.username), p.username, p.avatar_url from profiles p
  where (is_admin() or is_any_master()) and p.role = 'player' and not p.is_superadmin
  order by lower(coalesce(nullif(p.display_name, ''), p.username))
$$;
grant execute on function list_player_accounts() to authenticated;
