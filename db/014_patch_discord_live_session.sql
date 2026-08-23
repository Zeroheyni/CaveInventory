-- ============================================================
-- PATCH: modo "sessão ao vivo" do Discord, por campanha
--
-- Ideia do mestre: fora de sessão não precisa empurrar toda edição de
-- inventário pro Discord em tempo real (gera "ruído"/edições
-- constantes no canal) -- só precisa que a mensagem fique correta
-- quando alguém realmente clicar em "🔄 atualizar" (discord-interactions,
-- que continua funcionando do mesmo jeito, sessão ligada ou não). Em
-- sessão, continua tudo em tempo real como já era.
--
-- Os triggers de characters/public_* (008) continuam disparando pra
-- TODAS as escritas (não dá pra evitar isso sem reescrever o pipeline
-- de trigger inteiro) -- o que muda é a própria função de notificação
-- checar `campaigns.discord_live_session` antes de chamar o pg_net;
-- fora de sessão ela simplesmente não faz a chamada HTTP nenhuma.
--
-- A limpeza automática de mensagem por exclusão (012, BEFORE DELETE em
-- characters/campaigns) continua funcionando igual, sessão ligada ou
-- não -- excluir personagem/campanha sempre limpa a mensagem, isso não
-- tem relação com sessão ao vivo.
-- ============================================================

alter table campaigns add column discord_live_session boolean not null default false;

create or replace function trg_notify_discord_sync_character()
returns trigger language plpgsql security definer as $$
declare
  secret text;
  row_data jsonb;
  live boolean;
begin
  select decrypted_secret into secret from vault.decrypted_secrets
    where name = 'discord_sync_shared_secret';
  if secret is null then
    return coalesce(new, old);
  end if;

  select discord_live_session into live from campaigns where id = coalesce(new.campaign_id, old.campaign_id);
  if not coalesce(live, false) then
    return coalesce(new, old); -- fora de sessão: só sincroniza no clique manual de "🔄 atualizar"
  end if;

  row_data := to_jsonb(coalesce(new, old));
  perform net.http_post(
    url := 'https://oswkabxzlnytgspxizyn.functions.supabase.co/discord-sync-character',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', secret),
    body := jsonb_build_object('character', row_data)
  );
  return coalesce(new, old);
end;
$$;

create or replace function trg_notify_discord_sync_public()
returns trigger language plpgsql security definer as $$
declare
  secret text;
  cid uuid;
  live boolean;
begin
  select decrypted_secret into secret from vault.decrypted_secrets
    where name = 'discord_sync_shared_secret';
  if secret is null then
    return coalesce(new, old);
  end if;

  cid := coalesce(new.campaign_id, old.campaign_id);
  select discord_live_session into live from campaigns where id = cid;
  if not coalesce(live, false) then
    return coalesce(new, old); -- fora de sessão: só sincroniza no clique manual de "🔄 atualizar"
  end if;

  perform net.http_post(
    url := 'https://oswkabxzlnytgspxizyn.functions.supabase.co/discord-sync-public',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', secret),
    body := jsonb_build_object('campaign_id', cid)
  );
  return coalesce(new, old);
end;
$$;
