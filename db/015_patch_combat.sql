-- ============================================================
-- PATCH: Fase 4 -- rastreador de combate (HP + iniciativa)
--
-- Sem automação de ataque/dano ainda (isso depende da Fase 5, que vai
-- introduzir Força/Agilidade/etc. na ficha) -- aqui é só rastreamento:
-- o grupo resolve ataque/dano verbalmente ou com dados físicos, e o
-- mestre digita HP e iniciativa aqui pra todo mundo acompanhar.
--
-- Visibilidade fina (HP de outro jogador, iniciativa oculta de
-- inimigo) é filtrada no CLIENTE, não via RLS por linha -- mesmo
-- padrão já usado em compartimentos trancados (hasCompartmentAccess
-- em publicArea.js): tudo mundo da campanha lê a linha inteira, a UI
-- decide o que mostrar. Não é dado sensível de verdade (jogo de mesa,
-- o mestre sempre pode só falar em voz alta), e simplifica bastante.
-- ============================================================

-- 1 linha por campanha (mesmo padrão de public_currency) -- se tem
-- combate ativo agora e em que rodada está (dirige o "revela em N
-- rodadas" de participante oculto).
create table campaign_combat (
  campaign_id uuid primary key references campaigns(id) on delete cascade,
  active boolean not null default false,
  round integer not null default 1,
  updated_at timestamptz not null default now()
);

create table combat_participants (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  character_id uuid references characters(id) on delete set null, -- null = NPC/monstro avulso
  display_name text not null, -- snapshot do nome no momento em que entrou no combate
  team text not null default 'neutro' check (team in ('aliado','inimigo','neutro')),
  hp_current integer not null default 0,
  hp_max integer not null default 0,
  initiative integer, -- valor digitado/rolado pelo mestre (sem cálculo automático ainda)
  position double precision not null default 0, -- ordem de exibição -- arrastável, independente da iniciativa
  hidden boolean not null default false,
  reveal_at_round integer, -- null = "sempre oculto" (só revela manual); preenchido = revela quando campaign_combat.round >= isso
  manually_revealed boolean not null default false,
  created_at timestamptz not null default now()
);
create index combat_participants_campaign_idx on combat_participants(campaign_id);

-- permissões por jogador (mesmo padrão de profiles.is_transport_admin)
-- -- o mestre liga/desliga, valem sempre (não são por combate específico)
alter table profiles add column can_see_others_hp boolean not null default false;
alter table profiles add column can_see_hidden_initiative boolean not null default false;

alter table campaign_combat enable row level security;
alter table combat_participants enable row level security;

create policy "combate: campanha vê" on campaign_combat
  for select using (campaign_id = current_campaign_id());
create policy "combate: mestre edita" on campaign_combat
  for all using (campaign_id = current_campaign_id() and is_master())
  with check (campaign_id = current_campaign_id() and is_master());
create policy "combate: superadmin mexe" on campaign_combat
  for all using (is_superadmin()) with check (is_superadmin());

create policy "participantes: campanha vê" on combat_participants
  for select using (campaign_id = current_campaign_id());
create policy "participantes: mestre edita" on combat_participants
  for all using (campaign_id = current_campaign_id() and is_master())
  with check (campaign_id = current_campaign_id() and is_master());
create policy "participantes: superadmin mexe" on combat_participants
  for all using (is_superadmin()) with check (is_superadmin());

-- jogador pode ajustar o PRÓPRIO hp_current (ex: efeito que ele mesmo
-- aplica) -- só esse campo importa pra ele mexer sozinho, o resto
-- (iniciativa, hidden, etc.) continua exclusivo do mestre via policy
-- acima. RLS não restringe coluna, então isso libera a linha toda pro
-- dono -- aceitável aqui (mesma lógica de "não é dado sensível de
-- verdade" do topo do arquivo).
create policy "participantes: dono ajusta o próprio" on combat_participants
  for update using (character_id in (select id from characters where owner_id = auth.uid()))
  with check (character_id in (select id from characters where owner_id = auth.uid()));

-- Realtime -- mesma necessidade de public_items/characters: refletir
-- HP/iniciativa ao vivo pra todo mundo olhando a tela de combate.
alter publication supabase_realtime add table campaign_combat;
alter publication supabase_realtime add table combat_participants;

-- Sem isso, um DELETE filtrado por campaign_id (que não é chave
-- primária) não chega no cliente via Realtime -- o Postgres só inclui
-- as colunas da chave primária na linha "antiga" de um DELETE por
-- padrão, então o filtro campaign_id=eq.X nunca casa e o evento é
-- descartado antes de sair. REPLICA IDENTITY FULL manda a linha
-- inteira, resolvendo isso. (Encontrado testando de verdade: excluir
-- um participante funcionava no banco mas nunca sumia da tela até
-- outra mudança qualquer forçar um refetch completo.)
alter table combat_participants replica identity full;
