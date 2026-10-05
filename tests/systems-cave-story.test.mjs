// Regressão da extração do Cave Story (Fase 6): as fórmulas do ruleset têm que dar EXATAMENTE o mesmo que as
// fórmulas antigas, que estavam embutidas em characterSheet.js / character.js. Rodar: node tests/systems-cave-story.test.mjs
import assert from 'node:assert/strict';
import { caveStory as rs } from '../src/systems/cave-story.js';
import { getRuleset, setActiveSystem, activeRuleset, DEFAULT_SYSTEM } from '../src/systems/index.js';

// ---- cópias literais das fórmulas ANTIGAS ----
const oldHpMax = (char) => {
  if (char.hp_max_override !== undefined && char.hp_max_override !== null) return char.hp_max_override;
  return (char.vitalidade || 0) * 4;
};
const oldEstaminaMax = (char) => {
  if (char.estamina_max_override !== undefined && char.estamina_max_override !== null) return char.estamina_max_override;
  return char.estamina || 0;
};
const oldXpNeeded = (level) => 10 * level;
const oldCarga1 = (forca, bonus) => 3 * (typeof forca === 'number' ? forca : 10) + bonus; // character.js 576/682/707
const oldCarga2 = (forca, bonus) => 3 * (forca || 0) + bonus; // character.js 2388
const OLD_STATS = ['vitalidade', 'forca', 'agilidade', 'destreza', 'inteligencia', 'estamina', 'observacao'];
const OLD_ABBR = { vitalidade: 'VIT', forca: 'FOR', agilidade: 'AGI', destreza: 'DES', inteligencia: 'INT', estamina: 'EST', observacao: 'OBS' };
const OLD_CONDITIONS = ['envenenado', 'atordoado', 'sangrando', 'queimando', 'congelado', 'amedrontado', 'cego', 'imobilizado'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
let checks = 0;
for (let i = 0; i < 5000; i++) {
  const char = {
    vitalidade: pick([undefined, null, 0, 1, 5, 10, 20, Math.floor(Math.random() * 40)]),
    estamina: pick([undefined, null, 0, 3, 10, Math.floor(Math.random() * 40)]),
    hp_max_override: pick([undefined, null, 0, 17, Math.floor(Math.random() * 100)]),
    estamina_max_override: pick([undefined, null, 0, 9, Math.floor(Math.random() * 100)]),
  };
  assert.equal(rs.hpMax(char), oldHpMax(char));
  assert.equal(rs.estaminaMax(char), oldEstaminaMax(char));
  const level = Math.floor(Math.random() * 60);
  assert.equal(rs.xpNeeded(level), oldXpNeeded(level));
  const forca = pick([undefined, null, 'x', 0, 7, 10, Math.floor(Math.random() * 50)]);
  const bonus = Math.floor(Math.random() * 100) - 20;
  // as chamadas reais normalizam o `forca` exatamente como antes:
  assert.equal(rs.carryMax(typeof forca === 'number' ? forca : 10, bonus), oldCarga1(forca, bonus));
  assert.equal(rs.carryMax(forca || 0, bonus), oldCarga2(forca, bonus));
  checks += 5;
}

assert.deepEqual(rs.attributes.map((a) => a.key), OLD_STATS);
for (const a of rs.attributes) {
  assert.equal(a.abbr, OLD_ABBR[a.key]);
  assert.ok(a.label && a.icon && a.color);
}
assert.deepEqual(rs.conditions.map((c) => c.key), OLD_CONDITIONS);
assert.equal(rs.attributeTestDie, 'd20');

// registro: sistema desconhecido cai no padrão; o ativo troca e volta
assert.equal(getRuleset('nao-existe').id, DEFAULT_SYSTEM);
assert.equal(getRuleset(undefined).id, DEFAULT_SYSTEM);
assert.equal(setActiveSystem('cave-story').id, 'cave-story');
assert.equal(activeRuleset().id, 'cave-story');

console.log(`ok -- ${checks} comparações aleatórias + estrutura do ruleset idênticas às fórmulas antigas`);
