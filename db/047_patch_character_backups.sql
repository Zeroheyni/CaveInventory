-- Backup dos inventários. Motivo: inventários sumindo (Gregory, depois
-- Craig -- zerado em 28/08 sem ninguém perceber por semanas). O plano
-- gratuito do Supabase NÃO tem backup automático, e uma linha de
-- `characters` regravada por inteiro (data/currency são um blob só, ver
-- db/020) não deixa histórico nenhum -- o valor antigo simplesmente some.
--
-- Aqui o PRÓPRIO BANCO guarda uma foto da versão que está prestes a ser
-- substituída, num trigger BEFORE UPDATE (então vale pra QUALQUER caminho
-- de escrita: app, RPC, SQL na mão), nesses casos:
--   'zerado'    -- a gravação deixa o inventário sem item/recipiente/moeda
--                  nenhuma e ele tinha alguma coisa (sempre grava, sem
--                  limite de frequência -- é O caso que importa);
--   'reducao'   -- a gravação joga itens+recipientes pra menos da metade
--                  (sempre grava);
--   'periodico' -- no máximo 1 a cada 15 min por personagem, pra ter
--                  histórico de "como estava ontem" mesmo sem acidente.
-- Retenção: periódicos 14 dias; zerado/redução/manual 180 dias.
--
-- Limite honesto: vive no MESMO projeto Supabase -- protege de erro de
-- app/usuário (o caso real até agora), não de perder o projeto inteiro.

create or replace function inv_items_count(p_data jsonb) returns integer language sql immutable as $$
  select coalesce(case when jsonb_typeof(p_data->'items') = 'array' then jsonb_array_length(p_data->'items') end, 0)
$$;
create or replace function inv_containers_count(p_data jsonb) returns integer language sql immutable as $$
  select coalesce(case when jsonb_typeof(p_data->'containers') = 'array' then jsonb_array_length(p_data->'containers') end, 0)
$$;
create or replace function inv_coins(p_currency jsonb) returns numeric language sql immutable as $$
  select coalesce(sum(case when v.value ~ '^[0-9]+(\.[0-9]+)?$' then v.value::numeric else 0 end), 0)
  from jsonb_each_text(case when jsonb_typeof(p_currency) = 'object' then p_currency else '{}'::jsonb end) v
$$;

