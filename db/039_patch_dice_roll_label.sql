-- Fase 8 (extra) — rótulo opcional numa rolagem (ex: "Força" pra um
-- teste de atributo direto da ficha, "d20 + valor do status, sem
-- digitar nada") -- null pra rolagem "solta" normal. O aviso de
-- rolagem no Discord (db/035_patch_discord_dice_notify.sql) passa a
-- mostrar esse rótulo quando presente.
alter table dice_rolls add column label text;

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
  v_content := '🎲 **' || new.roller_name || '** '
    || case when new.label is not null then 'testou **' || new.label || '** (' || v_formula || ')' else 'rolou ' || v_formula end
    || ' → [' || array_to_string(new.results, ', ') || '] = **' || new.total || '**';

  perform net.http_post(
    url := 'https://oswkabxzlnytgspxizyn.functions.supabase.co/discord-notify-roll',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', secret),
    body := jsonb_build_object('channel_id', v_channel_id, 'content', v_content)
  );
  return new;
end;
$$;
