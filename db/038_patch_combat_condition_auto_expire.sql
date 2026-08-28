-- Fase 8 (extra) — condição some sozinha quando a rodada passa de
-- round_expira, sem o mestre precisar clicar pra remover. Dispara na
-- MESMA escrita que avança a rodada (campaign_combat.round), então
-- chega pros clientes via Realtime já removida -- não existe estado
-- "expirando" visível de verdade, é tudo atômico numa transação só.
create or replace function trg_expire_combat_conditions()
returns trigger language plpgsql security definer as $$
declare
  participant record;
  cond_elem jsonb;
  remaining jsonb;
  v_label text;
begin
  if new.round is not distinct from old.round then return new; end if;

  for participant in
    select id, display_name, conditions from combat_participants
    where campaign_id = new.campaign_id and jsonb_array_length(conditions) > 0
  loop
    remaining := '[]'::jsonb;
    for cond_elem in select jsonb_array_elements(participant.conditions)
    loop
      if cond_elem->>'round_expira' is not null and (cond_elem->>'round_expira')::integer <= new.round then
        select label into v_label from custom_conditions where id::text = (cond_elem->>'tipo');
        insert into battle_log (campaign_id, type, participant_name, detail)
          values (new.campaign_id, 'condicao_removida', participant.display_name, coalesce(v_label, cond_elem->>'tipo', ''));
      else
        remaining := remaining || cond_elem;
      end if;
    end loop;
    if remaining <> participant.conditions then
      update combat_participants set conditions = remaining where id = participant.id;
    end if;
  end loop;

  return new;
end;
$$;

create trigger expire_combat_conditions_trg
  after update on campaign_combat
  for each row execute function trg_expire_combat_conditions();