create table character_backups (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references characters(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  reason text not null check (reason in ('inicial', 'periodico', 'reducao', 'zerado', 'manual', 'antes_de_restaurar')),
  data jsonb not null,
  currency jsonb,
  items_count integer not null,
  containers_count integer not null,
  inventory_updated_at timestamptz, -- versão do inventário que essa foto guarda
  created_at timestamptz not null default now()
);
create index character_backups_character_idx on character_backups(character_id, created_at desc);

-- Só leitura pro mestre (da campanha) e superadmin. NENHUMA policy de
-- insert/update/delete: quem escreve aqui é só o trigger e as RPCs
-- abaixo (security definer) -- nem o mestre consegue apagar/editar um
-- backup pela API.
alter table character_backups enable row level security;
create policy "backups: mestre da campanha vê" on character_backups
  for select using (campaign_id = current_campaign_id() and is_master());
create policy "backups: superadmin vê" on character_backups
  for select using (is_superadmin());

create or replace function trg_backup_character_inventory()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_n integer; v_new_n integer;
  v_old_coins numeric; v_new_coins numeric;
  v_reason text; v_last timestamptz;
begin
  -- restore_character_backup já grava a própria foto "antes_de_restaurar"
  if current_setting('app.skip_backup', true) = '1' then return new; end if;
  if new.data is not distinct from old.data and new.currency is not distinct from old.currency then return new; end if;

  v_old_n := inv_items_count(old.data) + inv_containers_count(old.data);
  v_new_n := inv_items_count(new.data) + inv_containers_count(new.data);
  v_old_coins := inv_coins(old.currency);
  v_new_coins := inv_coins(new.currency);
  if v_old_n = 0 and v_old_coins = 0 then return new; end if; -- nada a proteger

  if v_new_n = 0 and v_new_coins = 0 then
    v_reason := 'zerado';
  elsif v_old_n > 0 and v_new_n * 2 < v_old_n then
    v_reason := 'reducao';
  else
    select max(created_at) into v_last from character_backups where character_id = old.id;
    if v_last is null or v_last < now() - interval '15 minutes' then v_reason := 'periodico'; end if;
  end if;

  if v_reason is not null then
    insert into character_backups (character_id, campaign_id, reason, data, currency, items_count, containers_count, inventory_updated_at)
    values (old.id, old.campaign_id, v_reason, coalesce(old.data, '{}'::jsonb), old.currency,
            inv_items_count(old.data), inv_containers_count(old.data), old.inventory_updated_at);
    delete from character_backups
      where character_id = old.id
        and ((reason = 'periodico' and created_at < now() - interval '14 days') or created_at < now() - interval '180 days');
  end if;
  return new;
end;
$$;

create trigger character_inventory_backup_trg
  before update of data, currency on characters
  for each row execute function trg_backup_character_inventory();

-- ponto de partida: foto do que existe agora (quem já está vazio não tem o que salvar)
insert into character_backups (character_id, campaign_id, reason, data, currency, items_count, containers_count, inventory_updated_at)
select id, campaign_id, 'inicial', coalesce(data, '{}'::jsonb), currency, inv_items_count(data), inv_containers_count(data), inventory_updated_at
from characters
where inv_items_count(data) + inv_containers_count(data) > 0 or inv_coins(currency) > 0;

-- ---------- restaurar (só mestre) ----------
create or replace function restore_character_backup(p_backup_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  b character_backups%rowtype;
  c characters%rowtype;
begin
  select * into b from character_backups where id = p_backup_id;
  if b.id is null then raise exception 'backup não encontrado'; end if;
  if not (is_superadmin() or (is_master() and b.campaign_id = current_campaign_id())) then
    raise exception 'só o mestre restaura backup de inventário';
  end if;
  select * into c from characters where id = b.character_id for update;
  if c.id is null then raise exception 'personagem não existe mais'; end if;

  -- o estado ATUAL vira um backup também -- restaurar nunca destrói nada
  insert into character_backups (character_id, campaign_id, reason, data, currency, items_count, containers_count, inventory_updated_at)
  values (c.id, c.campaign_id, 'antes_de_restaurar', coalesce(c.data, '{}'::jsonb), c.currency,
          inv_items_count(c.data), inv_containers_count(c.data), c.inventory_updated_at);

  perform set_config('app.skip_backup', '1', true);
  -- inventory_updated_at novo: quem estiver com a tela aberta vê que
  -- mudou (Realtime) e recarrega, em vez de gravar por cima com versão velha
  update characters
    set data = b.data,
        currency = coalesce(b.currency, c.currency),
        inventory_updated_at = now(),
        updated_at = now()
    where id = c.id;
  perform set_config('app.skip_backup', '0', true);
end;
$$;
grant execute on function restore_character_backup(uuid) to authenticated;

-- ---------- backup manual (só mestre) ----------
create or replace function create_character_backup(p_character_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c characters%rowtype;
begin
  select * into c from characters where id = p_character_id;
  if c.id is null then raise exception 'personagem não encontrado'; end if;
  if not (is_superadmin() or (is_master() and c.campaign_id = current_campaign_id())) then
    raise exception 'só o mestre cria backup de inventário';
  end if;
  insert into character_backups (character_id, campaign_id, reason, data, currency, items_count, containers_count, inventory_updated_at)
  values (c.id, c.campaign_id, 'manual', coalesce(c.data, '{}'::jsonb), c.currency,
          inv_items_count(c.data), inv_containers_count(c.data), c.inventory_updated_at);
end;
$$;
grant execute on function create_character_backup(uuid) to authenticated;
