-- ============================================================
-- PATCH: bot do Discord (Fase 3)
--
-- Guarda o vínculo canal↔personagem e canal↔campanha que o mestre
-- configura manualmente pelo painel, e as tabelas de rastreio de
-- mensagem (pra saber o que editar em vez de reenviar). O disparo em
-- si (Postgres trigger -> Edge Function) fica orientado a evento: só
-- roda quando uma linha muda de verdade, sem nenhum polling/cron.
--
-- IMPORTANTE — segredo compartilhado (fora deste arquivo, de propósito):
-- pra o trigger provar pra Edge Function que a chamada veio do banco (e
-- não de qualquer um batendo na URL pública da function), guardamos um
-- valor aleatório no Supabase Vault. Isso é feito rodando UMA VEZ, à mão,
-- no SQL Editor (não commitar o valor em lugar nenhum):
--   select vault.create_secret('<valor aleatório longo>', 'discord_sync_shared_secret');
-- O mesmo valor precisa ir pro secret DISCORD_SYNC_SHARED_SECRET das
-- Edge Functions (via `supabase secrets set`).
-- ============================================================

-- ---------- CONFIG DO CANAL DE TRANSPORTE PÚBLICO (por campanha) ----------
-- discord_config já existe (schema.sql) com channel_id + message_id (singular).
-- Como a área pública agora vira N mensagens (uma por compartimento + uma
-- "avulso"), a coluna message_id singular nunca foi usada e não serve mais.
alter table discord_config drop column if exists message_id;

-- Mesmo problema de 007_patch_public_area_master_access.sql: a política
-- "discord config: só mestre edita" (schema.sql) exige campaign_id =
-- current_campaign_id(), que nunca bate pro mestre global (is_superadmin).
create policy "discord config: superadmin mexe" on discord_config
  for all using (is_superadmin()) with check (is_superadmin());

-- ---------- UMA LINHA POR SEÇÃO POSTADA NO CANAL DE TRANSPORTE ----------
-- compartment_id = null representa a seção "avulso" (itens/recipientes soltos
-- + moeda avulsa da campanha, public_currency).
create table discord_public_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  compartment_id uuid references public_compartments(id) on delete cascade,
  message_ids jsonb not null default '[]'::jsonb, -- array de IDs de mensagem do Discord (texto longo vira várias)
  updated_at timestamptz not null default now(),
  unique (campaign_id, compartment_id)
);
create unique index discord_public_messages_avulso_uidx
  on discord_public_messages (campaign_id) where compartment_id is null;

-- ---------- CONFIG + RASTREIO DE MENSAGEM POR PERSONAGEM ----------
create table discord_character_config (
  character_id uuid primary key references characters(id) on delete cascade,
  channel_id text not null,
  inventory_message_ids jsonb not null default '[]'::jsonb,
  transport_message_ids jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- RLS — só o mestre global (is_superadmin) mexe nisso; é fiação de bot,
-- não algo que o jogador precisa ver ou editar (mesmo padrão de
-- 007_patch_public_area_master_access.sql).
-- ============================================================
alter table discord_public_messages enable row level security;
alter table discord_character_config enable row level security;

create policy "discord público: superadmin mexe" on discord_public_messages
  for all using (is_superadmin()) with check (is_superadmin());
create policy "discord personagem: superadmin mexe" on discord_character_config
  for all using (is_superadmin()) with check (is_superadmin());

-- ============================================================
-- TRIGGERS -> EDGE FUNCTIONS (via pg_net, com segredo compartilhado)
-- ============================================================
create extension if not exists pg_net;

create or replace function trg_notify_discord_sync_character()
returns trigger language plpgsql security definer as $$
declare
  secret text;
  row_data jsonb;
begin
  select decrypted_secret into secret from vault.decrypted_secrets
    where name = 'discord_sync_shared_secret';
  if secret is null then
    return coalesce(new, old); -- segredo ainda não configurado: não quebra a escrita, só não sincroniza
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

create trigger discord_sync_character_trg
  after insert or update on characters
  for each row execute function trg_notify_discord_sync_character();

create or replace function trg_notify_discord_sync_public()
returns trigger language plpgsql security definer as $$
declare
  secret text;
  cid uuid;
begin
  select decrypted_secret into secret from vault.decrypted_secrets
    where name = 'discord_sync_shared_secret';
  if secret is null then
    return coalesce(new, old);
  end if;
  cid := coalesce(new.campaign_id, old.campaign_id);
  perform net.http_post(
    url := 'https://oswkabxzlnytgspxizyn.functions.supabase.co/discord-sync-public',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', secret),
    body := jsonb_build_object('campaign_id', cid)
  );
  return coalesce(new, old);
end;
$$;

create trigger discord_sync_public_items_trg
  after insert or update or delete on public_items
  for each row execute function trg_notify_discord_sync_public();
create trigger discord_sync_public_containers_trg
  after insert or update or delete on public_containers
  for each row execute function trg_notify_discord_sync_public();
create trigger discord_sync_public_compartments_trg
  after insert or update or delete on public_compartments
  for each row execute function trg_notify_discord_sync_public();
create trigger discord_sync_public_currency_trg
  after insert or update or delete on public_currency
  for each row execute function trg_notify_discord_sync_public();
