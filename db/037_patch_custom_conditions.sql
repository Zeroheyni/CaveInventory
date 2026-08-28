-- Fase 8 (extra) — condições customizadas por campanha: o mestre cria as
-- próprias (nome, ícone, cor, e opcionalmente qual barra tingir -- ver
-- db/038 pro efeito visual). Convivem com o catálogo fixo
-- (CONDITION_TYPES, src/combat.js): combat_participants.conditions[].tipo
-- guarda ou a chave curta do catálogo fixo (ex: 'envenenado') ou o uuid
-- de uma condição customizada -- os dois cabem no mesmo campo texto sem
-- colidir (uuid nunca bate com uma palavra curta).

create table custom_conditions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  label text not null,
  icon text not null default '☠',
  bar text check (bar in ('hp','estamina')), -- null = só um badge, não tinge barra nenhuma
  color text not null default '#ff5a5a',
  created_at timestamptz not null default now()
);
create index custom_conditions_campaign_idx on custom_conditions(campaign_id);

alter table custom_conditions enable row level security;

create policy "condições customizadas: campanha vê" on custom_conditions
  for select using (campaign_id = current_campaign_id());
create policy "condições customizadas: mestre edita" on custom_conditions
  for all using (campaign_id = current_campaign_id() and is_master())
  with check (campaign_id = current_campaign_id() and is_master());
create policy "condições customizadas: superadmin mexe" on custom_conditions
  for all using (is_superadmin()) with check (is_superadmin());

-- apply/remove_combat_condition (db/031) gravavam a CHAVE crua no log
-- (ex: 'envenenado' -- já legível -- mas um uuid de condição
-- customizada ficaria ilegível no log de batalha). Passam a resolver o
-- nome amigável quando dá (custom_conditions.label), com fallback pra
-- chave crua (cobre o catálogo fixo, que já é texto legível).
create or replace function apply_combat_condition(p_participant_id uuid, p_condition_key text, p_duration_rounds integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_campaign_id uuid; v_round integer; v_display_name text; v_new_cond jsonb; v_label text;
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

  select label into v_label from custom_conditions where id::text = p_condition_key;
  insert into battle_log (campaign_id, type, participant_name, detail)
    values (v_campaign_id, 'condicao_aplicada', v_display_name, coalesce(v_label, p_condition_key));
end;
$$;
grant execute on function apply_combat_condition(uuid, text, integer) to authenticated;

create or replace function remove_combat_condition(p_participant_id uuid, p_condition_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_campaign_id uuid; v_display_name text; v_tipo text; v_label text;
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

  select label into v_label from custom_conditions where id::text = v_tipo;
  insert into battle_log (campaign_id, type, participant_name, detail)
    values (v_campaign_id, 'condicao_removida', v_display_name, coalesce(v_label, v_tipo, ''));
end;
$$;
grant execute on function remove_combat_condition(uuid, uuid) to authenticated;
