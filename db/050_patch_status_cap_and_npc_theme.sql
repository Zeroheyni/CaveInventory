-- 1) Teto de status ("soft cap"): a regra sempre foi "16 + nível" --
--    mas confirm_status_allocation (db/016) tratava a PRIMEIRA
--    confirmação como um caso especial com teto fixo em 16 (sem somar
--    o nível), então no nível 1 (todo mundo começa nele) o teto virava
--    16 em vez de 17. Unifica: teto é sempre 16 + nível, ponto (nível 1
--    -> 17, nível 2 -> 18, ...). O resto (encher vida/estamina cheias
--    só na 1ª confirmação) continua igual.
create or replace function confirm_status_allocation(
  p_character_id uuid,
  p_vitalidade integer, p_forca integer, p_agilidade integer,
  p_destreza integer, p_inteligencia integer, p_estamina integer, p_observacao integer
) returns void language plpgsql security definer as $$
declare
  v_char characters%rowtype;
  v_cap integer;
  v_spent integer;
  v_first_confirm boolean;
begin
  select * into v_char from characters where id = p_character_id for update;
  if v_char.id is null then raise exception 'personagem não encontrado'; end if;
  if v_char.owner_id <> auth.uid() and not is_master() and not is_superadmin() then
    raise exception 'sem permissão pra editar esse personagem';
  end if;
  if v_char.status_points_unspent <= 0 then
    raise exception 'nenhum ponto de status pra distribuir agora';
  end if;

  v_first_confirm := not v_char.status_confirmed;
  v_cap := 16 + v_char.level;

  if p_vitalidade < 10 or p_forca < 10 or p_agilidade < 10 or p_destreza < 10
     or p_inteligencia < 10 or p_estamina < 10 or p_observacao < 10 then
    raise exception 'nenhum status pode ficar abaixo de 10';
  end if;
  if p_vitalidade > v_cap or p_forca > v_cap or p_agilidade > v_cap or p_destreza > v_cap
     or p_inteligencia > v_cap or p_estamina > v_cap or p_observacao > v_cap then
    raise exception 'nenhum status pode passar de %', v_cap;
  end if;

  v_spent := (p_vitalidade - v_char.vitalidade) + (p_forca - v_char.forca) + (p_agilidade - v_char.agilidade)
           + (p_destreza - v_char.destreza) + (p_inteligencia - v_char.inteligencia)
           + (p_estamina - v_char.estamina) + (p_observacao - v_char.observacao);
  if v_spent < 0 then
    raise exception 'não dá pra reduzir status, só distribuir os pontos disponíveis';
  end if;
  if v_spent > v_char.status_points_unspent then
    raise exception 'você só tem % pontos disponíveis', v_char.status_points_unspent;
  end if;

  update characters set
    vitalidade = p_vitalidade, forca = p_forca, agilidade = p_agilidade,
    destreza = p_destreza, inteligencia = p_inteligencia, estamina = p_estamina, observacao = p_observacao,
    status_points_unspent = v_char.status_points_unspent - v_spent,
    status_confirmed = true,
    hp_current = case when v_first_confirm then p_vitalidade * 4 else least(v_char.hp_current, p_vitalidade * 4) end,
    estamina_current = case when v_first_confirm then p_estamina else least(v_char.estamina_current, p_estamina) end
  where id = p_character_id;
end;
$$;
grant execute on function confirm_status_allocation(uuid,integer,integer,integer,integer,integer,integer,integer) to authenticated;

-- 2) Tema por personagem (hoje só NPC usa, ver ficha.js/character.js):
--    o mestre pode dar uma cara própria pra um NPC específico,
--    independente do tema da própria conta -- só aplica enquanto a
--    ficha/inventário DAQUELE personagem está aberto.
alter table characters add column if not exists theme text;
