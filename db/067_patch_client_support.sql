-- ============================================================================
-- FASE 4 (apoio ao cliente, parte 2)
--   * mestre da mesa lê o vínculo de canal do Discord dos personagens DELA (antes só o ADM lia)
--   * campaign_members entra no realtime (lista de membros da área pública atualiza ao vivo)
-- ============================================================================

drop policy if exists "discord personagem: mestre da mesa lê (v2)" on discord_character_config;
create policy "discord personagem: mestre da mesa lê (v2)" on discord_character_config
  for select using (exists (select 1 from characters c where c.id = character_id and is_master_of(c.campaign_id)));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campaign_members') then
    alter publication supabase_realtime add table public.campaign_members;
  end if;
end $$;
