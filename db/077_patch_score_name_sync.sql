-- Nome nos recordes dos minijogos: quando a conta troca o nome de exibição (perfil ou menu dos jogos), os recordes antigos dela
-- passam a mostrar o nome novo -- antes o nome só era regravado na próxima vez que ela batia/igualava o recorde.
create or replace function trg_sync_score_names()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.display_name is distinct from old.display_name or new.username is distinct from old.username then
    update game_high_scores
       set player_name = coalesce(nullif(btrim(new.display_name), ''), new.username)
     where profile_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_score_names_trg on profiles;
create trigger profiles_sync_score_names_trg
  after update of display_name, username on profiles
  for each row execute function trg_sync_score_names();
