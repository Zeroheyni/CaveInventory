-- ============================================================
-- PATCH: mestre global (is_superadmin) edita campanhas de qualquer
-- pessoa (ex: carga máxima do público)
--
-- Mesmo problema de 007_patch_public_area_master_access.sql e da
-- policy de discord_config em 008_patch_discord_bot.sql: a policy
-- "campanha: só o mestre atualiza" (schema.sql) exige
-- master_id = auth.uid(), que nunca bate pro mestre global (o campo
-- master_id nem é setado quando o mestre global cria a campanha via
-- createCampaignAsAdmin).
-- ============================================================

create policy "campanha: superadmin edita qualquer" on campaigns
  for all using (is_superadmin()) with check (is_superadmin());
