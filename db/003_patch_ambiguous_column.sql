-- ============================================================
-- PATCH: corrige "column reference campaign_id is ambiguous"
--
-- create_campaign() declara "returns table (campaign_id uuid, ...)",
-- o que faz o Postgres criar uma variável implícita chamada
-- `campaign_id` visível em toda a função. Ela colide com a coluna
-- `campaign_id` de `profiles` na checagem "já pertence a uma
-- campanha?", que estava sem qualificar a tabela.
-- ============================================================

create or replace function create_campaign(p_name text, p_username text)
returns table (campaign_id uuid, invite_code text)
language plpgsql security definer set search_path = public as $$
declare v_campaign_id uuid;
begin
  if exists (select 1 from profiles p where p.id = auth.uid() and p.campaign_id is not null) then
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

grant execute on function create_campaign(text, text) to authenticated;
