// Registro dos sistemas de regras. Cada campanha tem `campaigns.system` (db/071); o app entra em UMA campanha por vez
// (trocar de personagem/mesa remonta tudo), então o sistema da campanha atual fica num "ativo" global e o resto do código
// pergunta a ele (characterSheet.js, combate, ficha...) em vez de ter as regras embutidas.
//
// Pra ADICIONAR um sistema (só quando o dono mandar as regras):
//   1. src/systems/<id>.js exportando um objeto com o MESMO formato de cave-story.js
//      (attributes, attributeTestDie, hpMax, estaminaMax, xpNeeded, carryMax, conditions);
//   2. registrar aqui em REGISTRY;
//   3. inserir a linha em game_systems (id, label, description) numa migration;
//   4. se o sistema tiver ficha própria, guardar em characters.system_data (jsonb) -- o Cave Story fica nas colunas atuais;
//   5. regras com validação no servidor (XP, nível, status) entram numa RPC despachada por campaigns.system.
import { caveStory } from './cave-story.js';

export const DEFAULT_SYSTEM = 'cave-story';
const REGISTRY = { [caveStory.id]: caveStory };

export function getRuleset(id) {
  return REGISTRY[id] || REGISTRY[DEFAULT_SYSTEM];
}

export function knownSystemIds() {
  return Object.keys(REGISTRY);
}

let active = REGISTRY[DEFAULT_SYSTEM];

// chamado ao entrar numa campanha (router / painel de gestão)
export function setActiveSystem(id) {
  active = getRuleset(id);
  return active;
}

export function activeRuleset() {
  return active;
}
