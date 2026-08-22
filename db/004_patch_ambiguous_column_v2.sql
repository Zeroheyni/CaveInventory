-- ============================================================
-- PATCH: corrige "column reference campaign_id is ambiguous" (de vez)
--
-- O patch 003 qualificou a referência na cláusula EXISTS, mas não
-- era a única colisão: "insert into public_currency (campaign_id)
-- ... on conflict (campaign_id) do nothing" também dá esse erro,
-- porque a lista de colunas do ON CONFLICT é resolvida pelo mesmo
-- mecanismo do PL/pgSQL que colide com a variável implícita
-- `campaign_id` criada por "returns table (campaign_id uuid, ...)".
--
-- Em vez de caçar cada ocorrência (frágil — qualquer nova consulta
-- unqualified campaign_id na função quebra de novo), renomeamos as
-- colunas de retorno pra não colidir com nenhuma coluna de tabela.
-- Não afeta o front-end: create_campaign() no cliente (src/campaign.js)
-- nunca leu o valor de retorno.
--
-- IMPORTANTE: rode o DROP e o CREATE em duas execuções separadas no
-- SQL Editor (selecione e rode uma instrução, depois a outra). Como
-- os nomes das colunas de retorno mudaram, precisa de DROP antes do
-- CREATE — e se as duas forem enviadas juntas numa única execução e
-- o CREATE falhar por qualquer motivo, o Postgres desfaz o DROP
-- também (é tudo uma transação só), então a mensagem de erro
-- "cannot change return type" volta a aparecer.
-- ============================================================

drop function if exists create_campaign(text, text);

create function create_campaign(p_name text, p_username text)
returns table (out_campaign_id uuid, out_invite_code text)
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
