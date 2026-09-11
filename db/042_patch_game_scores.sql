-- Easter egg: minijogos escondidos (Cobrinha e Tetris), destravados
-- clicando 5x no pontinho decorativo do cabeçalho (ver src/screens/
-- character.js e masterCampaignHub.js). Guarda só o MELHOR score de
-- cada perfil por jogo -- não um log de tentativas -- porque a UI só
-- precisa do recorde atual pra montar o ranking da campanha.

create table game_high_scores (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  profile_id uuid not null references auth.users(id) on delete cascade,
  player_name text not null,
  game text not null check (game in ('snake', 'tetris')),
  best_score integer not null default 0,
  achieved_at timestamptz not null default now(),
  unique (campaign_id, profile_id, game)
);
create index game_high_scores_campaign_idx on game_high_scores(campaign_id, game, best_score desc);

alter table game_high_scores enable row level security;
create policy "recordes: campanha vê" on game_high_scores
  for select using (campaign_id = current_campaign_id());
create policy "recordes: superadmin mexe" on game_high_scores
  for all using (is_superadmin()) with check (is_superadmin());

-- Sem policy de insert/update direta pro jogador comum -- em vez
-- disso, essa RPC security definer centraliza "só atualiza se o novo
-- score for maior" e usa auth.uid() internamente (não confia num
-- profile_id vindo do client, evita alguém sobrescrever o recorde de
-- outra pessoa). Mesmo padrão já usado nas condições de combate
-- (db/031/037_patch_combat_conditions.sql).
create or replace function submit_game_score(p_game text, p_score integer, p_player_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_campaign_id uuid;
begin
  select campaign_id into v_campaign_id from profiles where id = auth.uid();
  if v_campaign_id is null then raise exception 'sem campanha'; end if;

  insert into game_high_scores (campaign_id, profile_id, player_name, game, best_score)
  values (v_campaign_id, auth.uid(), p_player_name, p_game, greatest(p_score, 0))
  on conflict (campaign_id, profile_id, game) do update
    set best_score = greatest(game_high_scores.best_score, excluded.best_score),
        player_name = excluded.player_name,
        achieved_at = case when excluded.best_score > game_high_scores.best_score then now() else game_high_scores.achieved_at end;
end;
$$;
grant execute on function submit_game_score(text, integer, text) to authenticated;
