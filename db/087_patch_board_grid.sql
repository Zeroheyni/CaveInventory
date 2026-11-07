-- ============================================================================
-- Tabuleiro: QUADRICULADO por cima do mapa (pra mapas que vêm sem grade)
--   * o mestre liga/desliga e ajusta por tabuleiro; todo mundo da mesa vê (é só um desenho por cima da imagem)
--   * grid_size   = tamanho da casa em % da LARGURA do palco (a casa é quadrada: a altura em % sai da proporção da imagem)
--   * grid_offset = deslocamento da grade, em % de uma casa (0..100), pra alinhar com a margem do mapa
-- A policy "tabuleiro: mestre mexe" (db/054) já cobre as colunas novas; o realtime de boards (replica identity full) também.
-- ============================================================================

alter table boards
  add column if not exists grid_enabled boolean not null default false,
  add column if not exists grid_size double precision not null default 5 check (grid_size between 1 and 25),
  add column if not exists grid_offset_x double precision not null default 0 check (grid_offset_x between 0 and 100),
  add column if not exists grid_offset_y double precision not null default 0 check (grid_offset_y between 0 and 100),
  add column if not exists grid_color text not null default '#ffffff' check (grid_color ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists grid_opacity double precision not null default 0.4 check (grid_opacity between 0.05 and 1);
