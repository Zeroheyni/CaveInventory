-- Dar XP pra NPC do banco (ficha completa). grant_xp (db/016) já
-- funcionava pra qualquer personagem da campanha, NPC incluso -- só a
-- UI do mestre não oferecia. Único ajuste: NPC sobe de nível normal, mas
-- NÃO acumula os +3 pontos de status por nível. Esses pontos só
-- existem pra o JOGADOR distribuir (ficha.js só mostra o "ponto(s) pra
-- distribuir" pra quem não é mestre); o mestre edita o status de NPC
-- livremente, então o contador ia crescer sem ninguém ver nem gastar.
create or replace function grant_xp(p_character_ids uuid[], p_amount integer)
returns void language plpgsql security definer as $$
declare
  v_char_id uuid;
  v_char characters%rowtype;
  v_new_xp integer;
  v_new_level integer;
  v_gained_points integer;
begin
  if not is_master() and not is_superadmin() then
    raise exception 'só o mestre pode dar XP';
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

    v_new_xp := v_char.xp + p_amount;
    v_new_level := v_char.level;
    v_gained_points := 0;
    while v_new_xp >= 10 * v_new_level loop
      v_new_xp := v_new_xp - 10 * v_new_level;
      v_new_level := v_new_level + 1;
      if not v_char.is_npc then
        v_gained_points := v_gained_points + 3;
      end if;
    end loop;

    update characters set
      xp = v_new_xp,
      level = v_new_level,
      status_points_unspent = status_points_unspent + v_gained_points
    where id = v_char_id;
  end loop;
end;
$$;
grant execute on function grant_xp(uuid[], integer) to authenticated;
