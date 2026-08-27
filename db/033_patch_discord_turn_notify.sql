-- Fase 8 — aviso de turno via Discord. Dispara SEMPRE que o turno passa de
-- verdade no combate (sem toggle, sem botão manual -- decisão de produto).
-- Requer que a Edge Function discord-notify-turn já esteja deployada antes
-- de aplicar esta migration (senão o pg_net.http_post bate 404 até o
-- deploy -- não quebra a escrita, só não notifica, mesmo comportamento já
-- tolerado pelas triggers de sync existentes quando o secret não existe).

-- ID da conta Discord do jogador, cadastrado pelo mestre no painel admin
-- (não é self-service do jogador). Nenhuma RLS nova necessária: profiles já
-- tem policy de update por is_master()+campaign_id (schema.sql:177-178) E
-- por is_superadmin() (007_patch_public_area_master_access.sql:68).
alter table profiles add column discord_user_id text;

-- Canal DEDICADO de combate, separado do canal de sync de inventário
-- (discord_config.channel_id) -- pedido explícito do usuário.
alter table discord_config add column combat_channel_id text;

create or replace function trg_notify_discord_turn()
returns trigger language plpgsql security definer as $$
declare
  secret text; v_participant_id uuid; v_character_id uuid;
  v_discord_user_id text; v_display_name text; v_channel_id text;
begin
  -- só dispara quando o turno realmente avançou (turns_passed_this_round ou
  -- round mudou) -- outros updates em campaign_combat (ex: toggle_fixed_initiative
  -- travando/destravando a ordem) não devem notificar.
  if new.turns_passed_this_round is not distinct from old.turns_passed_this_round
     and new.round is not distinct from old.round then
    return new;
  end if;

  select decrypted_secret into secret from vault.decrypted_secrets where name = 'discord_sync_shared_secret';
  if secret is null then return new; end if;

  if new.fixed_initiative then
    v_participant_id := new.current_turn_id;
  else
    select id into v_participant_id from combat_participants
      where campaign_id = new.campaign_id order by position asc limit 1;
  end if;
  if v_participant_id is null then return new; end if;

  select character_id, display_name into v_character_id, v_display_name
    from combat_participants where id = v_participant_id;
  if v_character_id is null then return new; end if; -- NPC avulso, sem jogador

  select p.discord_user_id into v_discord_user_id
    from characters c join profiles p on p.id = c.owner_id where c.id = v_character_id;
  if v_discord_user_id is null then return new; end if; -- jogador sem Discord vinculado

  select combat_channel_id into v_channel_id from discord_config where campaign_id = new.campaign_id;
  if v_channel_id is null then return new; end if; -- campanha sem canal de combate configurado

  perform net.http_post(
    url := 'https://oswkabxzlnytgspxizyn.functions.supabase.co/discord-notify-turn',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', secret),
    body := jsonb_build_object('channel_id', v_channel_id, 'discord_user_id', v_discord_user_id, 'display_name', v_display_name)
  );
  return new;
end;
$$;

create trigger discord_notify_turn_trg
  after update on campaign_combat
  for each row execute function trg_notify_discord_turn();
