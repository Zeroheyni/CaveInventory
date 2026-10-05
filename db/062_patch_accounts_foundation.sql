-- ============================================================================
-- FASE 1 -- BASE DE CONTAS (ADITIVA: nada é apagado, nenhum comportamento muda)
--
-- Objetivo do projeto: 1 conta de jogador com vários personagens (de qualquer
-- campanha), mestres independentes que só veem as próprias campanhas, ADM que vê
-- tudo, e papel POR CAMPANHA. Esta migration só PREPARA o terreno:
--
--   1. Snapshot completo dos dados que importam (schema `backup_20261005`, que o
--      PostgREST não expõe) + impressão digital (contagem e md5) de cada tabela.
--   2. `campaign_members`: quem pertence a qual campanha e com qual papel/flags.
--   3. Helpers `is_admin`, `my_campaign_ids`, `is_member_of`, `is_master_of`.
--   4. Backfill dos membros a partir de `profiles` e de `characters.owner_id`.
--   5. `campaigns.master_id` := conta "Mestre" em TODAS as campanhas existentes.
--
-- As policies antigas (current_campaign_id()/is_master()) NÃO são tocadas: o cliente
-- atual continua funcionando igualzinho. As policies novas vêm na migration 063.
-- Idempotente: pode rodar de novo sem duplicar nada (o snapshot NÃO é refeito).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Pré-checagens: aborta ANTES de qualquer mudança se o banco não for o esperado
-- ---------------------------------------------------------------------------
do $$
declare
  n_mestre int;
begin
  select count(*) into n_mestre from profiles where lower(username) = 'mestre';
  if n_mestre <> 1 then
    raise exception 'Fase 1 abortada: esperava exatamente 1 perfil "Mestre", achei %', n_mestre;
  end if;
  if (select count(*) from profiles where is_superadmin) < 1 then
    raise exception 'Fase 1 abortada: nenhum superadmin encontrado';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Snapshot (cópia fiel; só quem tem acesso direto ao banco enxerga)
-- ---------------------------------------------------------------------------
create schema if not exists backup_20261005;
revoke all on schema backup_20261005 from public;
revoke all on schema backup_20261005 from anon, authenticated;

create table if not exists backup_20261005.profiles as table public.profiles;
create table if not exists backup_20261005.campaigns as table public.campaigns;
create table if not exists backup_20261005.characters as table public.characters;
create table if not exists backup_20261005.character_backups as table public.character_backups;
create table if not exists backup_20261005.public_items as table public.public_items;
create table if not exists backup_20261005.public_containers as table public.public_containers;
create table if not exists backup_20261005.public_compartments as table public.public_compartments;
create table if not exists backup_20261005.board_tokens as table public.board_tokens;
create table if not exists backup_20261005.game_high_scores as table public.game_high_scores;
create table if not exists backup_20261005.game_theme_unlocks as table public.game_theme_unlocks;
create table if not exists backup_20261005.custom_bars as table public.custom_bars;
create table if not exists backup_20261005.character_custom_bars as table public.character_custom_bars;

-- impressão digital: contagem + hash de cada linha (comparar depois da migração)
create table if not exists backup_20261005.fingerprint (
  tabela text primary key,
  linhas bigint not null,
  hash text not null,
  tirado_em timestamptz not null default now()
);
insert into backup_20261005.fingerprint (tabela, linhas, hash)
select t.name, t.n, t.h from (
  select 'characters' as name, count(*) as n, coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') as h from public.characters x
  union all select 'profiles', count(*), coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from public.profiles x
  union all select 'campaigns', count(*), coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from public.campaigns x
  union all select 'character_backups', count(*), coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from public.character_backups x
  union all select 'public_items', count(*), coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from public.public_items x
  union all select 'board_tokens', count(*), coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from public.board_tokens x
  union all select 'game_high_scores', count(*), coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from public.game_high_scores x
  union all select 'auth.users', count(*), coalesce(md5(string_agg(md5(x.id::text), '' order by x.id)), '') from auth.users x
) t
on conflict (tabela) do nothing;

-- ---------------------------------------------------------------------------
-- 2) campaign_members
-- ---------------------------------------------------------------------------
create table if not exists campaign_members (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('master', 'player')),
  -- flags que eram da CONTA (profiles) e passam a valer POR MESA
  can_see_others_hp boolean not null default false,
  can_see_hidden_initiative boolean not null default false,
  is_transport_admin boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);
