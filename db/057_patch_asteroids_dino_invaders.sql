-- Easter egg (extra): 7º, 8º e 9º minijogos escondidos -- Asteroids, Dino
-- e Space Invaders. Mesmo padrão do db/056 (Pong): os dois CHECK que
-- travam a lista de jogos válidos ganham as 3 chaves, e o aviso de
-- recorde no Discord ganha rótulo/ícone de cada um.

alter table game_high_scores drop constraint game_high_scores_game_check;
alter table game_high_scores add constraint game_high_scores_game_check
  check (game in ('snake', 'tetris', 'flappy', '2048', 'breakout', 'pong', 'asteroids', 'dino', 'invaders'));

-- game_theme_unlocks: o db/053 já deixou o CHECK com nome fixo, mas a
-- busca pelo nome real continua (idempotente, sem assumir nada).
do $$
declare cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
  where rel.relname = 'game_theme_unlocks' and con.contype = 'c' and att.attname = 'game';
  if cname is not null then
    execute format('alter table game_theme_unlocks drop constraint %I', cname);
  end if;
end $$;
alter table game_theme_unlocks add constraint game_theme_unlocks_game_check
  check (game in ('snake', 'tetris', 'flappy', '2048', 'breakout', 'pong', 'asteroids', 'dino', 'invaders'));

-- submit_game_score (db/056) -- só acrescenta os 3 jogos novos nos CASE de
-- rótulo/ícone do aviso de recorde no Discord; resto idêntico.
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
    if is_superadmin() or exists (select 1 from profiles where id = auth.uid() and campaign_id = p_campaign_id) then
      v_campaign_id := p_campaign_id;
    else
      raise exception 'sem permissão pra registrar recorde nessa campanha';
    end if;
  else
    select campaign_id into v_campaign_id from profiles where id = auth.uid();
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
      v_label := case p_game when 'snake' then 'Cobrinha' when 'tetris' then 'Tetris' when 'flappy' then 'Flappy Bird' when '2048' then '2048' when 'breakout' then 'Breakout' when 'pong' then 'Pong' when 'asteroids' then 'Asteroids' when 'dino' then 'Dino' when 'invaders' then 'Space Invaders' else p_game end;
      v_icon := case p_game when 'snake' then '🐍' when 'tetris' then '🧱' when 'flappy' then '🐤' when '2048' then '🔢' when 'breakout' then '💥' when 'pong' then '🏓' when 'asteroids' then '☄️' when 'dino' then '🦖' when 'invaders' then '👾' else '🎮' end;
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
