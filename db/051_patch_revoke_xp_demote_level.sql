-- Mestre tirar XP ou diminuir nível de jogador/NPC (pedido do usuário:
-- "opção do mestre tirar xp, ou diminuir o nível dos players"). Duas
-- RPCs novas, mesmo padrão de segurança/validação do grant_xp
-- (db/016/046) que já existe -- não mexe nele, só acrescenta o inverso.

-- ---------- tirar uma quantidade de XP (desce de nível sozinho se precisar) ----------
-- Espelho EXATO da matemática de grant_xp: lá, subir de nível L->L+1
-- custa 10*L XP (o nível que tá saindo) e sobra é carregado pro
-- próximo. Aqui, descer de L->L-1 devolve 10*(L-1) XP (o nível que
-- entra) -- testado que ida+volta com o mesmo valor sempre retorna ao
-- estado exato de antes (ver CONTEXT.local.md).
create or replace function revoke_xp(p_character_ids uuid[], p_amount integer)
returns void language plpgsql security definer as $$
declare
  v_char_id uuid;
  v_char characters%rowtype;
  v_remaining integer;
  v_new_level integer;
  v_lost_levels integer;
begin
  if not is_master() and not is_superadmin() then
    raise exception 'só o mestre pode tirar XP';
  end if;
  if p_amount <= 0 then
    raise exception 'quantidade de XP precisa ser positiva';
  end if;

  foreach v_char_id in array p_character_ids loop
    select * into v_char from characters where id = v_char_id for update;
    if v_char.id is null then continue; end if;
    if not is_superadmin() and v_char.campaign_id <> current_campaign_id() then
      raise exception 'personagem % não é da sua campanha', v_char.name;
    end if;

    v_new_level := v_char.level;
    v_remaining := v_char.xp - p_amount;
    v_lost_levels := 0;
    while v_remaining < 0 and v_new_level > 1 loop
      v_new_level := v_new_level - 1;
      v_remaining := v_remaining + 10 * v_new_level;
      v_lost_levels := v_lost_levels + 1;
    end loop;
    if v_remaining < 0 then v_remaining := 0; end if; -- já no nível 1 -- não há mais de onde descontar

    update characters set
      xp = v_remaining,
      level = v_new_level,
      -- desfaz os pontos de status que aqueles níveis deram, mas nunca
      -- deixa negativo (se o jogador já gastou os pontos em status,
      -- não mexe no status em si -- só zera o que ainda tinha pra
      -- distribuir; mesma filosofia de "nunca reescreve à força" que
      -- confirm_status_allocation já usa pro HP/estamina).
      status_points_unspent = greatest(0, status_points_unspent - (case when v_char.is_npc then 0 else v_lost_levels * 3 end))
    where id = v_char_id;
  end loop;
end;
$$;
grant execute on function revoke_xp(uuid[], integer) to authenticated;

-- ---------- diminuir nível direto (sem calcular XP) ----------
-- Mais simples de usar quando o mestre só quer "volta N nível(is)" sem
-- se importar com o XP exato -- reseta o XP pro começo do nível novo
-- (em vez de carregar sobra, que não faz sentido pra uma ação de
-- correção pontual como essa).
create or replace function demote_level(p_character_ids uuid[], p_levels integer)
returns void language plpgsql security definer as $$
declare
  v_char_id uuid;
  v_char characters%rowtype;
  v_new_level integer;
begin
  if not is_master() and not is_superadmin() then
    raise exception 'só o mestre pode diminuir nível';
  end if;
  if p_levels <= 0 then
    raise exception 'quantidade de níveis precisa ser positiva';
  end if;

  foreach v_char_id in array p_character_ids loop
    select * into v_char from characters where id = v_char_id for update;
    if v_char.id is null then continue; end if;
    if not is_superadmin() and v_char.campaign_id <> current_campaign_id() then
      raise exception 'personagem % não é da sua campanha', v_char.name;
    end if;

    v_new_level := greatest(1, v_char.level - p_levels);
    update characters set
      level = v_new_level,
      xp = 0,
      status_points_unspent = greatest(0, status_points_unspent - (case when v_char.is_npc then 0 else (v_char.level - v_new_level) * 3 end))
    where id = v_char_id;
  end loop;
end;
$$;
grant execute on function demote_level(uuid[], integer) to authenticated;
