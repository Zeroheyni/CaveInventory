-- Fase 8 (extra) — d100 e dado customizado ("d" + valor digitado, ex:
-- d132). O check original de dice_rolls.die era uma lista fixa
-- (db/029_patch_dice_rolls.sql) -- vira validação de formato (letra "d"
-- + 1 a 4 dígitos) pra aceitar qualquer tamanho de dado, não só os
-- presets. Acha o nome real da constraint em vez de assumir
-- "dice_rolls_die_check" (nome padrão do Postgres, mas mais seguro
-- confirmar via catálogo).

do $$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
  where rel.relname = 'dice_rolls' and con.contype = 'c' and att.attname = 'die';
  if cname is not null then
    execute format('alter table dice_rolls drop constraint %I', cname);
  end if;
end $$;

alter table dice_rolls add constraint dice_rolls_die_check check (die ~ '^d[0-9]{1,4}$');
