-- ============================================================
-- PATCH: corrige "stack depth limit exceeded" ao consultar profiles
--
-- current_campaign_id() / is_master() / is_transport_admin() fazem
-- "select ... from profiles where id = auth.uid()". Como essas funções
-- são usadas DENTRO das próprias políticas de RLS de `profiles`, e
-- foram criadas sem SECURITY DEFINER, elas rodam com o mesmo usuário
-- que fez a consulta original — ou seja, a consulta interna delas
-- também é filtrada pelas políticas de RLS de profiles, que chamam
-- essas mesmas funções de novo. Isso gera recursão infinita.
--
-- Marcando como SECURITY DEFINER, a função passa a rodar com o dono
-- da função (quem rodou este script no SQL Editor, geralmente isento
-- de RLS), então a consulta interna não reavalia as políticas — a
-- recursão para.
-- ============================================================

create or replace function current_campaign_id()
returns uuid language sql stable security definer set search_path = public as $$
  select campaign_id from profiles where id = auth.uid()
$$;

create or replace function is_master()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'master' from profiles where id = auth.uid()), false)
$$;

create or replace function is_transport_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_transport_admin from profiles where id = auth.uid()), false)
$$;

create or replace function has_compartment_permission(comp_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_master() or is_transport_admin() or exists(
    select 1 from compartment_permissions
    where compartment_id = comp_id and user_id = auth.uid()
  )
$$;
