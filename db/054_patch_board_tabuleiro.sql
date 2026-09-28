-- Tabuleiro (virtual tabletop). Fase 1: banco + CRUD básico --
-- criar/renomear/apagar tabuleiro, trocar qual está ativo na
-- campanha, subir imagem de fundo, colocar/mover token de
-- personagem. Sem tempo real chique ainda (isso é fase 3, via
-- Broadcast) -- por ora só postgres_changes normal, igual combate.
--
-- Schema já vem "adiantado" pra fase 2 (marcador solto, resize,
-- camadas, cor da borda) pra não precisar de uma segunda migração
-- só pra adicionar coluna -- a UI da fase 1 só não expõe esses
-- campos ainda.

create table boards (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  name text not null default 'Tabuleiro',
  background_image_url text,
  created_at timestamptz not null default now()
);

-- qual tabuleiro está "no ar" pra campanha (mestre escolhe). Sem
-- policy nova -- mesmo caso de max_carga_publico: é só mais uma
-- coluna em campaigns, a policy "campanha: só o mestre atualiza"
-- já existente cobre a linha inteira.
alter table campaigns add column active_board_id uuid references boards(id) on delete set null;

create table board_tokens (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade, -- denormalizado, mesmo padrão de combat_participants pra RLS simples
  character_id uuid references characters(id) on delete set null, -- null = marcador solto (NPC/monstro sem ficha, fase 2)
  -- label/image_url SEMPRE gravados (até pra token de personagem) --
  -- não dá pra confiar em join com characters.name/avatar_url na hora
  -- de mostrar pro resto da campanha, porque a RLS de `characters` só
  -- deixa o DONO ou o MESTRE ler a linha (mesmo motivo de
  -- combat_participants.display_name, db/015). É um snapshot do
  -- momento da criação do token, não atualiza sozinho se o personagem
  -- mudar de nome/foto depois -- mesma limitação já aceita lá.
  label text,
  image_url text,
  x double precision not null default 50, -- posição em % do tabuleiro (0-100), não pixel -- consistente em qualquer tamanho de tela
  y double precision not null default 50,
  size double precision not null default 6, -- tamanho em % da largura do tabuleiro (fase 2: alça de redimensionar)
  shape text not null default 'circle' check (shape in ('circle', 'square')),
  border_color text not null default '#5ad4ff',
  z_index integer not null default 0, -- ordem de sobreposição (fase 2: reordenar)
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index board_tokens_board_idx on board_tokens(board_id);

alter table boards enable row level security;
alter table board_tokens enable row level security;

-- boards: mesmo padrão de campaign_combat -- todo mundo da campanha
-- vê, só o mestre (ou superadmin) cria/edita/apaga.
create policy "tabuleiro: campanha vê" on boards
  for select using (campaign_id = current_campaign_id());
create policy "tabuleiro: mestre mexe" on boards
  for all using (is_master() and campaign_id = current_campaign_id())
  with check (is_master() and campaign_id = current_campaign_id());
create policy "tabuleiro: superadmin mexe" on boards
  for all using (is_superadmin()) with check (is_superadmin());

-- board_tokens: mesmo padrão de combat_participants -- campanha vê,
-- mestre mexe em qualquer token, dono do personagem mexe só no
-- próprio (pra poder arrastar o próprio token sem depender do mestre).
create policy "token: campanha vê" on board_tokens
  for select using (campaign_id = current_campaign_id());
create policy "token: mestre mexe" on board_tokens
  for all using (is_master() and campaign_id = current_campaign_id())
  with check (is_master() and campaign_id = current_campaign_id());
create policy "token: superadmin mexe" on board_tokens
  for all using (is_superadmin()) with check (is_superadmin());
create policy "token: dono ajusta o próprio" on board_tokens
  for update using (character_id in (select id from characters where owner_id = auth.uid()))
  with check (character_id in (select id from characters where owner_id = auth.uid()));

-- Realtime -- mesma necessidade do combate: refletir ao vivo o que o
-- mestre/jogadores fazem no tabuleiro. REPLICA IDENTITY FULL pelo
-- mesmo motivo documentado em db/015 (combat_participants): sem
-- isso, DELETE só manda a PK na linha "old", e como o client filtra
-- token por board_id/campaign_id (não só id), o token apagado por
-- outro cliente nunca sumiria da tela sem um refetch completo.
alter publication supabase_realtime add table boards;
alter publication supabase_realtime add table board_tokens;
alter table boards replica identity full;
alter table board_tokens replica identity full;
