-- Jogadores também criam magias personalizadas, mas só PARA O PRÓPRIO personagem (private_to = id do personagem; só o criador e os mestres veem).
-- O mestre continua criando magias da campanha (private_to nulo) e as de família.
alter table msl_custom_spells add column if not exists private_to uuid references characters(id) on delete cascade;

drop policy if exists "magias custom: membros leem" on msl_custom_spells;
create policy "magias custom: membros leem" on msl_custom_spells
  for select using (
    is_member_of(campaign_id)
    and (
      is_master_of(campaign_id)
      or (
        private_to is null
        and (
          family is null
          or exists (
            select 1 from characters c
            where c.campaign_id = msl_custom_spells.campaign_id
              and c.owner_id = auth.uid()
              and lower(btrim(coalesce(c.system_data->'msl'->>'family', ''))) = lower(btrim(msl_custom_spells.family))
          )
        )
      )
      or (private_to is not null and created_by = auth.uid())
    )
  );

drop policy if exists "magias custom: jogador cria a sua" on msl_custom_spells;
create policy "magias custom: jogador cria a sua" on msl_custom_spells
  for insert with check (
    created_by = auth.uid() and is_member_of(campaign_id) and family is null and private_to is not null
    and exists (select 1 from characters c where c.id = private_to and c.owner_id = auth.uid() and c.campaign_id = msl_custom_spells.campaign_id)
  );
drop policy if exists "magias custom: jogador edita a sua" on msl_custom_spells;
create policy "magias custom: jogador edita a sua" on msl_custom_spells
  for update using (created_by = auth.uid() and private_to is not null)
  with check (created_by = auth.uid() and family is null and private_to is not null);
drop policy if exists "magias custom: jogador apaga a sua" on msl_custom_spells;
create policy "magias custom: jogador apaga a sua" on msl_custom_spells
  for delete using (created_by = auth.uid() and private_to is not null);
