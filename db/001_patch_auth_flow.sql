-- ============================================================
-- PATCH: fluxo de autenticação/onboarding (rodar DEPOIS do schema.sql)
--
-- O schema original não tem política de INSERT em `campaigns` nem em
-- `profiles`, então nenhum usuário conseguiria criar sua própria
-- campanha ou seu próprio perfil sob RLS. Também não há como um
-- jogador *sem campanha ainda* enxergar seu próprio perfil (a política
-- de SELECT em profiles compara campaign_id = current_campaign_id(),
-- que dá NULL = NULL antes de entrar numa campanha) nem como ele
-- localizar uma campanha pelo código de convite (SELECT em campaigns
-- também depende de já pertencer a ela).
--
-- Em vez de abrir política de SELECT ampla em `campaigns` (exporia
-- nome/master de todas as campanhas a qualquer usuário logado), as
-- duas ações de onboarding viram funções SECURITY DEFINER: o cliente
-- nunca insere direto em campaigns/profiles, só chama a função.
-- ============================================================

-- Permite que o usuário veja a própria linha em profiles mesmo antes
-- de ter campaign_id (necessário pro app decidir qual tela mostrar).
create policy "perfis: usuário vê o próprio" on profiles
  for select using (id = auth.uid());

-- ---------- CRIAR CAMPANHA (usuário vira mestre) ----------
create or replace function create_campaign(p_name text, p_username text)
returns table (campaign_id uuid, invite_code text)
language plpgsql security definer set search_path = public as $$
declare v_campaign_id uuid;
begin
  if exists (select 1 from profiles where id = auth.uid() and campaign_id is not null) then
    raise exception 'Você já pertence a uma campanha.';
  end if;

  insert into campaigns (name, master_id) values (p_name, auth.uid())
    returning id into v_campaign_id;

  insert into profiles (id, campaign_id, username, role)
    values (auth.uid(), v_campaign_id, p_username, 'master')
  on conflict (id) do update
    set campaign_id = excluded.campaign_id, username = excluded.username, role = 'master';

  insert into public_currency (campaign_id) values (v_campaign_id)
    on conflict (campaign_id) do nothing;

  return query select v_campaign_id, c.invite_code from campaigns c where c.id = v_campaign_id;
end;
$$;

-- ---------- ENTRAR COM CÓDIGO DE CONVITE (usuário vira jogador) ----------
create or replace function join_campaign(p_invite_code text, p_username text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_campaign_id uuid;
begin
  if exists (select 1 from profiles where id = auth.uid() and campaign_id is not null) then
    raise exception 'Você já pertence a uma campanha.';
  end if;

  select id into v_campaign_id from campaigns where invite_code = lower(trim(p_invite_code));
  if v_campaign_id is null then
    raise exception 'Código de convite inválido.';
  end if;

  insert into profiles (id, campaign_id, username, role)
    values (auth.uid(), v_campaign_id, p_username, 'player')
  on conflict (id) do update
    set campaign_id = excluded.campaign_id, username = excluded.username;

  return v_campaign_id;
end;
$$;

grant execute on function create_campaign(text, text) to authenticated;
grant execute on function join_campaign(text, text) to authenticated;
