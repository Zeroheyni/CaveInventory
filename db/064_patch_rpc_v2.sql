-- ============================================================================
-- FASE 2 (parte 2) -- RPCs por campanha (mesmas assinaturas; só o escopo muda)
--
-- Gerado por script a partir da ÚLTIMA definição de cada função no repositório, trocando só as
-- checagens "campanha atual / mestre global" por:
--     is_master_of(campanha da linha)   -- mestre DA campanha (ou ADM)
--     is_member_of(campanha)            -- membro da campanha (ou ADM)
--     is_any_master()                   -- portão "é mestre de algum lugar?", sempre seguido de escopo por linha
-- Efeito: um mestre só mexe nos personagens/mesas DELE; confirm_status_allocation deixa de aceitar
-- qualquer mestre do mundo. Para os dados e contas de hoje o comportamento é o mesmo.
-- ============================================================================

-- grant_xp: portão por mestre de QUALQUER mesa + escopo pela campanha de cada personagem
create or replace function grant_xp(p_character_ids uuid[], p_amount integer)
returns void language plpgsql security definer as $$
declare
  v_char_id uuid;
  v_char characters%rowtype;
  v_new_xp integer;
  v_new_level integer;
  v_gained_points integer;
begin
  if not is_any_master() then
    raise exception 'só o mestre pode dar XP';
  end if;
  if p_amount <= 0 then
    raise exception 'quantidade de XP precisa ser positiva';
  end if;

  foreach v_char_id in array p_character_ids loop
    select * into v_char from characters where id = v_char_id for update;
    if v_char.id is null then continue; end if;
    if not is_master_of(v_char.campaign_id) then
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

-- revoke_xp: portão por mestre de QUALQUER mesa + escopo pela campanha de cada personagem
create or replace function revoke_xp(p_character_ids uuid[], p_amount integer)
returns void language plpgsql security definer as $$
declare
  v_char_id uuid;
  v_char characters%rowtype;
  v_remaining integer;
  v_new_level integer;
  v_lost_levels integer;
begin
  if not is_any_master() then
    raise exception 'só o mestre pode tirar XP';
  end if;
  if p_amount <= 0 then
    raise exception 'quantidade de XP precisa ser positiva';
  end if;

  foreach v_char_id in array p_character_ids loop
    select * into v_char from characters where id = v_char_id for update;
    if v_char.id is null then continue; end if;
    if not is_master_of(v_char.campaign_id) then
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

-- demote_level: portão por mestre de QUALQUER mesa + escopo pela campanha de cada personagem
create or replace function demote_level(p_character_ids uuid[], p_levels integer)
returns void language plpgsql security definer as $$
declare
  v_char_id uuid;
  v_char characters%rowtype;
  v_new_level integer;
begin
  if not is_any_master() then
    raise exception 'só o mestre pode diminuir nível';
  end if;
  if p_levels <= 0 then
    raise exception 'quantidade de níveis precisa ser positiva';
  end if;

  foreach v_char_id in array p_character_ids loop
    select * into v_char from characters where id = v_char_id for update;
    if v_char.id is null then continue; end if;
    if not is_master_of(v_char.campaign_id) then
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

-- confirm_status_allocation: dono ou mestre da campanha do personagem
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
  if v_char.owner_id <> auth.uid() and not is_master_of(v_char.campaign_id) then
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

-- toggle_fixed_initiative: membro da campanha (mesma regra de antes, agora por membro)
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
  if not is_member_of(p_campaign_id) then
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

-- get_notebook_shared_pages: mestre DA campanha (ou ADM)
create or replace function get_notebook_shared_pages(p_character_id uuid)
returns jsonb
language plpgsql security definer stable as $$
declare
  v_char characters%rowtype;
  v_all jsonb;
  v_result jsonb;
begin
  select * into v_char from characters where id = p_character_id;
  if v_char.id is null then
    raise exception 'personagem não encontrado';
  end if;

  if not is_master_of(v_char.campaign_id) then
    raise exception 'sem permissão pra ver esse caderno';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'notebookId', nb ->> 'id',
      'notebookName', coalesce(nb ->> 'name', 'Caderno'),
      'themeId', coalesce(nb ->> 'themeId', 'papel'),
      'pages', (
        select coalesce(jsonb_agg(page), '[]'::jsonb)
        from jsonb_array_elements(coalesce(nb -> 'pages', '[]'::jsonb)) as page
        where (page ->> 'visibleToMaster')::boolean is true
      )
    )
  ), '[]'::jsonb) into v_all
  from jsonb_array_elements(coalesce(v_char.notebook_data -> 'notebooks', '[]'::jsonb)) as nb;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_result
  from jsonb_array_elements(v_all) as x
  where jsonb_array_length(x -> 'pages') > 0;

  return v_result;
