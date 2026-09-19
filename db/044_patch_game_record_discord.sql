-- Easter egg (extra) — quando alguém bate o RECORDE DA CAMPANHA num dos
-- minijogos escondidos (o placar mais alto daquele jogo naquela mesa),
-- o bot avisa no mesmo canal do Discord das rolagens de dado/turnos
-- (discord_config.combat_channel_id), com quem foi, qual jogo e quantos
-- pontos. Reaproveita a Edge Function genérica discord-notify-roll
-- (recebe {channel_id, content} já pronto, só posta) e o mesmo padrão
-- de segredo compartilhado dos triggers de dado/turno (db/033/035).
-- Recorde pessoal que NÃO passa o da campanha não avisa (senão viraria
-- spam a cada melhora de cada jogador).
--
-- O nome que vai pra mensagem vem de profiles.username (servidor), não
-- do p_player_name que o client manda, e é limpo de @ < > e markdown --
-- a function do bot não restringe allowed_mentions, então um nome com
-- "@everyone" pingaria o servidor inteiro.
create or replace function submit_game_score(p_game text, p_score integer, p_player_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_campaign_id uuid;
  v_score integer := greatest(p_score, 0);
  v_prev_top integer;
  v_username text;
  v_channel_id text;
  v_secret text;
  v_label text;
  v_icon text;
begin
  select campaign_id, username into v_campaign_id, v_username from profiles where id = auth.uid();
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
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'discord_sync_shared_secret';
    select combat_channel_id into v_channel_id from discord_config where campaign_id = v_campaign_id;
    if v_secret is not null and v_channel_id is not null then
      v_label := case p_game when 'snake' then 'Cobrinha' when 'tetris' then 'Tetris' when 'flappy' then 'Flappy Bird' else p_game end;
      v_icon := case p_game when 'snake' then '🐍' when 'tetris' then '🧱' when 'flappy' then '🐤' else '🎮' end;
      perform net.http_post(
        url := 'https://oswkabxzlnytgspxizyn.functions.supabase.co/discord-notify-roll',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
        body := jsonb_build_object(
          'channel_id', v_channel_id,
          'content', '🏆 **' || regexp_replace(coalesce(v_username, 'alguém'), '[@<>*_~`|\\]', '', 'g') || '** bateu o recorde de ' || v_icon || ' **' || v_label || '** com **' || v_score || '** pontos!'
            || case when v_prev_top > 0 then ' (recorde anterior: ' || v_prev_top || ')' else '' end
        )
      );
    end if;
  end if;
end;
$$;
grant execute on function submit_game_score(text, integer, text) to authenticated;
