-- O jogador só cria/edita magia pessoal se o mestre liberou na ficha dele (characters.system_data.msl.canCreateSpells = true). Padrão: bloqueado.
-- Apagar a própria magia continua permitido.
drop policy if exists "magias custom: jogador cria a sua" on msl_custom_spells;
create policy "magias custom: jogador cria a sua" on msl_custom_spells
  for insert with check (
    created_by = auth.uid() and is_member_of(campaign_id) and family is null and private_to is not null
    and exists (
      select 1 from characters c
      where c.id = private_to and c.owner_id = auth.uid() and c.campaign_id = msl_custom_spells.campaign_id
        and coalesce(c.system_data->'msl'->>'canCreateSpells', 'false') = 'true'
    )
  );
drop policy if exists "magias custom: jogador edita a sua" on msl_custom_spells;
create policy "magias custom: jogador edita a sua" on msl_custom_spells
  for update using (
    created_by = auth.uid() and private_to is not null
    and exists (select 1 from characters c where c.id = private_to and c.owner_id = auth.uid() and coalesce(c.system_data->'msl'->>'canCreateSpells', 'false') = 'true')
  )
  with check (created_by = auth.uid() and family is null and private_to is not null);
