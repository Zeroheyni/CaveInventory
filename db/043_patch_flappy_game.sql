-- Easter egg (extra) — terceiro minijogo escondido, Flappy Bird.
-- game_high_scores.game tinha um CHECK só com 'snake'/'tetris'
-- (db/042); troca pelo mesmo CHECK com 'flappy' também. Busca o nome
-- real da constraint em vez de assumir (mesmo cuidado de
-- db/040_patch_battle_log_dice_rolls.sql) -- nomes de CHECK inline
-- são auto-gerados pelo Postgres, então não dá pra confiar 100% no
-- padrão "<tabela>_<coluna>_check" sem conferir.
do $$
declare cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
  where rel.relname = 'game_high_scores' and con.contype = 'c' and att.attname = 'game';
  if cname is not null then
    execute format('alter table game_high_scores drop constraint %I', cname);
  end if;
end $$;

alter table game_high_scores add constraint game_high_scores_game_check
  check (game in ('snake', 'tetris', 'flappy'));
