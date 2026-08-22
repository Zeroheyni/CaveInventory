-- ============================================================
-- SCHEMA: Inventário RPG multiplayer (Supabase / Postgres)
-- Rodar isso inteiro no SQL Editor do Supabase, ou como
-- migration via `supabase migration new schema_inicial`
-- ============================================================

create extension if not exists "pgcrypto";

-- ============================================================
-- TABELAS
-- ============================================================

-- ---------- CAMPANHAS ----------
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  master_id uuid references auth.users(id) on delete set null,
  invite_code text unique not null default substr(md5(random()::text), 1, 8),
  max_carga_publico numeric not null default 50,
  created_at timestamptz not null default now()
);

-- ---------- PERFIS (estende auth.users do Supabase) ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  username text not null,
  role text not null default 'player' check (role in ('master','player')),
  is_transport_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- PERSONAGENS (inventário pessoal — 1 blob JSON por dono, baixo risco de conflito) ----------
create table characters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Personagem',
  max_carga numeric not null default 60,
  currency jsonb not null default '{"bronze":0,"silver":0,"gold":0,"platinum":0}'::jsonb,
  data jsonb not null default '{}'::jsonb, -- itens, recipientes, equipamento (mesmo formato do app atual)
  updated_at timestamptz not null default now()
);

-- ---------- COMPARTIMENTOS DA ÁREA PÚBLICA ----------
create table public_compartments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  name text not null,
  collapsed boolean not null default false,
  currency jsonb not null default '{"bronze":0,"silver":0,"gold":0,"platinum":0}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- PERMISSÕES POR COMPARTIMENTO ----------
create table compartment_permissions (
  compartment_id uuid not null references public_compartments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (compartment_id, user_id)
);

