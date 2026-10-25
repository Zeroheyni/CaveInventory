// Gera o bloco GENERATED-DATA de supabase/functions/discord-sync-sheet/index.ts a partir das regras do app (src/systems/*),
// pra a Edge Function (que roda no Deno e não importa de src/) usar os mesmos nomes de atributo / vantagem / desvantagem.
// Rodar sempre que mudar atributos, vantagens ou desvantagens:  node scripts/gen-discord-sheet-data.mjs
import fs from 'node:fs';
import { magicLearning, BASIC_SUBGROUPS } from '../src/systems/magic-learning.js';
import { caveStory } from '../src/systems/cave-story.js';
import { ADVANTAGES, DISADVANTAGES } from '../src/systems/msl-data.js';

const perk = (list) =>
  Object.fromEntries(list.map((p) => [p.id, { name: p.name, level: p.level, ...(p.bonus ? { bonus: p.bonus } : {}) }]));
const data = {
  attributes: magicLearning.attributes.map((a) => ({ key: a.key, label: a.label, short: a.short, group: a.group, sub: a.sub || null })),
  subgroups: BASIC_SUBGROUPS.map((g) => ({ id: g.id, label: g.label, icon: g.icon })),
  advantages: perk(ADVANTAGES),
  disadvantages: perk(DISADVANTAGES),
};
const cave = caveStory.attributes.map((a) => ({ key: a.key, label: a.label, icon: a.icon }));

const block =
  '// <GENERATED-DATA>\n' +
  '// (gerado por scripts/gen-discord-sheet-data.mjs -- não editar à mão)\n' +
  'type MslAttr = { key: string; label: string; short: string; group: string; sub: string | null };\n' +
  'type Perk = { name: string; level: number; bonus?: Record<string, number> };\n' +
  `const MSL: { attributes: MslAttr[]; subgroups: { id: string; label: string; icon: string }[]; advantages: Record<string, Perk>; disadvantages: Record<string, Perk> } = ${JSON.stringify(data)};\n` +
  `const CAVE_ATTRIBUTES: { key: string; label: string; icon: string }[] = ${JSON.stringify(cave)};\n` +
  '// </GENERATED-DATA>';

const file = new URL('../supabase/functions/discord-sync-sheet/index.ts', import.meta.url);
let src = fs.readFileSync(file, 'utf8');
const a = src.indexOf('// <GENERATED-DATA>');
const b = src.indexOf('// </GENERATED-DATA>');
if (a < 0 || b < 0) throw new Error('marcadores GENERATED-DATA não encontrados');
src = src.slice(0, a) + block + src.slice(b + '// </GENERATED-DATA>'.length);
fs.writeFileSync(file, src);
console.log('ok:', data.attributes.length, 'atributos,', Object.keys(data.advantages).length, 'vantagens,', Object.keys(data.disadvantages).length, 'desvantagens');
