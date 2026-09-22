-- Easter egg (extra): quarto minijogo escondido, 2048. E temas
-- desbloqueáveis: ao SEGURAR o recorde da campanha em cada jogo pelo
-- menos uma vez (mesmo que outra pessoa bata depois), o jogador
-- destrava pra sempre um tema com a cara daquele jogo (ver THEMES em
-- src/screens/character.js). O desbloqueio é por CONTA (profile_id),
-- não por campanha -- cada perfil só pertence a uma campanha mesmo
-- (ver submit_game_score), então na prática dá no mesmo, mas o dado
-- fica guardado do jeito certo.

-- game_high_scores.game tinha CHECK só com 'snake'/'tetris'/'flappy'
-- (db/042 + db/043, já com nome fixo game_high_scores_game_check).
alter table game_high_scores drop constraint game_high_scores_game_check;
alter table game_high_scores add constraint game_high_scores_game_check
  check (game in ('snake', 'tetris', 'flappy', '2048'));

create table game_theme_unlocks (
  profile_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  game text not null check (game in ('snake', 'tetris', 'flappy', '2048')),
  unlocked_at timestamptz not null default now(),
  primary key (profile_id, game)
);
alter table game_theme_unlocks enable row level security;
create policy "temas destravados: campanha vê" on game_theme_unlocks
  for select using (campaign_id = current_campaign_id());
create policy "temas destravados: superadmin mexe" on game_theme_unlocks
  for all using (is_superadmin()) with check (is_superadmin());
-- sem policy de insert pro jogador comum -- só a RPC abaixo (security
-- definer) grava, no mesmo instante em que vira recorde da campanha.

create or replace function submit_game_score(p_game text, p_score integer, p_player_name text)
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
  select campaign_id, username, discord_user_id into v_campaign_id, v_username, v_discord_id
    from profiles where id = auth.uid();
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
    -- esse envio colocou o jogador no topo da campanha -- destrava o
    -- tema daquele jogo pra sempre, mesmo que outra pessoa bata esse
    -- recorde daqui a 1 minuto (on conflict do nothing: só a PRIMEIRA
    -- vez conta, não desdestrava se perder o topo depois).
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
      v_label := case p_game when 'snake' then 'Cobrinha' when 'tetris' then 'Tetris' when 'flappy' then 'Flappy Bird' when '2048' then '2048' else p_game end;
      v_icon := case p_game when 'snake' then '🐍' when 'tetris' then '🧱' when 'flappy' then '🐤' when '2048' then '🔢' else '🎮' end;
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
grant execute on function submit_game_score(text, integer, text) to authenticated;