create index if not exists campaign_members_user_idx on campaign_members(user_id);
create index if not exists campaigns_master_idx on campaigns(master_id);

alter table campaign_members enable row level security;

-- ---------------------------------------------------------------------------
-- 3) Helpers (SECURITY DEFINER: leem as tabelas sem passar por RLS, sem recursão)
-- ---------------------------------------------------------------------------
create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_superadmin from profiles where id = auth.uid()), false)
$$;

create or replace function is_member_of(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select cid is not null and (
    coalesce((select is_superadmin from profiles where id = auth.uid()), false)
    or exists (select 1 from campaign_members where campaign_id = cid and user_id = auth.uid())
    or exists (select 1 from campaigns where id = cid and master_id = auth.uid())
  )
$$;

create or replace function is_master_of(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select cid is not null and (
    coalesce((select is_superadmin from profiles where id = auth.uid()), false)
    or exists (select 1 from campaign_members where campaign_id = cid and user_id = auth.uid() and role = 'master')
    or exists (select 1 from campaigns where id = cid and master_id = auth.uid())
  )
$$;

create or replace function my_campaign_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from campaigns where coalesce((select is_superadmin from profiles where id = auth.uid()), false)
  union select campaign_id from campaign_members where user_id = auth.uid()
  union select id from campaigns where master_id = auth.uid()
$$;

grant execute on function is_admin(), is_member_of(uuid), is_master_of(uuid), my_campaign_ids() to authenticated;

-- Policies de campaign_members (só leitura pelo cliente; escrita só por RPC/Edge Function):
-- cada um lê as próprias linhas; o mestre da campanha lê os membros dela; o ADM lê tudo.
drop policy if exists "membros: lê as próprias, o mestre da mesa e o ADM" on campaign_members;
create policy "membros: lê as próprias, o mestre da mesa e o ADM" on campaign_members
  for select using (user_id = auth.uid() or is_master_of(campaign_id) or is_admin());

-- ---------------------------------------------------------------------------
-- 4) Backfill de membros (a partir de profiles e de characters; NUNCA do username)
-- ---------------------------------------------------------------------------
insert into campaign_members (campaign_id, user_id, role, can_see_others_hp, can_see_hidden_initiative, is_transport_admin)
select p.campaign_id, p.id,
       case when p.role = 'master' then 'master' else 'player' end,
       coalesce(p.can_see_others_hp, false),
       coalesce(p.can_see_hidden_initiative, false),
       coalesce(p.is_transport_admin, false)
from profiles p
where p.campaign_id is not null
on conflict (campaign_id, user_id) do nothing;

-- quem é dono de personagem numa campanha é jogador dela (cobre contas sem perfil vinculado)
insert into campaign_members (campaign_id, user_id, role)
select distinct c.campaign_id, c.owner_id, 'player'
from characters c
where c.owner_id is not null
  and exists (select 1 from auth.users u where u.id = c.owner_id)
on conflict (campaign_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 5) Dono das campanhas existentes = conta "Mestre"
-- ---------------------------------------------------------------------------
do $$
declare
  v_mestre uuid;
begin
  select id into v_mestre from profiles where lower(username) = 'mestre';
  update campaigns set master_id = v_mestre where master_id is distinct from v_mestre;
  insert into campaign_members (campaign_id, user_id, role)
  select id, v_mestre, 'master' from campaigns
  on conflict (campaign_id, user_id) do update set role = 'master';
end $$;

-- ---------------------------------------------------------------------------
-- 6) Conferência (o resultado aparece no SQL Editor; qualquer linha com problema = parar)
-- ---------------------------------------------------------------------------
select
  (select count(*) from campaign_members)                                              as membros,
  (select count(*) from campaign_members where role = 'master')                        as mestres,
  (select count(*) from campaigns where master_id is null)                             as campanhas_sem_dono,
  (select count(*) from characters c where c.owner_id is not null
     and not exists (select 1 from campaign_members m where m.campaign_id = c.campaign_id and m.user_id = c.owner_id)) as personagens_sem_membro,
  (select count(*) from profiles p where p.campaign_id is not null
     and not exists (select 1 from campaign_members m where m.campaign_id = p.campaign_id and m.user_id = p.id)) as perfis_sem_membro,
  (select count(*) from characters)                                                    as personagens_agora,
  (select linhas from backup_20261005.fingerprint where tabela = 'characters')        as personagens_snapshot;
