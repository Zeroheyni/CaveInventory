-- Fase 8 (extra) — rolagem de dado feita ENQUANTO o combate está ativo
-- também entra no log de batalha (mesmo mecanismo de eventos, tipo novo
-- 'rolagem'), pra contar a história completa da luta num lugar só.
-- Funciona tanto pra rolagem solta (aba Dados/bandeja do combate) quanto
-- pra teste de atributo (db/039) -- os dois passam pela mesma tabela
-- dice_rolls, então um trigger só cobre tudo.

do $$
declare cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
  where rel.relname = 'battle_log' and con.contype = 'c' and att.attname = 'type';
  if cname is not null then
    execute format('alter table battle_log drop constraint %I', cname);
  end if;
end $$;

alter table battle_log add constraint battle_log_type_check
  check (type in ('dano','cura','entrada','saida','condicao_aplicada','condicao_removida','rolagem'));

create or replace function trg_battle_log_dice_roll()
returns trigger language plpgsql security definer as $$
declare
  v_active boolean;
  v_modifier_txt text;
  v_formula text;
  v_detail text;
begin
  select active into v_active from campaign_combat where campaign_id = new.campaign_id;
  if not coalesce(v_active, false) then return new; end if;

  v_modifier_txt := case
    when new.modifier > 0 then '+' || new.modifier::text
    when new.modifier < 0 then new.modifier::text
    else ''
  end;
  v_formula := new.qty::text || new.die || v_modifier_txt;
  v_detail := case when new.label is not null then new.label || ' — ' else '' end || v_formula || ' = ' || new.total;

  insert into battle_log (campaign_id, type, participant_name, detail)
    values (new.campaign_id, 'rolagem', new.roller_name, v_detail);
  return new;
end;
$$;

create trigger battle_log_dice_roll_trg
  after insert on dice_rolls
  for each row execute function trg_battle_log_dice_roll();
