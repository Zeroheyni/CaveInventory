-- Nome de exibição POR MESA: campaign_members.display_name (nulo = usa o nome da conta, profiles.display_name, ou o apelido de login).
-- Aparece nos recordes dos minijogos e como nome de quem rola dados/aponta no tabuleiro dessa mesa.

alter table campaign_members add column if not exists display_name text;

-- o próprio membro troca o nome dele NESTA mesa (security definer: a tabela só tem RPCs de mestre pra escrita)
create or replace function set_my_campaign_name(p_campaign_id uuid, p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_name text := nullif(btrim(left(coalesce(p_name, ''), 40)), '');
begin
  update campaign_members set display_name = v_name
   where campaign_id = p_campaign_id and user_id = auth.uid();
  if not found then raise exception 'você não é membro dessa campanha'; end if;

  -- recordes dessa mesa passam a mostrar o nome novo (sem nome por mesa, volta pro nome da conta)
  update game_high_scores
     set player_name = coalesce(v_name, (select coalesce(nullif(btrim(p.display_name), ''), p.username) from profiles p where p.id = auth.uid()))
   where campaign_id = p_campaign_id and profile_id = auth.uid();
  return v_name;
end;
$$;
grant execute on function set_my_campaign_name(uuid, text) to authenticated;

-- trocar o nome da CONTA só mexe nos recordes das mesas onde a pessoa não definiu um nome próprio
create or replace function trg_sync_score_names()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.display_name is distinct from old.display_name or new.username is distinct from old.username then
    update game_high_scores s
       set player_name = coalesce(nullif(btrim(new.display_name), ''), new.username)
     where s.profile_id = new.id
       and not exists (
         select 1 from campaign_members m
          where m.campaign_id = s.campaign_id and m.user_id = new.id and nullif(btrim(m.display_name), '') is not null
       );
  end if;
  return new;
end;
$$;
