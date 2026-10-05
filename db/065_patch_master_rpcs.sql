-- ============================================================================
-- FASE 3 (parte 1) -- RPCs de gestão para MESTRES independentes (aditivo)
--
-- O mestre (conta de mestre, dono de campanhas) gerencia só o que é DELE:
--   master_create_campaign     cria campanha (mestre vira dono + membro mestre)
--   add_member_by_nickname     vincula uma conta de jogador JÁ existente à campanha
--   remove_member              tira alguém da campanha (não apaga conta nem personagem)
--   master_create_character    cria personagem na campanha e atribui a um membro
--   assign_character_owner     passa um personagem pra outra conta (membro)
--   set_member_flags           ver HP dos outros / iniciativa oculta / admin de transporte, POR MESA
--   set_player_discord_id      @ do Discord do jogador (qualquer mestre de uma mesa em comum)
--   request_discord_sync       pede sincronização do Discord (usa o segredo do Vault, como os triggers)
-- A criação/exclusão de CONTAS (auth.users) é da Edge Function `account-admin` (service role).
-- Contas de mestre: `profiles.role = 'master'` passa a significar "conta de mestre" (pode criar campanhas);
-- 'player' = conta de jogador. O papel dentro de cada mesa vem de `campaign_members.role`.
-- ============================================================================

create or replace function master_create_campaign(p_name text, p_master_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_master uuid;
  v_id uuid;
begin
  if p_name is null or length(trim(p_name)) < 2 then raise exception 'dê um nome pra campanha'; end if;
  if is_admin() then
    v_master := coalesce(p_master_id, auth.uid());
  else
    if not is_any_master() then raise exception 'só conta de mestre cria campanha'; end if;
    v_master := auth.uid();
  end if;
  insert into campaigns (name, master_id) values (trim(p_name), v_master) returning id into v_id;
  insert into campaign_members (campaign_id, user_id, role) values (v_id, v_master, 'master')
    on conflict (campaign_id, user_id) do update set role = 'master';
  return v_id;
end $$;

create or replace function add_member_by_nickname(p_campaign_id uuid, p_nickname text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
  n int;
begin
  if not is_master_of(p_campaign_id) then raise exception 'só o mestre da campanha vincula jogadores'; end if;
  select count(*), min(id) into n, v_uid from profiles where lower(username) = lower(trim(p_nickname));
  if n = 0 then raise exception 'nenhuma conta com o apelido "%"', p_nickname; end if;
  if n > 1 then raise exception 'mais de uma conta com o apelido "%" -- fale com o ADM', p_nickname; end if;
  insert into campaign_members (campaign_id, user_id, role) values (p_campaign_id, v_uid, 'player')
    on conflict (campaign_id, user_id) do nothing;
  return v_uid;
end $$;

create or replace function remove_member(p_campaign_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_master_of(p_campaign_id) then raise exception 'só o mestre da campanha tira alguém dela'; end if;
  if exists (select 1 from campaigns where id = p_campaign_id and master_id = p_user_id) then
    raise exception 'o dono da campanha não pode ser removido';
  end if;
  if exists (select 1 from characters where campaign_id = p_campaign_id and owner_id = p_user_id) then
    raise exception 'essa conta ainda tem personagens nessa campanha -- passe-os pra outra conta ou exclua antes';
  end if;
  delete from campaign_members where campaign_id = p_campaign_id and user_id = p_user_id and role <> 'master';
end $$;

create or replace function master_create_character(p_campaign_id uuid, p_name text, p_owner_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not is_master_of(p_campaign_id) then raise exception 'só o mestre da campanha cria personagens'; end if;
  if p_name is null or length(trim(p_name)) < 1 then raise exception 'dê um nome ao personagem'; end if;
  if not exists (select 1 from campaign_members where campaign_id = p_campaign_id and user_id = p_owner_id) then
    raise exception 'vincule a conta do jogador à campanha antes de criar o personagem';
  end if;
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
  if not exists (select 1 from campaign_members where campaign_id = c.campaign_id and user_id = p_owner_id) then
    raise exception 'vincule a conta do jogador à campanha antes';
  end if;
  update characters set owner_id = p_owner_id where id = p_character_id;
end $$;

create or replace function set_member_flags(
  p_campaign_id uuid, p_user_id uuid,
  p_can_see_others_hp boolean default null,
  p_can_see_hidden_initiative boolean default null,
  p_is_transport_admin boolean default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_master_of(p_campaign_id) then raise exception 'só o mestre da campanha muda permissões'; end if;
  update campaign_members set
    can_see_others_hp = coalesce(p_can_see_others_hp, can_see_others_hp),
    can_see_hidden_initiative = coalesce(p_can_see_hidden_initiative, can_see_hidden_initiative),
    is_transport_admin = coalesce(p_is_transport_admin, is_transport_admin)
  where campaign_id = p_campaign_id and user_id = p_user_id;
end $$;

create or replace function set_player_discord_id(p_user_id uuid, p_discord_user_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or exists (
      select 1 from campaign_members t
      where t.user_id = p_user_id and is_master_of(t.campaign_id))) then
    raise exception 'só o mestre de uma mesa em comum define o Discord do jogador';
  end if;
  update profiles set discord_user_id = nullif(trim(p_discord_user_id), '') where id = p_user_id;
end $$;

-- p_kind: 'public' (área pública), 'campaign' (tudo da campanha), 'character' (um personagem; p_id = id do personagem)
create or replace function request_discord_sync(p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_campaign uuid;
  v_secret text;
  v_fn text;
  v_body jsonb;
begin
  if p_kind = 'character' then
    select campaign_id into v_campaign from characters where id = p_id;
    v_fn := 'discord-sync-character';
    v_body := jsonb_build_object('character_id', p_id);
  elsif p_kind in ('public', 'campaign') then
    v_campaign := p_id;
    v_fn := case when p_kind = 'public' then 'discord-sync-public' else 'discord-sync-campaign-all' end;
    v_body := jsonb_build_object('campaign_id', p_id);
  else
    raise exception 'tipo de sincronização inválido';
  end if;
  if v_campaign is null or not is_master_of(v_campaign) then
    raise exception 'só o mestre da campanha sincroniza o Discord dela';
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'discord_sync_shared_secret';
  if v_secret is null then raise exception 'segredo de sincronização não configurado'; end if;
  perform net.http_post(
    url := 'https://oswkabxzlnytgspxizyn.functions.supabase.co/' || v_fn,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body := v_body
  );
end $$;

grant execute on function master_create_campaign(text, uuid), add_member_by_nickname(uuid, text), remove_member(uuid, uuid),
  master_create_character(uuid, text, uuid), assign_character_owner(uuid, uuid),
  set_member_flags(uuid, uuid, boolean, boolean, boolean), set_player_discord_id(uuid, text),
  request_discord_sync(text, uuid) to authenticated;

-- vínculo de um personagem com um canal do Discord (a tabela só tinha policy de ADM)
create or replace function set_character_discord_channel(p_character_id uuid, p_channel_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_campaign uuid;
begin
  select campaign_id into v_campaign from characters where id = p_character_id;
  if v_campaign is null or not is_master_of(v_campaign) then
    raise exception 'só o mestre da campanha vincula canal de personagem';
  end if;
  insert into discord_character_config (character_id, channel_id) values (p_character_id, p_channel_id)
    on conflict (character_id) do update set channel_id = excluded.channel_id;
  perform request_discord_sync('character', p_character_id);
end $$;
grant execute on function set_character_discord_channel(uuid, text) to authenticated;
