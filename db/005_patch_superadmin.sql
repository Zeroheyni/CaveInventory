-- ============================================================
-- PATCH: super-admin do sistema (vê/gerencia TODAS as campanhas)
--
-- Diferente de `role = 'master'` (que só manda na PRÓPRIA campanha),
-- isso é uma flag independente de campanha: `profiles.is_superadmin`.
-- Só deve ser ligada manualmente, direto no banco, pra uma conta de
-- confiança (não existe fluxo de auto-promoção no app).
-- ============================================================

alter table profiles add column if not exists is_superadmin boolean not null default false;

create or replace function is_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_superadmin from profiles where id = auth.uid()), false)
$$;

grant execute on function is_superadmin() to authenticated;

-- CAMPAIGNS: super-admin vê, cria, edita e apaga qualquer campanha
create policy "campanha: superadmin ve tudo" on campaigns
  for select using (is_superadmin());
create policy "campanha: superadmin cria qualquer" on campaigns
  for insert with check (is_superadmin());
create policy "campanha: superadmin atualiza qualquer" on campaigns
  for update using (is_superadmin());
create policy "campanha: superadmin deleta qualquer" on campaigns
  for delete using (is_superadmin());

-- PROFILES: super-admin vê todos os perfis (pra listar membros/donos de personagem)
create policy "perfis: superadmin ve tudo" on profiles
  for select using (is_superadmin());

-- CHARACTERS: super-admin vê e edita o personagem de qualquer jogador
create policy "personagem: superadmin ve tudo" on characters
  for select using (is_superadmin());
create policy "personagem: superadmin edita tudo" on characters
  for update using (is_superadmin());

-- Habilita Realtime em characters (necessário pro painel acompanhar
-- ao vivo o inventário de um jogador enquanto ele mexe nele)
alter publication supabase_realtime add table characters;
