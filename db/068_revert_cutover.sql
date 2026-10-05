-- ============================================================================
-- REVERSÃO do corte (db/068_patch_cutover.sql) -- só use se algo der errado de verdade.
-- Recria as policies antigas a partir de backup_20261005.dropped_policies, devolve o ADM à conta Mestre e
-- reabre a edição de `profiles`. NÃO desfaz: a senha da Zeroh (não há como saber a antiga), o SET NULL das
-- FKs (inofensivo), nem as funções temporárias do gerador (voltam por db/063 se precisar).
-- ============================================================================
do $$
declare r record;
begin
  for r in select * from backup_20261005.dropped_policies order by dropped_at, tablename, policyname loop
    if not exists (select 1 from pg_policies where schemaname = r.schemaname and tablename = r.tablename and policyname = r.policyname) then
      execute r.ddl;
    end if;
  end loop;
end $$;

drop policy if exists "personagem: dono vê e edita (v3)" on characters;

update profiles set is_superadmin = true where lower(username) = 'mestre';

grant update on profiles to authenticated;
grant insert, delete on profiles to authenticated;

grant execute on function create_campaign(text, text), join_campaign(text, text),
  complete_player_account(uuid, text), delete_player_account(uuid) to authenticated;

-- (a unique antiga (campaign_id, owner_id) só pode voltar se nenhuma conta tiver 2 personagens na mesma mesa)
-- alter table characters add constraint characters_campaign_owner_unique unique (campaign_id, owner_id);

create or replace function has_compartment_permission(comp_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
           select 1 from public_compartments c
           where c.id = comp_id and (is_master_of(c.campaign_id) or is_transport_admin_of(c.campaign_id))
         )
         or is_master() or is_transport_admin()
         or exists (select 1 from compartment_permissions where compartment_id = comp_id and user_id = auth.uid())
$$;
