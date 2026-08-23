-- ============================================================
-- PATCH: mestre global (is_superadmin) acessa a Área Pública de
-- qualquer campanha
--
-- As políticas de RLS de public_compartments/compartment_permissions/
-- public_containers/public_items/public_currency (schema.sql) exigem
-- `campaign_id = current_campaign_id()`, ou seja, o perfil de quem
-- chama precisa pertencer àquela campanha especificamente. Isso fazia
-- sentido quando "mestre" era o dono de UMA campanha só (dono via
-- profiles.campaign_id), mas com o pivô pro mestre global único (Fase
-- "login por apelido"), o perfil do Mestre tem campaign_id = null pra
-- sempre -- então ele nunca conseguia abrir o Baú Compartilhado de
-- nenhuma campanha (erro "new row violates row-level security policy").
--
-- Mesmo padrão de db/005_patch_superadmin.sql: políticas extra usando
-- só is_superadmin(), sem exigir campaign_id = current_campaign_id().
-- Políticas permissivas do Postgres se combinam com OR, então isso só
-- adiciona um bypass pro mestre global, sem alterar as regras normais
-- de jogador/admin do baú já existentes.
-- ============================================================

-- PUBLIC_COMPARTMENTS
create policy "compartimento: superadmin ve tudo" on public_compartments
  for select using (is_superadmin());
create policy "compartimento: superadmin cria" on public_compartments
  for insert with check (is_superadmin());
create policy "compartimento: superadmin atualiza" on public_compartments
  for update using (is_superadmin());
create policy "compartimento: superadmin deleta" on public_compartments
  for delete using (is_superadmin());

-- COMPARTMENT_PERMISSIONS
create policy "permissões: superadmin ve tudo" on compartment_permissions
  for select using (is_superadmin());
create policy "permissões: superadmin concede" on compartment_permissions
  for insert with check (is_superadmin());
create policy "permissões: superadmin revoga" on compartment_permissions
  for delete using (is_superadmin());

-- PUBLIC_CONTAINERS
create policy "recipiente público: superadmin ve tudo" on public_containers
  for select using (is_superadmin());
create policy "recipiente público: superadmin cria" on public_containers
  for insert with check (is_superadmin());
create policy "recipiente público: superadmin atualiza" on public_containers
  for update using (is_superadmin()) with check (is_superadmin());
create policy "recipiente público: superadmin deleta" on public_containers
  for delete using (is_superadmin());

-- PUBLIC_ITEMS
create policy "item público: superadmin ve tudo" on public_items
  for select using (is_superadmin());
create policy "item público: superadmin cria" on public_items
  for insert with check (is_superadmin());
create policy "item público: superadmin atualiza" on public_items
  for update using (is_superadmin()) with check (is_superadmin());
create policy "item público: superadmin deleta" on public_items
  for delete using (is_superadmin());

-- PUBLIC_CURRENCY
create policy "moeda pública: superadmin mexe" on public_currency
  for all using (is_superadmin()) with check (is_superadmin());

-- PROFILES: mesmo problema pra conceder/revogar is_transport_admin --
-- a política "perfis: mestre edita qualquer perfil da campanha" (schema.sql)
-- também exige campaign_id = current_campaign_id(), que nunca bate pro
-- mestre global.
create policy "perfis: superadmin edita qualquer" on profiles
  for update using (is_superadmin()) with check (is_superadmin());
