-- Fase 8 — aba de rolagem de dados (d4 a d20), histórico compartilhado por
-- campanha em tempo real. Cada rolagem já grava os resultados individuais
-- (não só o total) pra dar transparência de que não teve trapaça.

create table dice_rolls (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  roller_id uuid not null references auth.users(id) on delete cascade,
  roller_name text not null,
  die text not null check (die in ('d4','d6','d8','d10','d12','d20')),
  qty integer not null default 1 check (qty between 1 and 10),
  modifier integer not null default 0,
  results integer[] not null,
  total integer not null,
  created_at timestamptz not null default now()
);
create index dice_rolls_campaign_idx on dice_rolls(campaign_id, created_at desc);

alter table dice_rolls enable row level security;

create policy "dados: campanha vê" on dice_rolls
  for select using (campaign_id = current_campaign_id());
create policy "dados: qualquer membro rola pra si" on dice_rolls
  for insert with check (campaign_id = current_campaign_id() and roller_id = auth.uid());
create policy "dados: mestre limpa o histórico" on dice_rolls
  for delete using (campaign_id = current_campaign_id() and is_master());
create policy "dados: superadmin mexe" on dice_rolls
  for all using (is_superadmin()) with check (is_superadmin());

alter publication supabase_realtime add table dice_rolls;
alter table dice_rolls replica identity full; -- DELETE de limpeza filtra por campaign_id, não é PK
