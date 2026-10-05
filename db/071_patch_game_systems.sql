-- ============================================================================
-- Sistemas de regras por campanha (Fase 6)
--   * game_systems: catálogo dos sistemas cadastrados (hoje só o "Cave Story"; entram outros quando o dono mandar as regras)
--   * campaigns.system: sistema da campanha (todas as atuais ficam em 'cave-story')
--   * characters.system_data: ficha de sistemas novos (o Cave Story continua nas colunas atuais, nada é migrado)
--   * mestre escolhe o sistema ao criar a mesa; só o ADM troca depois (e só se não houver personagens)
-- ============================================================================

create table if not exists game_systems (
  id text primary key,
  label text not null,
  description text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table game_systems enable row level security;
drop policy if exists "sistemas: todos leem" on game_systems;
create policy "sistemas: todos leem" on game_systems for select to authenticated using (true);

insert into game_systems (id, label, description)
values ('cave-story', 'Cave Story', 'O sistema original do site: 7 atributos, vida/estamina, XP por nível, inventário com carga.')
on conflict (id) do nothing;

alter table campaigns add column if not exists system text not null default 'cave-story' references game_systems(id);
alter table characters add column if not exists system_data jsonb not null default '{}'::jsonb;

drop function if exists master_create_campaign(text, uuid);
create or replace function master_create_campaign(p_name text, p_master_id uuid default null, p_system text default 'cave-story')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_master uuid;
  v_id uuid;
begin
  if p_name is null or length(trim(p_name)) < 2 then raise exception 'dê um nome pra campanha'; end if;
  if not exists (select 1 from game_systems where id = coalesce(p_system, 'cave-story') and enabled) then
    raise exception 'sistema de regras indisponível';
  end if;
  if is_admin() then
    v_master := coalesce(p_master_id, auth.uid());
  else
    if not is_any_master() then raise exception 'só conta de mestre cria campanha'; end if;
    v_master := auth.uid();
  end if;
  insert into campaigns (name, master_id, system) values (trim(p_name), v_master, coalesce(p_system, 'cave-story')) returning id into v_id;
  insert into campaign_members (campaign_id, user_id, role) values (v_id, v_master, 'master')
    on conflict (campaign_id, user_id) do update set role = 'master';
  return v_id;
end $$;
grant execute on function master_create_campaign(text, uuid, text) to authenticated;

create or replace function admin_set_campaign_system(p_campaign_id uuid, p_system text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'só o ADM troca o sistema de uma campanha'; end if;
  if not exists (select 1 from game_systems where id = p_system and enabled) then raise exception 'sistema de regras indisponível'; end if;
  if exists (select 1 from characters where campaign_id = p_campaign_id and not is_npc) then
    raise exception 'a campanha já tem personagens -- as fichas de um sistema não valem em outro';
  end if;
  update campaigns set system = p_system where id = p_campaign_id;
end $$;
grant execute on function admin_set_campaign_system(uuid, text) to authenticated;

-- o dono da mesa tem UPDATE na própria campanha; sem isso ele trocaria o sistema por fora da RPC
create or replace function trg_lock_campaign_system()
returns trigger language plpgsql as $$
begin
  if new.system is distinct from old.system and not (is_admin() or current_user in ('postgres', 'service_role', 'supabase_admin')) then
    raise exception 'só o ADM troca o sistema de uma campanha';
  end if;
  return new;
end $$;
drop trigger if exists campaigns_lock_system on campaigns;
create trigger campaigns_lock_system before update on campaigns for each row execute function trg_lock_campaign_system();
