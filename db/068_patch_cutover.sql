-- ============================================================================
-- FASE 5 -- CORTE (contrair do expandir/contrair)
--
-- O cliente novo (fase 4) já está no ar e as policies v2 (fase 2) já cobrem tudo. Aqui:
--   1. verificações de segurança (aborta se algo não bate)
--   2. guarda a definição de TODA policy que vai sair (backup_20261005.dropped_policies) -> db/068_revert_cutover.sql
--   3. derruba as policies antigas (as que dependem de "campanha atual"/"mestre global")
--   4. Mestre deixa de ser ADM (Zeroh continua); `profiles` só aceita editar o tema
--   5. fecha RPCs abertas (create_campaign, join_campaign, complete_player_account, delete_player_account)
--   6. libera mais de um personagem por dono/mesa; personagem só pode ser criado/movido dentro de mesa onde a conta é membro
--   7. FKs de autoria viram SET NULL (excluir conta não trava por causa de item criado por ela)
--   8. permissão de compartimento sem o atalho antigo `is_master()` (que valeria pra QUALQUER mestre)
--   9. remove as funções temporárias do gerador (_mig_v2_*)
-- A senha da Zeroh NÃO fica aqui: é definida à parte, por SQL pontual.
-- Nenhuma linha de dados é apagada.
-- ============================================================================

-- 1) verificações -----------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from profiles where lower(username) = 'mestre';
  if n <> 1 then raise exception 'esperava exatamente 1 conta "Mestre", achei %', n; end if;
  if not exists (select 1 from profiles where lower(username) = 'zeroh' and is_superadmin) then
    raise exception 'a conta Zeroh precisa existir e ser ADM antes do corte';
  end if;
  if exists (select 1 from campaigns where master_id is null) then
    raise exception 'há campanha sem dono (master_id)';
  end if;
  if exists (select 1 from campaigns c where not exists
      (select 1 from campaign_members m where m.campaign_id = c.id and m.user_id = c.master_id and m.role = 'master')) then
    raise exception 'há campanha cujo dono não é membro mestre';
  end if;
  if exists (select 1 from characters c where c.owner_id is not null and not exists
      (select 1 from campaign_members m where m.campaign_id = c.campaign_id and m.user_id = c.owner_id)) then
    raise exception 'há personagem cujo dono não é membro da campanha';
  end if;
  select count(*) into n from _mig_v2_plan() p where p.nota = 'ok'
    and not exists (select 1 from pg_policies q where q.schemaname = 'public' and q.tablename = p.tbl and q.policyname = p.novo_nome);
  if n > 0 then raise exception '% policies antigas sem gêmea v2', n; end if;
end $$;

-- 2) backup das policies que saem ---------------------------------------------
create table if not exists backup_20261005.dropped_policies (
  schemaname text, tablename text, policyname text, ddl text, dropped_at timestamptz not null default now()
);

create or replace function _cut_policy_ddl(p pg_policies) returns text language sql as $$
  select format('create policy %I on %I.%I as %s for %s to %s%s%s',
    p.policyname, p.schemaname, p.tablename, p.permissive, p.cmd, array_to_string(p.roles, ', '),
    case when p.qual is not null then ' using (' || p.qual || ')' else '' end,
    case when p.with_check is not null then ' with check (' || p.with_check || ')' else '' end)
$$;

-- 3) policies antigas -----------------------------------------------------------
do $$
declare
  r pg_policies;
  n int := 0;
begin
  for r in
    select * from pg_policies p
    where p.policyname not like '%(v2)'
      and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ~ 'current_campaign_id\(\)|is_master\(\)|is_transport_admin\(\)'
      and p.schemaname in ('public', 'storage')
  loop
    insert into backup_20261005.dropped_policies (schemaname, tablename, policyname, ddl)
      values (r.schemaname, r.tablename, r.policyname, _cut_policy_ddl(r));
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    n := n + 1;
  end loop;
  raise notice 'policies antigas removidas: %', n;
end $$;

-- personagem: o dono mexe no que é dele, mas só dentro de mesa onde é membro (antes dava pra criar/mover pra qualquer campanha)
do $$
declare r pg_policies;
begin
  select * into r from pg_policies where schemaname = 'public' and tablename = 'characters' and policyname = 'personagem: dono vê e edita';
  if found then
    insert into backup_20261005.dropped_policies (schemaname, tablename, policyname, ddl)
      values (r.schemaname, r.tablename, r.policyname, _cut_policy_ddl(r));
    drop policy "personagem: dono vê e edita" on characters;
  end if;
end $$;
drop policy if exists "personagem: dono vê e edita (v3)" on characters;
create policy "personagem: dono vê e edita (v3)" on characters
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and is_member_of(campaign_id));

-- 4) papéis ------------------------------------------------------------------------
update profiles set is_superadmin = false, role = 'master' where lower(username) = 'mestre';

-- `profiles`: cada um só edita o próprio TEMA (o resto -- papel, ADM, campanha, flags, Discord -- só por RPC/Edge Function)
revoke update on profiles from authenticated, anon;
grant update (theme) on profiles to authenticated;
revoke insert, delete on profiles from authenticated, anon;

-- 5) RPCs abertas --------------------------------------------------------------------
revoke execute on function create_campaign(text, text) from public, anon, authenticated;
revoke execute on function join_campaign(text, text) from public, anon, authenticated;
revoke execute on function complete_player_account(uuid, text) from public, anon, authenticated;
revoke execute on function delete_player_account(uuid) from public, anon, authenticated;

-- 6) vários personagens por dono/mesa --------------------------------------------------
alter table characters drop constraint if exists characters_campaign_owner_unique;

-- 7) autoria sem travar exclusão de conta ----------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select con.conname, rel.relname as tbl, att.attname as col
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.contype = 'f' and ns.nspname = 'public'
      and con.confrelid = 'auth.users'::regclass
      and con.confdeltype = 'a'                 -- NO ACTION (trava a exclusão)
      and not att.attnotnull                    -- só colunas que aceitam nulo
      and att.attname in ('created_by', 'updated_by', 'granted_by')
  loop
    execute format('alter table public.%I drop constraint %I', r.tbl, r.conname);
    execute format('alter table public.%I add constraint %I foreign key (%I) references auth.users(id) on delete set null',
      r.tbl, r.conname, r.col);
    raise notice 'FK % . % agora é SET NULL', r.tbl, r.col;
  end loop;
end $$;

-- 8) permissão de compartimento: sem o atalho global antigo --------------------------------
create or replace function has_compartment_permission(comp_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
           select 1 from public_compartments c
           where c.id = comp_id and (is_master_of(c.campaign_id) or is_transport_admin_of(c.campaign_id))
         )
         or exists (select 1 from compartment_permissions where compartment_id = comp_id and user_id = auth.uid())
$$;

-- 9) limpeza do gerador ---------------------------------------------------------------------
drop function if exists _mig_v2_apply();
drop function if exists _mig_v2_plan();
drop function if exists _mig_v2_rewrite(text, boolean);
drop function if exists _cut_policy_ddl(pg_policies);
