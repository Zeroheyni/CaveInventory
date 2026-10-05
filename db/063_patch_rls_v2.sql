-- ============================================================================
-- FASE 2 (parte 1) -- RLS v2 por campanha, ADITIVA (EXPANDIR do expandir/contrair)
--
-- Para cada policy atual que depende de `current_campaign_id()` / `is_master()` /
-- `is_transport_admin()` (globais, de "1 conta = 1 campanha"), cria uma policy IRMÃ
-- "<nome> (v2)" PERMISSIVA com a mesma lógica, mas por campanha:
--     campaign_id = current_campaign_id()                  -> is_member_of(campaign_id)
--     is_master() AND campaign_id = current_campaign_id()  -> is_master_of(campaign_id)
--     is_transport_admin()                                 -> is_transport_admin_of(campaign_id)
-- Policies permissivas fazem OR: as antigas continuam valendo (o cliente atual não muda
-- em nada) e as novas já funcionam pra quem é membro/mestre por `campaign_members`.
-- As antigas só saem no CORTE (fase 5). Nada é apagado aqui.
--
-- As policies v2 são GERADAS a partir do `pg_policies` REAL do banco (não de memória do
-- repositório), por isso há uma etapa de PLANO (`_mig_v2_plan()`) pra revisar antes de aplicar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A) Helpers novos
-- ---------------------------------------------------------------------------
create or replace function is_transport_admin_of(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_transport_admin from campaign_members where campaign_id = cid and user_id = auth.uid()), false)
$$;

-- mestre de QUALQUER campanha (ou ADM, ou o papel legado) -- só pra portões "é mestre?" que ainda
-- não sabem a campanha; a checagem de escopo vem depois, com is_master_of(campanha da linha)
create or replace function is_any_master()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_superadmin or role = 'master' from profiles where id = auth.uid()), false)
      or exists (select 1 from campaign_members where user_id = auth.uid() and role = 'master')
      or exists (select 1 from campaigns where master_id = auth.uid())
$$;

-- o usuário e `uid` pertencem a alguma campanha em comum? (ADM vê todo mundo)
create or replace function shares_campaign_with(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select uid is not null and (
    uid = auth.uid()
    or coalesce((select is_superadmin from profiles where id = auth.uid()), false)
    or exists (
      select 1 from campaign_members a
      join campaign_members b on b.campaign_id = a.campaign_id
      where a.user_id = auth.uid() and b.user_id = uid
    )
    or exists (select 1 from campaigns c where c.master_id = auth.uid()
               and exists (select 1 from campaign_members b where b.campaign_id = c.id and b.user_id = uid))
  )
$$;

grant execute on function is_transport_admin_of(uuid), is_any_master(), shares_campaign_with(uuid) to authenticated;

-- permissão de compartimento passa a olhar a campanha DO compartimento (mesma lógica pros dados atuais)
create or replace function has_compartment_permission(comp_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
           select 1 from public_compartments c
           where c.id = comp_id and (is_master_of(c.campaign_id) or is_transport_admin_of(c.campaign_id))
         )
         or is_master() or is_transport_admin()  -- legado (cai no corte)
         or exists (select 1 from compartment_permissions where compartment_id = comp_id and user_id = auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- B) Geração das policies v2 (plano + aplicação)
-- ---------------------------------------------------------------------------
create or replace function _mig_v2_rewrite(e text, has_campaign boolean)
returns text language plpgsql immutable as $$
declare
  r text := e;
  col text := '((?:[a-z_]+\.)?[a-z_]+)';
begin
  if r is null then return null; end if;
  r := regexp_replace(r, 'is_master\(\) AND \(' || col || ' = current_campaign_id\(\)\)', 'is_master_of(\1)', 'gi');
  r := regexp_replace(r, '\(' || col || ' = current_campaign_id\(\)\) AND is_master\(\)', 'is_master_of(\1)', 'gi');
  r := regexp_replace(r, '\(' || col || ' = current_campaign_id\(\)\)', 'is_member_of(\1)', 'gi');
  r := regexp_replace(r, col || ' = current_campaign_id\(\)', 'is_member_of(\1)', 'gi');
  r := regexp_replace(r, 'current_campaign_id\(\) = ' || col, 'is_member_of(\1)', 'gi');
  if has_campaign then
    r := regexp_replace(r, 'is_master\(\)', 'is_master_of(campaign_id)', 'g');
    r := regexp_replace(r, 'is_transport_admin\(\)', 'is_transport_admin_of(campaign_id)', 'g');
  end if;
  return r;
end $$;

-- (a assinatura da tabela retornada mudou: precisa dropar antes de recriar)
drop function if exists _mig_v2_plan();
create or replace function _mig_v2_plan()
returns table(tbl text, policy text, cmd text, nota text, antes text, novo_using text, novo_check text, novo_nome text)
language plpgsql as $$
declare
  r record;
  hc boolean;
  nq text;
  nw text;
begin
  for r in
    select * from pg_policies p
    where p.schemaname = 'public'
      and p.policyname not like '%(v2)'
      and p.tablename <> 'profiles'  -- profiles tem policy v2 própria (mais abaixo)
      and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ~ 'current_campaign_id\(\)|is_master\(\)|is_transport_admin\(\)'
    order by p.tablename, p.policyname
  loop
    hc := exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = r.tablename and c.column_name = 'campaign_id');
    nq := _mig_v2_rewrite(r.qual, hc);
    nw := _mig_v2_rewrite(r.with_check, hc);
    tbl := r.tablename; policy := r.policyname; cmd := r.cmd;
    -- identificador de policy tem no máximo 63 bytes: prefixo curto + hash (nomes longos truncados colidiriam com o original)
    novo_nome := left(r.policyname, 40) || ' ' || substr(md5(r.policyname), 1, 6) || ' (v2)';
    antes := coalesce(r.qual, '') || case when r.with_check is not null then ' || CHECK ' || r.with_check else '' end;
    novo_using := nq; novo_check := nw;
    nota := case
      when coalesce(nq, '') || ' ' || coalesce(nw, '') ~ 'current_campaign_id\(\)|(^|[^_a-z])is_master\(\)|(^|[^_a-z])is_transport_admin\(\)' then 'MANUAL'
      when nq is not distinct from r.qual and nw is not distinct from r.with_check then 'SEM MUDANCA'
      else 'ok' end;
    return next;
  end loop;
