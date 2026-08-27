-- Fase 8 — diário de sessão: o mestre registra data, título e resumo de
-- cada sessão de jogo; jogadores só leem. Tabela dedicada por campanha
-- (N registros), mesmo padrão de campaign_combat/combat_participants
-- (db/015_patch_combat.sql) -- nunca JSONB dentro de campaigns.

create table session_journal (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  session_date date not null,
  title text not null,
  summary text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index session_journal_campaign_idx on session_journal(campaign_id, session_date desc);

alter table session_journal enable row level security;

create policy "diário: campanha vê" on session_journal
  for select using (campaign_id = current_campaign_id());
create policy "diário: mestre edita" on session_journal
  for all using (campaign_id = current_campaign_id() and is_master())
  with check (campaign_id = current_campaign_id() and is_master());
create policy "diário: superadmin mexe" on session_journal
  for all using (is_superadmin()) with check (is_superadmin());

alter publication supabase_realtime add table session_journal;
alter table session_journal replica identity full; -- DELETE de entrada antiga filtra por campaign_id, não é PK
