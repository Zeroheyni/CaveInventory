-- Rolagem oculta do mestre: o mestre rola e só ELE vê o resultado até clicar em "revelar".
-- dice_rolls.hidden = true  -> o RLS esconde a linha de todo mundo menos mestres da campanha (e do ADM, que tem policy própria).
-- Ocultas NÃO vão pro Discord nem pro log de batalha; quando o mestre revela, aí sim os avisos saem (trigger de UPDATE).

alter table dice_rolls add column if not exists hidden boolean not null default false;
alter table dice_rolls add column if not exists revealed_at timestamptz;

-- policies v2 -> v3 (os nomes das v2 têm um sufixo de hash; acha pelo prefixo)
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'dice_rolls'
      and (policyname like 'dados: campanha vê%' or policyname like 'dados: qualquer membro rola pra si%')
  loop
    execute format('drop policy %I on dice_rolls', r.policyname);
  end loop;
end $$;

create policy "dados: campanha vê (v3)" on dice_rolls
  for select using (is_member_of(campaign_id) and (not hidden or is_master_of(campaign_id)));

create policy "dados: membro rola pra si (v3)" on dice_rolls
  for insert with check (
    is_member_of(campaign_id) and roller_id = auth.uid() and (not hidden or is_master_of(campaign_id))
  );

create policy "dados: mestre revela (v3)" on dice_rolls
  for update using (is_master_of(campaign_id)) with check (is_master_of(campaign_id));

-- o único UPDATE permitido é revelar (hidden true -> false): nada de editar resultado nem esconder de novo
create or replace function trg_dice_rolls_guard_update()
returns trigger language plpgsql as $$
begin
  if new.campaign_id is distinct from old.campaign_id or new.roller_id is distinct from old.roller_id
     or new.roller_name is distinct from old.roller_name or new.die is distinct from old.die
     or new.qty is distinct from old.qty or new.modifier is distinct from old.modifier
     or new.results is distinct from old.results or new.total is distinct from old.total
     or new.label is distinct from old.label or new.created_at is distinct from old.created_at then
    raise exception 'rolagem não pode ser editada';
  end if;
  if not old.hidden and new.hidden then
    raise exception 'rolagem já revelada não volta a ficar oculta';
  end if;
  if old.hidden and not new.hidden then new.revealed_at := now(); end if;
  return new;
end;
$$;

drop trigger if exists dice_rolls_guard_update_trg on dice_rolls;
create trigger dice_rolls_guard_update_trg
  before update on dice_rolls
  for each row execute function trg_dice_rolls_guard_update();

-- avisos do Discord e do log de batalha: ocultas ficam de fora no INSERT e saem quando reveladas
drop trigger if exists discord_notify_dice_roll_trg on dice_rolls;
create trigger discord_notify_dice_roll_trg
  after insert on dice_rolls
  for each row when (not new.hidden) execute function trg_notify_discord_dice_roll();

drop trigger if exists discord_notify_dice_reveal_trg on dice_rolls;
create trigger discord_notify_dice_reveal_trg
  after update on dice_rolls
  for each row when (old.hidden and not new.hidden) execute function trg_notify_discord_dice_roll();

drop trigger if exists battle_log_dice_roll_trg on dice_rolls;
create trigger battle_log_dice_roll_trg
  after insert on dice_rolls
  for each row when (not new.hidden) execute function trg_battle_log_dice_roll();

drop trigger if exists battle_log_dice_reveal_trg on dice_rolls;
create trigger battle_log_dice_reveal_trg
  after update on dice_rolls
  for each row when (old.hidden and not new.hidden) execute function trg_battle_log_dice_roll();
