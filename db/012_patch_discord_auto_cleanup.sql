-- ============================================================
-- PATCH: bot do Discord apaga sozinho as mensagens que ficam obsoletas
-- quando a coisa que elas representam é excluída (personagem, conta de
-- jogador, ou campanha inteira).
--
-- Hoje só existe limpeza automática pra COMPARTIMENTO PÚBLICO excluído
-- (discord_sync_public_compartments_trg, 008) -- personagem excluído e
-- campanha excluída nunca disparavam nada, e as mensagens ficavam pra
-- sempre no canal.
--
-- Por que BEFORE DELETE (e não AFTER, como o resto do bot)?
-- discord_character_config/discord_public_messages/discord_config têm
-- "on delete cascade" a partir de characters/campaigns -- então, se a
-- limpeza rodasse depois (AFTER DELETE, ou pior, só reagindo à chamada
-- assíncrona do pg_net que roda DEPOIS do commit), o channel_id e os
-- IDs de mensagem já teriam sumido junto no cascade antes da function
-- do Discord conseguir lê-los. BEFORE DELETE lê essas linhas enquanto
-- elas ainda existem e manda os IDs prontos no corpo da chamada, sem
-- depender de reconsultar o banco depois.
-- ============================================================

create or replace function trg_notify_discord_character_deleted()
returns trigger language plpgsql security definer as $$
declare
  secret text;
  cfg record;
  all_ids jsonb;
begin
  select decrypted_secret into secret from vault.decrypted_secrets
    where name = 'discord_sync_shared_secret';
  if secret is null then return old; end if;

  select channel_id, inventory_message_ids, transport_message_ids into cfg
    from discord_character_config where character_id = old.id;
  if cfg.channel_id is null then return old; end if;

  all_ids := coalesce(cfg.inventory_message_ids, '[]'::jsonb) || coalesce(cfg.transport_message_ids, '[]'::jsonb);
  if jsonb_array_length(all_ids) = 0 then return old; end if;

  perform net.http_post(
    url := 'https://oswkabxzlnytgspxizyn.functions.supabase.co/discord-cleanup-messages',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', secret),
    body := jsonb_build_object('channel_id', cfg.channel_id, 'message_ids', all_ids)
  );
  return old;
end;
$$;

create trigger discord_cleanup_character_trg
  before delete on characters
  for each row execute function trg_notify_discord_character_deleted();

create or replace function trg_notify_discord_campaign_deleted()
returns trigger language plpgsql security definer as $$
declare
  secret text;
  chan text;
  all_ids jsonb := '[]'::jsonb;
  r record;
begin
  select decrypted_secret into secret from vault.decrypted_secrets
    where name = 'discord_sync_shared_secret';
  if secret is null then return old; end if;

  select channel_id into chan from discord_config where campaign_id = old.id;
  if chan is null then return old; end if;

  for r in select message_ids from discord_public_messages where campaign_id = old.id loop
    all_ids := all_ids || coalesce(r.message_ids, '[]'::jsonb);
  end loop;
  if jsonb_array_length(all_ids) = 0 then return old; end if;

  perform net.http_post(
    url := 'https://oswkabxzlnytgspxizyn.functions.supabase.co/discord-cleanup-messages',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', secret),
    body := jsonb_build_object('channel_id', chan, 'message_ids', all_ids)
  );
  return old;
end;
$$;

create trigger discord_cleanup_campaign_trg
  before delete on campaigns
  for each row execute function trg_notify_discord_campaign_deleted();
