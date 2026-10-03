-- Tabuleiro: novo tipo de luz "visao" (visão no escuro: revela a área sem cor).
-- Só amplia o CHECK de board_lights.kind criado no db/060.

do $$
declare cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
  where rel.relname = 'board_lights' and con.contype = 'c' and att.attname = 'kind';
  if cname is not null then
    execute format('alter table board_lights drop constraint %I', cname);
  end if;
end $$;

alter table board_lights add constraint board_lights_kind_check
  check (kind in ('tocha', 'lanterna', 'magia', 'vela', 'custom', 'visao'));
