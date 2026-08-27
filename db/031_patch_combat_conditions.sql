-- Fase 8 — condições de combate (status effects) por participante, com
-- duração em rodadas. Só o mestre aplica/remove, em qualquer combatente --
-- por isso vai via RPC security definer, não update direto de coluna: a
-- policy "participantes: dono ajusta o próprio" (db/015_patch_combat.sql:
-- 74-76) libera a LINHA inteira de combat_participants pro dono do
-- personagem (RLS não filtra por coluna), então um update direto em
-- `conditions` abriria brecha pro jogador mexer nas próprias condições.

alter table combat_participants add column conditions jsonb not null default '[]'::jsonb;
-- array de { id, tipo, round_expira, aplicado_por } -- round_expira null = manual (só remove no clique do mestre)

create or replace function apply_combat_condition(p_participant_id uuid, p_condition_key text, p_duration_rounds integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_campaign_id uuid; v_round integer; v_display_name text; v_new_cond jsonb;
begin
  select campaign_id, display_name into v_campaign_id, v_display_name from combat_participants where id = p_participant_id;
  if v_campaign_id is null then raise exception 'participante não encontrado'; end if;
  if not (is_superadmin() or (is_master() and v_campaign_id = current_campaign_id())) then
    raise exception 'só o mestre aplica condições';
  end if;

  select round into v_round from campaign_combat where campaign_id = v_campaign_id;
  v_new_cond := jsonb_build_object(
    'id', gen_random_uuid(), 'tipo', p_condition_key,
    'round_expira', case when p_duration_rounds is null then null else coalesce(v_round,1) + p_duration_rounds end,
    'aplicado_por', auth.uid()
  );
  update combat_participants set conditions = conditions || v_new_cond where id = p_participant_id;
  insert into battle_log (campaign_id, type, participant_name, detail)
    values (v_campaign_id, 'condicao_aplicada', v_display_name, p_condition_key);
end;
$$;
grant execute on function apply_combat_condition(uuid, text, integer) to authenticated;

create or replace function remove_combat_condition(p_participant_id uuid, p_condition_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_campaign_id uuid; v_display_name text; v_tipo text;
begin
  select campaign_id, display_name into v_campaign_id, v_display_name from combat_participants where id = p_participant_id;
  if v_campaign_id is null then raise exception 'participante não encontrado'; end if;
  if not (is_superadmin() or (is_master() and v_campaign_id = current_campaign_id())) then
    raise exception 'só o mestre remove condições';
  end if;

  select cond->>'tipo' into v_tipo from combat_participants, jsonb_array_elements(conditions) as cond
    where id = p_participant_id and (cond->>'id')::uuid = p_condition_id;
  update combat_participants set conditions = coalesce(
    (select jsonb_agg(cond) from jsonb_array_elements(conditions) as cond where (cond->>'id')::uuid <> p_condition_id), '[]'::jsonb
  ) where id = p_participant_id;
  insert into battle_log (campaign_id, type, participant_name, detail)
    values (v_campaign_id, 'condicao_removida', v_display_name, coalesce(v_tipo, ''));
end;
$$;
grant execute on function remove_combat_condition(uuid, uuid) to authenticated;