-- ---------- RECIPIENTES DA ÁREA PÚBLICA (aceitam aninhamento e podem viver dentro de um compartimento) ----------
create table public_containers (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  name text not null,
  own_weight numeric not null default 0,
  max_slots integer not null default 4,
  tag text not null default 'bolsa',
  collapsed boolean not null default false,
  parent_container_id uuid references public_containers(id) on delete cascade,
  compartment_id uuid references public_compartments(id) on delete set null,
  position integer not null default 0,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

-- ---------- ITENS DA ÁREA PÚBLICA ----------
create table public_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  name text not null,
  weight numeric not null default 0,
  qty integer not null default 1,
  tag text not null default 'outro',
  max_uses integer,
  uses integer,
  durability integer,
  max_durability integer,
  description text,
  ammo_linked boolean not null default false,
  ammo_item_id uuid references public_items(id) on delete set null,
  damage text,
  range text,
  pinned boolean not null default false,
  container_id uuid references public_containers(id) on delete cascade,
  compartment_id uuid references public_compartments(id) on delete set null,
  position integer not null default 0,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

-- ---------- MOEDA AVULSA DO PÚBLICO (uma linha por campanha) ----------
create table public_currency (
  campaign_id uuid primary key references campaigns(id) on delete cascade,
  bronze integer not null default 0,
  silver integer not null default 0,
  gold integer not null default 0,
  platinum integer not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------- CONFIG DO BOT DO DISCORD ----------
create table discord_config (
  campaign_id uuid primary key references campaigns(id) on delete cascade,
  channel_id text not null,
  message_id text,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- FUNÇÕES AUXILIARES (usadas nas políticas de RLS abaixo)
-- ============================================================

create or replace function current_campaign_id()
returns uuid language sql stable as $$
  select campaign_id from profiles where id = auth.uid()
$$;

create or replace function is_master()
returns boolean language sql stable as $$
  select coalesce((select role = 'master' from profiles where id = auth.uid()), false)
$$;

create or replace function is_transport_admin()
returns boolean language sql stable as $$
  select coalesce((select is_transport_admin from profiles where id = auth.uid()), false)
$$;

create or replace function has_compartment_permission(comp_id uuid)
returns boolean language sql stable as $$
  select is_master() or is_transport_admin() or exists(
    select 1 from compartment_permissions
    where compartment_id = comp_id and user_id = auth.uid()
  )
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table campaigns enable row level security;
alter table profiles enable row level security;
alter table characters enable row level security;
alter table public_compartments enable row level security;
alter table compartment_permissions enable row level security;
alter table public_containers enable row level security;
alter table public_items enable row level security;
alter table public_currency enable row level security;
alter table discord_config enable row level security;

-- CAMPAIGNS
create policy "campanha: membros veem" on campaigns
  for select using (id = current_campaign_id());
create policy "campanha: só o mestre atualiza (ex: carga máxima do público)" on campaigns
  for update using (master_id = auth.uid());

-- PROFILES
create policy "perfis: mesma campanha vê" on profiles
  for select using (campaign_id = current_campaign_id());
create policy "perfis: usuário edita o próprio" on profiles
  for update using (id = auth.uid());
create policy "perfis: mestre edita qualquer perfil da campanha (ex: is_transport_admin)" on profiles
  for update using (is_master() and campaign_id = current_campaign_id());

-- CHARACTERS (inventário pessoal)
create policy "personagem: dono vê e edita" on characters
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
create policy "personagem: mestre vê todos da campanha" on characters
  for select using (is_master() and campaign_id = current_campaign_id());

-- PUBLIC_COMPARTMENTS (criar/renomear/excluir = restrito; ver = todo mundo)
create policy "compartimento: campanha vê" on public_compartments
  for select using (campaign_id = current_campaign_id());
create policy "compartimento: criar só mestre/admin" on public_compartments
  for insert with check (campaign_id = current_campaign_id() and (is_master() or is_transport_admin()));
create policy "compartimento: editar só quem tem permissão" on public_compartments
  for update using (campaign_id = current_campaign_id() and has_compartment_permission(id));
create policy "compartimento: excluir só quem tem permissão" on public_compartments
  for delete using (campaign_id = current_campaign_id() and has_compartment_permission(id));

-- COMPARTMENT_PERMISSIONS (quem concede acesso a um compartimento)
create policy "permissões: campanha vê" on compartment_permissions
  for select using (
    exists(select 1 from public_compartments c where c.id = compartment_id and c.campaign_id = current_campaign_id())
  );
create policy "permissões: só mestre ou admin concede" on compartment_permissions
  for insert with check (is_master() or is_transport_admin());
create policy "permissões: só mestre ou admin revoga" on compartment_permissions
  for delete using (is_master() or is_transport_admin());

-- PUBLIC_CONTAINERS (livre pra todo mundo mover, exceto entrar/sair de compartimento restrito)
create policy "recipiente público: campanha vê" on public_containers
  for select using (campaign_id = current_campaign_id());
create policy "recipiente público: criar (respeita compartimento se houver)" on public_containers
  for insert with check (
    campaign_id = current_campaign_id()
    and (compartment_id is null or has_compartment_permission(compartment_id))
  );
create policy "recipiente público: atualizar (respeita compartimento se houver)" on public_containers
  for update using (campaign_id = current_campaign_id())
  with check (campaign_id = current_campaign_id() and (compartment_id is null or has_compartment_permission(compartment_id)));
create policy "recipiente público: excluir" on public_containers
  for delete using (campaign_id = current_campaign_id());

-- PUBLIC_ITEMS (mesma lógica: livre, exceto quando o destino é um compartimento restrito)
create policy "item público: campanha vê" on public_items
  for select using (campaign_id = current_campaign_id());
create policy "item público: criar (respeita compartimento se houver)" on public_items
  for insert with check (
    campaign_id = current_campaign_id()
    and (compartment_id is null or has_compartment_permission(compartment_id))
  );
create policy "item público: atualizar (respeita compartimento se houver)" on public_items
  for update using (campaign_id = current_campaign_id())
  with check (campaign_id = current_campaign_id() and (compartment_id is null or has_compartment_permission(compartment_id)));
create policy "item público: excluir" on public_items
  for delete using (campaign_id = current_campaign_id());

-- PUBLIC_CURRENCY (moeda avulsa: todo mundo vê e mexe, igual itens soltos)
create policy "moeda pública: campanha vê e mexe" on public_currency
  for all using (campaign_id = current_campaign_id())
  with check (campaign_id = current_campaign_id());

-- DISCORD_CONFIG (só o mestre configura)
create policy "discord config: campanha vê" on discord_config
  for select using (campaign_id = current_campaign_id());
create policy "discord config: só mestre edita" on discord_config
  for all using (campaign_id = current_campaign_id() and is_master())
  with check (campaign_id = current_campaign_id() and is_master());

-- ============================================================
-- REALTIME (permite que o front-end assine mudanças ao vivo)
-- ============================================================
alter publication supabase_realtime add table public_items;
alter publication supabase_realtime add table public_containers;
alter publication supabase_realtime add table public_compartments;
alter publication supabase_realtime add table public_currency;
alter publication supabase_realtime add table compartment_permissions;
