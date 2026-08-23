-- ============================================================
-- PATCH: transferir moeda do personagem pro público (avulso) ou pra
-- outro jogador específico, direto da tela principal de inventário.
--
-- Antes só dava pra transferir moeda dentro da tela do Baú
-- Compartilhado (avulso <-> pessoal <-> compartimento), e nunca deu
-- pra mandar pra OUTRO jogador — não tinha nem como um jogador ver
-- os personagens dos colegas (RLS de `characters` só libera dono e
-- mestre). Em vez de abrir uma policy de SELECT ampla na tabela de
-- personagens (exporia currency/inventário dos outros), uso duas
-- funções SECURITY DEFINER:
--   - list_campaign_players: devolve só id/nome/apelido de quem tem
--     personagem na campanha (pra montar o menu "pra quem"), sem
--     expor currency nem inventário de ninguém.
--   - transfer_currency: débito+crédito atômico numa transação só
--     (evita o bug de "dinheiro sumiu" de transferências em duas
--     escritas separadas do lado do cliente).
-- ============================================================

create or replace function list_campaign_players(p_campaign_id uuid)
returns table(character_id uuid, character_name text, username text)
language sql security definer stable as $$
  select c.id, c.name, p.username
  from characters c
  join profiles p on p.id = c.owner_id
  where c.campaign_id = p_campaign_id
    and (current_campaign_id() = p_campaign_id or is_superadmin())
  order by p.username;
$$;
grant execute on function list_campaign_players(uuid) to authenticated;

create or replace function transfer_currency(
  p_from_character_id uuid,
  p_to_character_id uuid,
  p_to_avulso boolean,
  p_bronze integer,
  p_silver integer,
  p_gold integer,
  p_platinum integer
) returns void
language plpgsql security definer as $$
declare
  v_from record;
  v_to_char record;
  v_to_pub record;
  v_requested bigint;
  v_from_value bigint;
  v_to_value bigint;
  v_new_from_value bigint;
  v_new_to_value bigint;
  v_new_from jsonb;
  v_new_to jsonb;
begin
  if coalesce(p_bronze,0) < 0 or coalesce(p_silver,0) < 0 or coalesce(p_gold,0) < 0 or coalesce(p_platinum,0) < 0 then
    raise exception 'valores negativos não são permitidos';
  end if;
  v_requested := coalesce(p_bronze,0) + coalesce(p_silver,0)*100 + coalesce(p_gold,0)*10000 + coalesce(p_platinum,0)*1000000;
  if v_requested <= 0 then
    raise exception 'informe algum valor pra transferir';
  end if;
  if p_to_avulso = (p_to_character_id is not null) then
    raise exception 'destino inválido (escolha avulso OU um personagem, não os dois)';
  end if;

  select id, owner_id, campaign_id, currency into v_from
    from characters where id = p_from_character_id for update;
  if v_from.id is null then raise exception 'personagem de origem não encontrado'; end if;
  if v_from.owner_id <> auth.uid() and not is_superadmin() then
    raise exception 'você não tem permissão pra mexer nesse personagem';
  end if;

  v_from_value := coalesce((v_from.currency->>'bronze')::bigint,0) + coalesce((v_from.currency->>'silver')::bigint,0)*100
                + coalesce((v_from.currency->>'gold')::bigint,0)*10000 + coalesce((v_from.currency->>'platinum')::bigint,0)*1000000;
  if v_from_value < v_requested then
    raise exception 'saldo insuficiente';
  end if;
  v_new_from_value := v_from_value - v_requested;

  if p_to_avulso then
    select campaign_id, bronze, silver, gold, platinum into v_to_pub
      from public_currency where campaign_id = v_from.campaign_id for update;
    if v_to_pub.campaign_id is null then raise exception 'moeda pública da campanha não encontrada'; end if;
    v_to_value := coalesce(v_to_pub.bronze,0) + coalesce(v_to_pub.silver,0)*100 + coalesce(v_to_pub.gold,0)*10000 + coalesce(v_to_pub.platinum,0)*1000000;
  else
    select id, campaign_id, currency into v_to_char
      from characters where id = p_to_character_id for update;
    if v_to_char.id is null then raise exception 'personagem de destino não encontrado'; end if;
    if v_to_char.campaign_id <> v_from.campaign_id then raise exception 'personagem de destino não é dessa campanha'; end if;
    v_to_value := coalesce((v_to_char.currency->>'bronze')::bigint,0) + coalesce((v_to_char.currency->>'silver')::bigint,0)*100
                + coalesce((v_to_char.currency->>'gold')::bigint,0)*10000 + coalesce((v_to_char.currency->>'platinum')::bigint,0)*1000000;
  end if;
  v_new_to_value := v_to_value + v_requested;

  v_new_from := jsonb_build_object(
    'bronze', v_new_from_value % 100,
    'silver', (v_new_from_value / 100) % 100,
    'gold', (v_new_from_value / 10000) % 100,
    'platinum', v_new_from_value / 1000000
  );
  v_new_to := jsonb_build_object(
    'bronze', v_new_to_value % 100,
    'silver', (v_new_to_value / 100) % 100,
    'gold', (v_new_to_value / 10000) % 100,
    'platinum', v_new_to_value / 1000000
  );

  update characters set currency = v_new_from where id = v_from.id;
  if p_to_avulso then
    update public_currency set
      bronze = (v_new_to->>'bronze')::int, silver = (v_new_to->>'silver')::int,
      gold = (v_new_to->>'gold')::int, platinum = (v_new_to->>'platinum')::int,
      updated_at = now()
      where campaign_id = v_from.campaign_id;
  else
    update characters set currency = v_new_to where id = v_to_char.id;
  end if;
end;
$$;
grant execute on function transfer_currency(uuid, uuid, boolean, integer, integer, integer, integer) to authenticated;
