-- Tabuleiro: paredes com colisão + iluminação dinâmica.
--
--  * boards ganha o tamanho natural da imagem (o "palco" do tabuleiro
--    passa a ter a proporção da imagem, igual pra todo mundo) e os
--    ajustes de colisão/iluminação do tabuleiro.
--  * board_walls: segmentos desenhados pelo mestre (parede, janela,
--    porta, invisível). Coordenadas em % do palco, igual aos tokens.
--  * board_lights: fontes de luz presas a um token (token_id) ou fixas
--    no cenário (token_id null, x/y). Raio em % da LARGURA do palco.
--  * update_my_light: o jogador acende/apaga a própria luz (RLS não
--    restringe coluna, então o ajuste passa por uma função).
--
-- RLS e Realtime espelham board_tokens (db/054): campanha vê, mestre
-- mexe, superadmin mexe; replica identity full pelo mesmo motivo (DELETE
-- precisa do board_id na linha antiga pro filtro do cliente).

alter table boards
  add column bg_width integer,
  add column bg_height integer,
  add column collision_enabled boolean not null default true,
  add column lighting_enabled boolean not null default false,
  add column ambient real not null default 0.92 check (ambient >= 0 and ambient <= 1),
  add column fog_mode text not null default 'escuro' check (fog_mode in ('escuro', 'neblina')),
  add column ambient_color text not null default '#05060d' check (ambient_color ~ '^#[0-9a-fA-F]{6}$'),
  add column show_walls_to_players boolean not null default false;

create table board_walls (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  x1 double precision not null check (x1 >= 0 and x1 <= 100),
  y1 double precision not null check (y1 >= 0 and y1 <= 100),
  x2 double precision not null check (x2 >= 0 and x2 <= 100),
  y2 double precision not null check (y2 >= 0 and y2 <= 100),
  kind text not null default 'parede' check (kind in ('parede', 'janela', 'porta', 'invisivel')),
  blocks_move boolean not null default true,
  blocks_light boolean not null default true,
  door_open boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index board_walls_board_idx on board_walls(board_id);

create table board_lights (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  token_id uuid references board_tokens(id) on delete cascade, -- null = luz fixa do cenário
  x double precision check (x is null or (x >= 0 and x <= 100)),
  y double precision check (y is null or (y >= 0 and y <= 100)),
  kind text not null default 'tocha' check (kind in ('tocha', 'lanterna', 'magia', 'vela', 'custom')),
  radius real not null default 18 check (radius >= 0.5 and radius <= 150), -- % da largura do palco (parte bem iluminada)
  dim_radius real not null default 30 check (dim_radius >= 0.5 and dim_radius <= 150), -- penumbra
  color text not null default '#ffb35a' check (color ~ '^#[0-9a-fA-F]{6}$'),
  angle real not null default 360 check (angle >= 5 and angle <= 360), -- abertura do cone em graus
  direction real check (direction is null or (direction >= 0 and direction <= 360)), -- null = segue o movimento
  intensity real not null default 1 check (intensity >= 0 and intensity <= 1),
  flicker real not null default 0.3 check (flicker >= 0 and flicker <= 1),
  pulse real not null default 0 check (pulse >= 0 and pulse <= 1),
  enabled boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- luz fixa precisa de posição; luz presa a token herda a do token
  check (token_id is not null or (x is not null and y is not null))
);
create index board_lights_board_idx on board_lights(board_id);

alter table board_walls enable row level security;
alter table board_lights enable row level security;

create policy "parede: campanha vê" on board_walls
  for select using (campaign_id = current_campaign_id());
create policy "parede: mestre mexe" on board_walls
  for all using (is_master() and campaign_id = current_campaign_id())
  with check (is_master() and campaign_id = current_campaign_id());
create policy "parede: superadmin mexe" on board_walls
  for all using (is_superadmin()) with check (is_superadmin());

create policy "luz: campanha vê" on board_lights
  for select using (campaign_id = current_campaign_id());
create policy "luz: mestre mexe" on board_lights
  for all using (is_master() and campaign_id = current_campaign_id())
  with check (is_master() and campaign_id = current_campaign_id());
create policy "luz: superadmin mexe" on board_lights
  for all using (is_superadmin()) with check (is_superadmin());

alter publication supabase_realtime add table board_walls;
alter publication supabase_realtime add table board_lights;
alter table board_walls replica identity full;
alter table board_lights replica identity full;

-- Jogador acende/apaga a própria luz e a lanterna lembra pra onde apontava.
-- Só mexe em enabled/direction, e só de luz presa a token de personagem dele.
create or replace function update_my_light(p_light_id uuid, p_enabled boolean default null, p_direction real default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update board_lights l
     set enabled = coalesce(p_enabled, l.enabled),
         direction = coalesce(p_direction, l.direction)
   where l.id = p_light_id
     and l.campaign_id = current_campaign_id()
     and exists (
       select 1 from board_tokens t
       join characters c on c.id = t.character_id
       where t.id = l.token_id and c.owner_id = auth.uid()
     );
  if not found then
    raise exception 'sem permissão pra mexer nessa luz';
  end if;
end;
$$;
grant execute on function update_my_light(uuid, boolean, real) to authenticated;
