-- ============================================================
-- PATCH: canal do Discord DA FICHA (separado do canal do INVENTÁRIO)
--
-- Cada personagem pode ter DOIS vínculos com o bot:
--   - canal do inventário (discord_character_config, 008): inventário + espaço pessoal
--   - canal da ficha     (discord_sheet_config, esta migration): a ficha do jogador no formato
--     NOME/IDADE/GÊNERO... + atributos + vantagens/desvantagens (Edge Function discord-sync-sheet)
-- Podem ser o mesmo canal ou canais diferentes. Tabela própria pra não mexer no que já está em produção.
-- ============================================================

create table if not exists discord_sheet_config (
  character_id uuid primary key references characters(id) on delete cascade,
  channel_id text not null,
  message_ids jsonb not null default '[]'::jsonb,
  content_hash text, -- hash do último texto enviado: sem mudança na ficha, não edita a mensagem à toa
  updated_at timestamptz not null default now()
);
alter table discord_sheet_config enable row level security;
drop policy if exists "discord ficha: mestre da mesa" on discord_sheet_config;
create policy "discord ficha: mestre da mesa" on discord_sheet_config
  for all
  using (is_admin() or exists (select 1 from characters c where c.id = character_id and is_master_of(c.campaign_id)))
  with check (is_admin() or exists (select 1 from characters c where c.id = character_id and is_master_of(c.campaign_id)));

-- vincula (ou troca) o canal da ficha de um personagem; canal vazio desvincula
create or replace function set_character_discord_sheet_channel(p_character_id uuid, p_channel_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_campaign uuid;
  v_chan text := nullif(trim(coalesce(p_channel_id, '')), '');
begin
  select campaign_id into v_campaign from characters where id = p_character_id;
  if v_campaign is null or not is_master_of(v_campaign) then
    raise exception 'só o mestre da campanha vincula canal da ficha';
  end if;
  if v_chan is null then
    delete from discord_sheet_config where character_id = p_character_id;
    return;
  end if;
  insert into discord_sheet_config (character_id, channel_id) values (p_character_id, v_chan)
    on conflict (character_id) do update set channel_id = excluded.channel_id, message_ids = '[]'::jsonb, content_hash = null;
  perform request_discord_sync('character', p_character_id);
end $$;
grant execute on function set_character_discord_sheet_channel(uuid, text) to authenticated;

-- 'character' agora também atualiza a ficha no Discord; 'campaign' atualiza as fichas de todos os personagens vinculados
create or replace function request_discord_sync(p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_campaign uuid;
  v_secret text;
  v_fn text;
  v_body jsonb;
  r record;
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
  -- fichas (canal da ficha)
  if p_kind = 'character' then
    if exists (select 1 from discord_sheet_config where character_id = p_id) then
      perform net.http_post(
        url := 'https://oswkabxzlnytgspxizyn.functions.supabase.co/discord-sync-sheet',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
        body := jsonb_build_object('character_id', p_id)
      );
    end if;
  elsif p_kind = 'campaign' then
    for r in select s.character_id from discord_sheet_config s join characters c on c.id = s.character_id where c.campaign_id = v_campaign loop
      perform net.http_post(
        url := 'https://oswkabxzlnytgspxizyn.functions.supabase.co/discord-sync-sheet',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
        body := jsonb_build_object('character_id', r.character_id)
      );
    end loop;
  end if;
end $$;

-- em sessão ao vivo, mudou algo da ficha -> atualiza a mensagem (só colunas que a ficha usa; a função ainda compara o hash)
create or replace function trg_notify_discord_sync_sheet()
returns trigger language plpgsql security definer as $$
declare
  secret text;
  live boolean;
begin
  if not exists (select 1 from discord_sheet_config where character_id = new.id) then return new; end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'discord_sync_shared_secret';
  if secret is null then return new; end if;
  select discord_live_session into live from campaigns where id = new.campaign_id;
  if not coalesce(live, false) then return new; end if; -- fora de sessão: só no "atualizar"
  perform net.http_post(
    url := 'https://oswkabxzlnytgspxizyn.functions.supabase.co/discord-sync-sheet',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', secret),
    body := jsonb_build_object('character_id', new.id, 'only_if_changed', true)
  );
  return new;
end $$;

drop trigger if exists discord_sync_sheet_trg on characters;
create trigger discord_sync_sheet_trg
  after update of name, level, sheet_data, system_data, vitalidade, forca, agilidade, destreza, inteligencia, estamina, observacao
  on characters
  for each row execute function trg_notify_discord_sync_sheet();

-- personagem excluído: apaga as mensagens da ficha no canal (BEFORE DELETE, pelo mesmo motivo da 012)
create or replace function trg_notify_discord_sheet_deleted()
returns trigger language plpgsql security definer as $$
declare
  secret text;
  cfg record;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'discord_sync_shared_secret';
  if secret is null then return old; end if;
  select channel_id, message_ids into cfg from discord_sheet_config where character_id = old.id;
  if cfg.channel_id is null or jsonb_array_length(coalesce(cfg.message_ids, '[]'::jsonb)) = 0 then return old; end if;
  perform net.http_post(
    url := 'https://oswkabxzlnytgspxizyn.functions.supabase.co/discord-cleanup-messages',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', secret),
    body := jsonb_build_object('channel_id', cfg.channel_id, 'message_ids', cfg.message_ids)
  );
  return old;
end $$;

drop trigger if exists discord_cleanup_sheet_trg on characters;
create trigger discord_cleanup_sheet_trg
  before delete on characters
  for each row execute function trg_notify_discord_sheet_deleted();