end $$;

create or replace function _mig_v2_apply()
returns text language plpgsql as $$
declare
  r record;
  n int := 0;
  pulou int := 0;
  stmt text;
begin
  for r in select * from _mig_v2_plan() loop
    if r.nota <> 'ok' then pulou := pulou + 1; continue; end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = r.tbl and policyname = r.novo_nome) then
      continue;
    end if;
    stmt := format('create policy %I on public.%I as permissive for %s to %s%s%s',
      r.novo_nome, r.tbl, r.cmd,
      (select array_to_string(roles, ', ') from pg_policies where schemaname = 'public' and tablename = r.tbl and policyname = r.policy),
      case when r.novo_using is not null then ' using (' || r.novo_using || ')' else '' end,
      case when r.novo_check is not null then ' with check (' || r.novo_check || ')' else '' end);
    execute stmt;
    n := n + 1;
  end loop;
  return format('policies v2 criadas=%s, puladas (manual/sem mudança)=%s', n, pulou);
end $$;

-- ---------------------------------------------------------------------------
-- C) Policies manuais (o gerador não cobre)
-- ---------------------------------------------------------------------------
-- perfis: cada um vê o próprio, quem divide uma mesa e o ADM
drop policy if exists "perfis: mesa em comum e ADM veem (v2)" on profiles;
create policy "perfis: mesa em comum e ADM veem (v2)" on profiles
  for select using (shares_campaign_with(id));

-- permissões de compartimento: conceder/revogar = mestre ou admin de transporte DA mesa do compartimento
drop policy if exists "permissões: só mestre ou admin concede (v2)" on compartment_permissions;
create policy "permissões: só mestre ou admin concede (v2)" on compartment_permissions
  for insert with check (exists (select 1 from public_compartments c
    where c.id = compartment_id and (is_master_of(c.campaign_id) or is_transport_admin_of(c.campaign_id))));
drop policy if exists "permissões: só mestre ou admin revoga (v2)" on compartment_permissions;
create policy "permissões: só mestre ou admin revoga (v2)" on compartment_permissions
  for delete using (exists (select 1 from public_compartments c
    where c.id = compartment_id and (is_master_of(c.campaign_id) or is_transport_admin_of(c.campaign_id))));

-- storage `avatars`: dono do personagem OU mestre da campanha do personagem/tabuleiro do prefixo
create or replace function storage_can_write_avatar_path(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  seg1 text := split_part(p_name, '/', 1);
  seg2 text := split_part(p_name, '/', 2);
  v_owner uuid;
  v_camp uuid;
begin
  if seg1 = 'boards' then
    if seg2 !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
    select campaign_id into v_camp from boards where id = seg2::uuid;
    return v_camp is not null and is_master_of(v_camp);
  end if;
  if seg1 !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  select owner_id, campaign_id into v_owner, v_camp from characters where id = seg1::uuid;
  if v_camp is null then return false; end if;
  return v_owner = auth.uid() or is_master_of(v_camp);
end $$;
grant execute on function storage_can_write_avatar_path(text) to authenticated;

drop policy if exists "avatars: enviar (v2)" on storage.objects;
create policy "avatars: enviar (v2)" on storage.objects
  for insert to authenticated with check (bucket_id = 'avatars' and storage_can_write_avatar_path(name));
drop policy if exists "avatars: apagar (v2)" on storage.objects;
create policy "avatars: apagar (v2)" on storage.objects
  for delete to authenticated using (bucket_id = 'avatars' and storage_can_write_avatar_path(name));
