-- Dano de NPC (aliado/inimigo sem personagem vinculado) é texto livre
-- digitado pelo mestre direto -- NPC não tem status/ficha pra calcular
-- fórmula como arma de jogador (ver src/shared/damageFormula.js).
alter table combat_participants add column damage text;
