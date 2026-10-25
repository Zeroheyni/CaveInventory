-- Magias personalizadas do Magic Learning: o mestre cria magias da campanha (com fórmulas calculadas pela ficha) e pode restringir
-- uma magia a uma FAMÍLIA mágica (Herança Arcana, "Autorização Especial"). A família de um personagem fica em
-- characters.system_data.msl.family (o mestre marca na ficha). Só mestres da campanha escrevem; membros leem as livres e, das de família,
-- só as da própria família.
create table if not exists msl_custom_spells (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  family text,
  data jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists msl_custom_spells_campaign_idx on msl_custom_spells(campaign_id);

alter table msl_custom_spells enable row level security;
drop policy if exists "magias custom: membros leem" on msl_custom_spells;
create policy "magias custom: membros leem" on msl_custom_spells
  for select using (
    is_member_of(campaign_id)
    and (
      family is null
      or is_master_of(campaign_id)
      or exists (
        select 1 from characters c
        where c.campaign_id = msl_custom_spells.campaign_id
          and c.owner_id = auth.uid()
          and lower(btrim(coalesce(c.system_data->'msl'->>'family', ''))) = lower(btrim(msl_custom_spells.family))
      )
    )
  );
drop policy if exists "magias custom: mestre escreve" on msl_custom_spells;
create policy "magias custom: mestre escreve" on msl_custom_spells
  for all using (is_master_of(campaign_id)) with check (is_master_of(campaign_id));
