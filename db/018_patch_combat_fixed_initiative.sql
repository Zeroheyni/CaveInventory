-- Fase 4 (refinamento) -- iniciativa numerada + modo "iniciativa fixa":
-- em vez de girar a lista inteira a cada turno (position de todo mundo
-- muda), trava a ordem (position parado) e só o "ponteiro" de quem tem
-- a vez anda -- a borda verde caminha pela lista parada. Qualquer
-- membro da campanha (mestre ou jogador) pode travar/destravar; passar
-- o turno em si continua exclusivo do mestre (mesma policy de sempre).

alter table campaign_combat add column fixed_initiative boolean not null default false;
alter table campaign_combat add column current_turn_id uuid references combat_participants(id) on delete set null;

-- snapshot da foto do personagem no momento em que entra no combate,
-- mesmo padrão já usado pra display_name -- evita join com characters
-- só pra mostrar a fotinho na lista.
alter table combat_participants add column avatar_url text;

create or replace function toggle_fixed_initiative(p_campaign_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_state campaign_combat%rowtype;
  v_ids uuid[];
  v_current_id uuid;
  v_idx int;
  v_n int;
  v_rotated uuid[];
  i int;
begin
  if p_campaign_id <> current_campaign_id() and not is_superadmin() then
    raise exception 'sem acesso a essa campanha';
  end if;

  select * into v_state from campaign_combat where campaign_id = p_campaign_id for update;
  if v_state.campaign_id is null or not v_state.active then
    raise exception 'nenhum combate ativo';
  end if;

  select array_agg(id order by position) into v_ids from combat_participants where campaign_id = p_campaign_id;
  v_n := coalesce(array_length(v_ids, 1), 0);

  if v_state.fixed_initiative then
    -- destravar: rotaciona a posição real pra colocar quem está com a
    -- vez agora em primeiro -- volta pro modo "a lista anda" sem dar
    -- salto visual (quem tinha a vez continua com a vez).
    if v_n > 0 then
      v_current_id := coalesce(v_state.current_turn_id, v_ids[1]);
      v_idx := coalesce(array_position(v_ids, v_current_id), 1);
      v_rotated := v_ids[v_idx:v_n] || v_ids[1:v_idx-1];
      for i in 1..v_n loop
        update combat_participants set position = i - 1 where id = v_rotated[i];
      end loop;
    end if;
    update campaign_combat set fixed_initiative = false, current_turn_id = null, updated_at = now()
      where campaign_id = p_campaign_id;
  else
    -- travar: a ordem atual (por position) vira fixa; a vez continua
    -- com quem já estava em primeiro.
    update campaign_combat set fixed_initiative = true, current_turn_id = v_ids[1], updated_at = now()
      where campaign_id = p_campaign_id;
  end if;
end;
$$;

grant execute on function toggle_fixed_initiative(uuid) to authenticated;
