-- Fase 8 (extra) — cada rolagem de dado também é postada no canal de
-- combate do Discord (discord_config.combat_channel_id), dizendo quem
-- rolou (nome, sem @menção) e o resultado. Sempre dispara, sem toggle,
-- mesmo espírito do aviso de turno (db/033) -- só não notifica se a
-- campanha nunca configurou o canal de combate.

create or replace function trg_notify_discord_dice_roll()
returns trigger language plpgsql security definer as $$
declare
  secret text; v_channel_id text; v_modifier_txt text; v_formula text; v_content text;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'discord_sync_shared_secret';
  if secret is null then return new; end if;

  select combat_channel_id into v_channel_id from discord_config where campaign_id = new.campaign_id;
  if v_channel_id is null then return new; end if;

  v_modifier_txt := case
    when new.modifier > 0 then '+' || new.modifier::text
    when new.modifier < 0 then new.modifier::text
    else ''
  end;
  v_formula := new.qty::text || new.die || v_modifier_txt;
  v_content := '🎲 **' || new.roller_name || '** rolou ' || v_formula
    || ' → [' || array_to_string(new.results, ', ') || '] = **' || new.total || '**';

  perform net.http_post(
    url := 'https://oswkabxzlnytgspxizyn.functions.supabase.co/discord-notify-roll',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', secret),
    body := jsonb_build_object('channel_id', v_channel_id, 'content', v_content)
  );
  return new;
end;
$$;

create trigger discord_notify_dice_roll_trg
  after insert on dice_rolls
  for each row execute function trg_notify_discord_dice_roll();
