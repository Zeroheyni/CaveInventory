-- Fase 8 (extra) — barra customizada por personagem, igual HP/Estamina
-- só que o mestre escolhe o nome, a cor, e o que ela representa: um
-- máximo fixo digitado por ele ("personalizável", ex: "Mana: 20") ou
-- calculado ao vivo a partir de um status do personagem ("fórmula",
-- ex: "Fúria: 2x Força", "Foco: Inteligência/2"). Duas tabelas:
-- custom_bars é a DEFINIÇÃO (só o mestre cria/edita/apaga -- nome,
-- cor, fórmula) e character_custom_bars é a ATRIBUIÇÃO a um
-- personagem específico + o valor atual (o dono do personagem também
-- pode ajustar esse valor, mesmo espírito de HP/Estamina hoje).
-- Separar em duas tabelas evita o mesmo problema já resolvido antes
-- pras condições de combate (db/031/037): se tudo ficasse numa linha
-- só, a policy "dono ajusta o valor atual" abriria brecha pro dono
-- também editar nome/cor/fórmula, que é definição, não valor.

create table custom_bars (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  name text not null,
  color text not null default '#5ad4ff',
  mode text not null check (mode in ('manual', 'formula')),
  manual_max integer,
  formula_stat text check (formula_stat in ('vitalidade','forca','agilidade','destreza','inteligencia','estamina','observacao')),
  formula_op text check (formula_op in ('mult', 'div')),
  formula_value numeric,
  created_at timestamptz not null default now(),
  check (
    (mode = 'manual' and manual_max is not null and formula_stat is null and formula_op is null and formula_value is null)
    or
    (mode = 'formula' and formula_stat is not null and formula_op is not null and formula_value is not null and manual_max is null)
  )
);
create index custom_bars_campaign_idx on custom_bars(campaign_id);

alter table custom_bars enable row level security;
create policy "barras customizadas: campanha vê" on custom_bars
  for select using (campaign_id = current_campaign_id());
create policy "barras customizadas: mestre edita" on custom_bars
  for all using (campaign_id = current_campaign_id() and is_master())
  with check (campaign_id = current_campaign_id() and is_master());
create policy "barras customizadas: superadmin mexe" on custom_bars
  for all using (is_superadmin()) with check (is_superadmin());

create table character_custom_bars (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  custom_bar_id uuid not null references custom_bars(id) on delete cascade,
  character_id uuid not null references characters(id) on delete cascade,
  current_value integer not null default 0,
  created_at timestamptz not null default now(),
  unique (custom_bar_id, character_id)
);
create index character_custom_bars_character_idx on character_custom_bars(character_id);
create index character_custom_bars_campaign_idx on character_custom_bars(campaign_id);

alter table character_custom_bars enable row level security;
create policy "barras do personagem: campanha vê" on character_custom_bars
  for select using (campaign_id = current_campaign_id());
create policy "barras do personagem: mestre atribui e edita" on character_custom_bars
  for all using (campaign_id = current_campaign_id() and is_master())
  with check (campaign_id = current_campaign_id() and is_master());
-- dono do personagem só ajusta o valor atual -- não existe policy de
-- insert/delete pro dono, então ele não cria/remove atribuição, só dá
-- update numa linha que o mestre já criou. Nada nessa tabela além de
-- current_value é "sensível" (nome/cor/fórmula moram em custom_bars),
-- então não precisa de RPC security definer aqui feito nas condições.
create policy "barras do personagem: dono ajusta o valor atual" on character_custom_bars
  for update using (campaign_id = current_campaign_id() and character_id in (select id from characters where owner_id = auth.uid()))
  with check (campaign_id = current_campaign_id() and character_id in (select id from characters where owner_id = auth.uid()));
create policy "barras do personagem: superadmin mexe" on character_custom_bars
  for all using (is_superadmin()) with check (is_superadmin());

alter publication supabase_realtime add table custom_bars;
alter table custom_bars replica identity full;
alter publication supabase_realtime add table character_custom_bars;
alter table character_custom_bars replica identity full;