end;
$$;


-- apply_combat_condition: mestre DA campanha (ou ADM)
create or replace function apply_combat_condition(p_participant_id uuid, p_condition_key text, p_duration_rounds integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_campaign_id uuid; v_round integer; v_display_name text; v_new_cond jsonb; v_label text;
begin
  select campaign_id, display_name into v_campaign_id, v_display_name from combat_participants where id = p_participant_id;
  if v_campaign_id is null then raise exception 'participante não encontrado'; end if;
  if not is_master_of(v_campaign_id) then
    raise exception 'só o mestre aplica condições';
  end if;

  select round into v_round from campaign_combat where campaign_id = v_campaign_id;
  v_new_cond := jsonb_build_object(
    'id', gen_random_uuid(), 'tipo', p_condition_key,
    'round_expira', case when p_duration_rounds is null then null else coalesce(v_round,1) + p_duration_rounds end,
    'aplicado_por', auth.uid()
  );
  update combat_participants set conditions = conditions || v_new_cond where id = p_participant_id;

  select label into v_label from custom_conditions where id::text = p_condition_key;
  insert into battle_log (campaign_id, type, participant_name, detail)
    values (v_campaign_id, 'condicao_aplicada', v_display_name, coalesce(v_label, p_condition_key));
end;
$$;
grant execute on function apply_combat_condition(uuid, text, integer) to authenticated;

-- remove_combat_condition: mestre DA campanha (ou ADM)
create or replace function remove_combat_condition(p_participant_id uuid, p_condition_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_campaign_id uuid; v_display_name text; v_tipo text; v_label text;
begin
  select campaign_id, display_name into v_campaign_id, v_display_name from combat_participants where id = p_participant_id;
  if v_campaign_id is null then raise exception 'participante não encontrado'; end if;
  if not is_master_of(v_campaign_id) then
    raise exception 'só o mestre remove condições';
  end if;

  select cond->>'tipo' into v_tipo from combat_participants, jsonb_array_elements(conditions) as cond
    where id = p_participant_id and (cond->>'id')::uuid = p_condition_id;
  update combat_participants set conditions = coalesce(
    (select jsonb_agg(cond) from jsonb_array_elements(conditions) as cond where (cond->>'id')::uuid <> p_condition_id), '[]'::jsonb
  ) where id = p_participant_id;

  select label into v_label from custom_conditions where id::text = v_tipo;
  insert into battle_log (campaign_id, type, participant_name, detail)
    values (v_campaign_id, 'condicao_removida', v_display_name, coalesce(v_label, v_tipo, ''));
end;
$$;
grant execute on function remove_combat_condition(uuid, uuid) to authenticated;

-- restore_character_backup: mestre DA campanha (ou ADM)
create or replace function restore_character_backup(p_backup_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  b character_backups%rowtype;
  c characters%rowtype;
begin
  select * into b from character_backups where id = p_backup_id;
  if b.id is null then raise exception 'backup não encontrado'; end if;
  if not is_master_of(b.campaign_id) then
    raise exception 'só o mestre restaura backup de inventário';
  end if;
  if b.character_id is null then raise exception 'esse personagem foi excluído -- o backup está guardado, mas precisa ser recriado à mão'; end if;
  select * into c from characters where id = b.character_id for update;
  if c.id is null then raise exception 'personagem não existe mais'; end if;

  insert into character_backups (character_id, campaign_id, reason, data, currency, items_count, containers_count, inventory_updated_at, changed_by, character_name)
  values (c.id, c.campaign_id, 'antes_de_restaurar', coalesce(c.data, '{}'::jsonb), c.currency,
          inv_items_count(c.data), inv_containers_count(c.data), c.inventory_updated_at, auth.uid(), c.name);

  perform set_config('app.skip_backup', '1', true);
  update characters
    set data = b.data,
        currency = coalesce(b.currency, c.currency),
        inventory_updated_at = now(),
        updated_at = now()
    where id = c.id;
  perform set_config('app.skip_backup', '0', true);
end;
$$;
grant execute on function restore_character_backup(uuid) to authenticated;

-- create_character_backup: mestre DA campanha (ou ADM)
create or replace function create_character_backup(p_character_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c characters%rowtype;
begin
  select * into c from characters where id = p_character_id;
  if c.id is null then raise exception 'personagem não encontrado'; end if;
  if not is_master_of(c.campaign_id) then
    raise exception 'só o mestre cria backup de inventário';
  end if;
  insert into character_backups (character_id, campaign_id, reason, data, currency, items_count, containers_count, inventory_updated_at, changed_by, character_name)
  values (c.id, c.campaign_id, 'manual', coalesce(c.data, '{}'::jsonb), c.currency,
          inv_items_count(c.data), inv_containers_count(c.data), c.inventory_updated_at, auth.uid(), c.name);
end;
$$;
grant execute on function create_character_backup(uuid) to authenticated;

-- import_character_inventory: mestre DA campanha (ou ADM)
create or replace function import_character_inventory(p_character_id uuid, p_data jsonb, p_currency jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare c characters%rowtype;
begin
  select * into c from characters where id = p_character_id for update;
  if c.id is null then raise exception 'personagem não encontrado'; end if;
  if not is_master_of(c.campaign_id) then
    raise exception 'só o mestre importa inventário';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object'
     or jsonb_typeof(p_data -> 'items') is distinct from 'array'
     or jsonb_typeof(p_data -> 'containers') is distinct from 'array' then
    raise exception 'dados do arquivo inválidos (esperado um inventário com items e containers)';
  end if;

  insert into character_backups (character_id, campaign_id, reason, data, currency, items_count, containers_count, inventory_updated_at, changed_by, character_name)
  values (c.id, c.campaign_id, 'antes_de_restaurar', coalesce(c.data, '{}'::jsonb), c.currency,
          inv_items_count(c.data), inv_containers_count(c.data), c.inventory_updated_at, auth.uid(), c.name);

  perform set_config('app.skip_backup', '1', true);
  update characters
    set data = p_data - 'wipeConfirmed',
        currency = coalesce(p_currency, c.currency),
        inventory_updated_at = now(),
        updated_at = now()
    where id = c.id;
  perform set_config('app.skip_backup', '0', true);
end;
$$;
grant execute on function import_character_inventory(uuid, jsonb, jsonb) to authenticated;

-- list_campaign_players: membro da campanha
create or replace function list_campaign_players(p_campaign_id uuid)
returns table(character_id uuid, character_name text, username text)
language sql security definer stable as $$
  select c.id, c.name, p.username
  from characters c
  join profiles p on p.id = c.owner_id
  where c.campaign_id = p_campaign_id
    and not c.is_npc
    and is_member_of(p_campaign_id)
  order by p.username;
$$;


-- update_my_light: membro da campanha da luz
create or replace function update_my_light(p_light_id uuid, p_enabled boolean default null, p_direction real default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update board_lights l
     set enabled = coalesce(p_enabled, l.enabled),
         direction = coalesce(p_direction, l.direction)
   where l.id = p_light_id
     and is_member_of(l.campaign_id)
     and exists (
       select 1 from board_tokens t
       join characters c on c.id = t.character_id
       where t.id = l.token_id and c.owner_id = auth.uid()
     );
  if not found then
    raise exception 'sem permissão pra mexer nessa luz';
  end if;
end;
$$;
grant execute on function update_my_light(uuid, boolean, real) to authenticated;

-- submit_game_score: membro da campanha informada (ou a primeira, se vier sem campanha)
create or replace function submit_game_score(p_game text, p_score integer, p_player_name text, p_campaign_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_campaign_id uuid;
  v_score integer := greatest(p_score, 0);
  v_prev_top integer;
  v_username text;
  v_discord_id text;
  v_who text;
  v_channel_id text;
  v_secret text;
  v_label text;
  v_icon text;
begin
  select username, discord_user_id into v_username, v_discord_id from profiles where id = auth.uid();

  if p_campaign_id is not null then
    if is_member_of(p_campaign_id) then
      v_campaign_id := p_campaign_id;
    else
      raise exception 'sem permissão pra registrar recorde nessa campanha';
    end if;
  else
    select coalesce((select campaign_id from profiles where id = auth.uid()), (select campaign_id from campaign_members where user_id = auth.uid() order by created_at limit 1)) into v_campaign_id;
  end if;
  if v_campaign_id is null then raise exception 'sem campanha'; end if;

  select coalesce(max(best_score), 0) into v_prev_top
    from game_high_scores where campaign_id = v_campaign_id and game = p_game;

  insert into game_high_scores (campaign_id, profile_id, player_name, game, best_score)
  values (v_campaign_id, auth.uid(), p_player_name, p_game, v_score)
  on conflict (campaign_id, profile_id, game) do update
    set best_score = greatest(game_high_scores.best_score, excluded.best_score),
        player_name = excluded.player_name,
        achieved_at = case when excluded.best_score > game_high_scores.best_score then now() else game_high_scores.achieved_at end;

  if v_score > 0 and v_score > v_prev_top then
    insert into game_theme_unlocks (profile_id, campaign_id, game)
    values (auth.uid(), v_campaign_id, p_game)
    on conflict (profile_id, game) do nothing;

    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'discord_sync_shared_secret';
    select combat_channel_id into v_channel_id from discord_config where campaign_id = v_campaign_id;
    if v_secret is not null and v_channel_id is not null then
      v_who := case
        when v_discord_id ~ '^[0-9]+$' then '<@' || v_discord_id || '>'
        else '**' || regexp_replace(coalesce(v_username, 'alguém'), '[@<>*_~`|\\]', '', 'g') || '**'
      end;
      v_label := case p_game when 'snake' then 'Cobrinha' when 'tetris' then 'Tetris' when 'flappy' then 'Flappy Bird' when '2048' then '2048' when 'breakout' then 'Breakout' when 'pong' then 'Pong' when 'asteroids' then 'Asteroids' when 'dino' then 'Dino' when 'invaders' then 'Space Invaders' when 'minas' then 'Campo Minado' when 'frogger' then 'Frogger' when 'farkle' then 'Farkle' when 'blackjack' then 'Blackjack' when 'pacman' then 'Pac-Man' else p_game end;
      v_icon := case p_game when 'snake' then '🐍' when 'tetris' then '🧱' when 'flappy' then '🐤' when '2048' then '🔢' when 'breakout' then '💥' when 'pong' then '🏓' when 'asteroids' then '☄️' when 'dino' then '🦖' when 'invaders' then '👾' when 'minas' then '💣' when 'frogger' then '🐸' when 'farkle' then '🎲' when 'blackjack' then '🃏' when 'pacman' then '🟡' else '🎮' end;
      perform net.http_post(
        url := 'https://oswkabxzlnytgspxizyn.functions.supabase.co/discord-notify-roll',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
        body := jsonb_build_object(
          'channel_id', v_channel_id,
          'content', '🏆 ' || v_who || ' bateu o recorde de ' || v_icon || ' **' || v_label || '** com **' || v_score || '** pontos!'
            || case when v_prev_top > 0 then ' (recorde anterior: ' || v_prev_top || ')' else '' end
        )
      );
    end if;
  end if;
end;
$$;
grant execute on function submit_game_score(text, integer, text, uuid) to authenticated;

-- append_personal_inventory_entry: recebe o personagem (vários por conta). Sem o parâmetro, mantém o
-- comportamento antigo (o personagem do usuário na campanha dele) pra o cliente atual continuar igual.
drop function if exists append_personal_inventory_entry(text, jsonb);
create or replace function append_personal_inventory_entry(p_kind text, p_entry jsonb, p_character_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  c characters%rowtype;
  v_key text;
  d jsonb;
begin
  if p_kind not in ('item', 'container') then raise exception 'tipo inválido'; end if;
  if jsonb_typeof(p_entry) is distinct from 'object' or (p_entry ->> 'id') is null then
    raise exception 'entrada inválida';
  end if;
  if p_character_id is not null then
    select * into c from characters where id = p_character_id and owner_id = auth.uid() for update;
  else
    select * into c from characters
      where owner_id = auth.uid() and campaign_id = current_campaign_id()
      order by id
      limit 1 for update;
  end if;
  if c.id is null then raise exception 'você não tem personagem nessa campanha'; end if;

  v_key := case when p_kind = 'item' then 'items' else 'containers' end;
  d := case when jsonb_typeof(c.data) = 'object' then c.data else '{}'::jsonb end;
  d := jsonb_set(d, array[v_key],
        (case when jsonb_typeof(d -> v_key) = 'array' then d -> v_key else '[]'::jsonb end) || jsonb_build_array(p_entry));
  d := jsonb_set(d, '{transportPersonal}',
        (case when jsonb_typeof(d -> 'transportPersonal') = 'array' then d -> 'transportPersonal' else '[]'::jsonb end)
        || jsonb_build_array(jsonb_build_object('type', p_kind, 'id', p_entry ->> 'id')));

  update characters set data = d, inventory_updated_at = now(), updated_at = now() where id = c.id;
end;
$$;
grant execute on function append_personal_inventory_entry(text, jsonb, uuid) to authenticated;
