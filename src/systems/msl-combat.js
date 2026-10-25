// Automação de combate do Magic Learning (ver MSL_Regras_para_Site.md, seção 3): Pontos de Ação, Exaustão, iniciativa, dano com armadura e tipos de dano.
// Funções puras (paOf, expressões de dado...) + escritas no banco (participante e, quando vinculado, a ficha do personagem).
// Não importa src/combat.js (que importa este arquivo no passar-de-turno): condições vão direto pela RPC e o log por battleLog.js.
import { supabase } from '../supabaseClient.js';
import { logEvent } from '../battleLog.js';
import { derive, mslOf, attrTotal, woundState, rollDie } from './magic-learning.js';
import { DAMAGE_TYPES } from './msl-data.js';

export const PA_PER_ROUND = 6;

// ------------------------------------------------------------------ Pontos de Ação
const hasCond = (p, key) => Array.isArray(p.conditions) && p.conditions.some((c) => c.tipo === key);
// PA da rodada: 6, menos o que efeitos de dano tiraram (Impacto −1, Gelo −2)
export function basePa(p) {
  return Math.max(1, PA_PER_ROUND - (hasCond(p, 'impactado') ? 1 : 0) - (hasCond(p, 'congelado') ? 2 : 0));
}
// PA que restam NESTA rodada (rodada nova = valor cheio; nada precisa ser zerado no banco)
export const paOf = (p, round) => (p.pa_round === round && p.pa_left !== null && p.pa_left !== undefined ? p.pa_left : basePa(p));
export const isExhaustedRound = (p, round) => p.exh_round === round;

// ------------------------------------------------------------------ dados
// "2d6+3", "1d8", "5", "1d6+1d4-1": soma dos termos; devolve { total, text }
export function rollExpr(expr) {
  const s = String(expr || '').replace(/\s+/g, '').toLowerCase();
  if (!s) return null;
  const terms = s.match(/[+-]?[^+-]+/g);
  if (!terms || terms.join('') !== s) return null;
  let total = 0;
  const parts = [];
  for (const t of terms) {
    const sign = t.startsWith('-') ? -1 : 1;
    const body = t.replace(/^[+-]/, '');
    const m = /^(\d*)d(\d+)$/.exec(body);
    if (m) {
      const n = Math.min(50, parseInt(m[1] || '1', 10));
      const sides = Math.min(1000, parseInt(m[2], 10));
      if (!sides) return null;
      const rolls = Array.from({ length: n }, () => rollDie(sides));
      total += sign * rolls.reduce((a, b) => a + b, 0);
      parts.push(`${sign < 0 ? '−' : ''}${n}d${sides}[${rolls.join(',')}]`);
    } else if (/^\d+$/.test(body)) {
      total += sign * parseInt(body, 10);
      parts.push(`${sign < 0 ? '−' : '+'}${body}`);
    } else return null;
  }
  return { total, text: parts.join(' ') };
}

// ------------------------------------------------------------------ escritas (participante + ficha)
async function patchParticipant(id, patch) {
  const { error } = await supabase.from('combat_participants').update(patch).eq('id', id);
  if (error) throw error;
}
async function syncChar(characterId, patch) {
  if (!characterId || !Object.keys(patch).length) return;
  const { error } = await supabase.from('characters').update(patch).eq('id', characterId);
  if (error) throw error;
}
function say(campaignId, p, detail, amount) {
  logEvent(campaignId, { type: 'rolagem', participantName: p.display_name, actorCharacterId: p.character_id || null, amount: amount ?? null, detail }).catch(() => {});
}

// gasta PA (e PE igual, salvo na rodada em que agiu exausto). Lança Error com o motivo se não der.
export async function spendAction(p, round, { cost, label }) {
  const pa = paOf(p, round);
  const exh = isExhaustedRound(p, round);
  if (cost > pa) throw new Error(`PA insuficiente: ${label} custa ${cost} e restam ${pa}.`);
  if (!exh && p.stamina_current < cost) {
    throw new Error(`PE insuficiente: ${label} custa ${cost} PE e há ${p.stamina_current}. Com 0 PE use "agir exausto" (rola 1d6 de PA e ganha +1 de exaustão).`);
  }
  const patch = { pa_left: pa - cost, pa_round: round };
  if (!exh) patch.stamina_current = p.stamina_current - cost;
  await patchParticipant(p.id, patch);
  if (!exh) await syncChar(p.character_id, { estamina_current: patch.stamina_current });
  Object.assign(p, patch);
  say(p.campaign_id, p, `Ação: ${label} (${cost} PA${exh ? ', exausto' : ' + ' + cost + ' PE'}) — restam ${patch.pa_left} PA`, cost);
  return patch;
}

// devolve PA (e PE, fora da rodada exausta): corrige clique errado
export async function refundAction(p, round, cost = 1) {
  const exh = isExhaustedRound(p, round);
  const paNow = paOf(p, round);
  const max = exh ? 6 : basePa(p);
  const add = Math.min(cost, Math.max(0, max - paNow));
  if (add <= 0) return;
  const patch = { pa_left: paNow + add, pa_round: round };
  if (!exh) patch.stamina_current = Math.min(p.stamina_max, p.stamina_current + add);
  await patchParticipant(p.id, patch);
  if (!exh) await syncChar(p.character_id, { estamina_current: patch.stamina_current });
  Object.assign(p, patch);
}

// 0 PE e quer agir: 1d6 de PA nessa rodada, +1 de exaustão (−2 em testes e CE por nível); no limite da ficha, desmaia
export async function enterExhaustion(p, round, char) {
  if (isExhaustedRound(p, round)) throw new Error('já agiu exausto nesta rodada.');
  if (p.stamina_current > 0) throw new Error('só dá pra agir exausto com 0 PE.');
  const d6 = rollDie(6);
  const level = (p.exaustao || 0) + 1;
  const limit = char && char.system_data ? derive(char).exaustaoMax : 5;
  const patch = { pa_left: d6, pa_round: round, exh_round: round, exaustao: level };
  await patchParticipant(p.id, patch);
  Object.assign(p, patch);
  // espelha na ficha (mesma conta), pra o jogador ver e os testes da ficha já usarem a penalidade
  if (p.character_id && char && char.system_data) {
    const msl = mslOf(char);
    const raw = (char.system_data && char.system_data.msl) || {};
    const system_data = { ...(char.system_data || {}), msl: { ...raw, initialized: true, exaustao: Math.max(msl.exaustao, level) } };
    await syncChar(p.character_id, { system_data });
    char.system_data = system_data;
  }
  const fainted = level >= limit;
  if (fainted) {
    await supabase.rpc('apply_combat_condition', { p_participant_id: p.id, p_condition_key: 'desmaiado', p_duration_rounds: null }).then(() => {}, () => {});
  }
  say(p.campaign_id, p, `Exausto: ${d6} PA nesta rodada · exaustão ${level} (−${2 * level} nos testes e na CE)${fainted ? ' · DESMAIOU' : ''}`, level);
  return { d6, level, fainted };
}

// ------------------------------------------------------------------ iniciativa
// 1d20 + Reflexos//2 (+4 de Mãos Rápidas, já dentro de iniciativaMod); empate: maior Agilidade
export function initiativeFor(char) {
  const mod = char && char.system_data ? derive(char).iniciativaMod : 0;
  const d = rollDie(20);
  return { d, mod, total: d + mod, agi: char && char.system_data ? attrTotal(char, 'agilidade') : 0 };
}
export const initiativeMod = (char) => (char && char.system_data ? derive(char).iniciativaMod : 0);
export function sortByInitiative(participants, charOf) {
  return participants
    .slice()
    .sort((a, b) => {
      const ia = a.initiative ?? -999;
      const ib = b.initiative ?? -999;
      if (ib !== ia) return ib - ia;
      const ca = charOf(a);
      const cb = charOf(b);
      const ag = (c) => (c && c.system_data ? attrTotal(c, 'agilidade') : 0);
      return ag(cb) - ag(ca);
    })
    .map((p) => p.id);
}

// ------------------------------------------------------------------ dano
const CHANCE = { cortante: 20, impacto: 20, fogo: 30, gelo: 25, eletricidade: 25, vento: 30, terra: 20, sombra: 20 };
// efeito -> condição do catálogo do sistema + duração em rodadas (null = até tratar)
const EFFECT = {
  cortante: { cond: 'sangrando', rounds: null, text: 'Sangramento: 5% do HP máximo por turno, até ser tratado' },
  impacto: { cond: 'impactado', rounds: 1, text: '−1 PA no próximo turno' },
  fogo: { cond: 'queimando', rounds: 3, text: 'Queimadura: 7% do HP máximo por turno, por 3 turnos' },
  gelo: { cond: 'congelado', rounds: 1, text: '−2 PA no próximo turno' },
  eletricidade: { cond: 'eletrizado', rounds: 1, text: '−20% de Fluxo (mín. −2) no próximo turno' },
  vento: { cond: 'ventania', rounds: 2, text: '−20% de Reflexos (mín. −2) por 2 turnos' },
  terra: { cond: 'enterrado', rounds: 1, text: 'metade do deslocamento no próximo turno' },
  sombra: { cond: 'sombrio', rounds: 2, text: '−20% de RM (mín. −2) por 2 turnos' },
};
const PHYSICAL = new Set(['cortante', 'impacto', 'perfurante']);
const norm = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Aplica um golpe: dano bruto − armadura (perfurante ignora metade, arredondando pra cima) → HP; rola o d100 do efeito do tipo.
// opts: { amount, type, origin: 'fisico'|'magico', undead (luz +20%), report } -- `char` é a ficha do ALVO (pode ser null: sem armadura).
export async function applyDamage(p, char, { amount, type, origin, undead }) {
  const lines = [];
  const def = DAMAGE_TYPES.find((t) => t.id === type);
  const d = char && char.system_data ? derive(char) : null;
  const msl = char && char.system_data ? mslOf(char) : null;
  let raw = Math.max(0, Math.round(amount));
  let armor = d ? d.armadura : 0;
  if (type === 'perfurante') armor = Math.ceil(armor / 2);
  if (type === 'luz' && undead) {
    raw = Math.round(raw * 1.2);
    lines.push(`Luz contra morto-vivo/sombrio: +20% → ${raw}`);
  }
  let dmg = Math.max(0, raw - armor);
  lines.push(`${def ? def.name : type}: ${raw} bruto − armadura ${armor}${type === 'perfurante' ? ' (metade, perfurante)' : ''} = ${dmg}`);
  // Resistência Elemental: metade do dano do tipo escolhido e o efeito nunca se aplica
  const resist = msl && msl.advantages.some((e) => e.id === 'resistencia_elemental' && norm(e.note).includes(norm(def ? def.name : type)));
  if (resist) {
    dmg = Math.floor(dmg / 2);
    lines.push(`Resistência Elemental: metade → ${dmg}`);
  }
  const hpBefore = p.hp_current;
  const hpAfter = Math.max(-30, hpBefore - dmg);
  const patch = { hp_current: hpAfter };
  await patchParticipant(p.id, patch);
  await syncChar(p.character_id, { hp_current: hpAfter });
  Object.assign(p, patch);
  if (dmg > 0) logEvent(p.campaign_id, { type: 'dano', participantName: p.display_name, actorCharacterId: p.character_id || null, amount: dmg, detail: `${def ? def.name : type}` }).catch(() => {});
  if (dmg > p.hp_max / 2) lines.push('⚠ ATAQUE LETAL (dano maior que metade do HP máximo): gatilho de Sanidade / Coração Frágil.');
  const state = woundState(hpAfter, p.hp_max, d ? d.morteHp : -16);
  lines.push(`HP ${hpBefore} → ${hpAfter} (${state.label})`);

  // efeito do tipo
  if (type === 'vento') lines.push('Vento: empurra o alvo 2 m (sempre).');
  if (type === 'perfurante' || type === 'luz') return { lines, hp: hpAfter, state };
  const chance = CHANCE[type];
  if (!chance || resist) {
    if (resist) lines.push('Resistência Elemental: o efeito nunca se aplica.');
    return { lines, hp: hpAfter, state };
  }
  const roll = rollDie(100);
  if (roll > chance) {
    lines.push(`d100 = ${roll} (precisava de ≤ ${chance}): sem efeito.`);
    return { lines, hp: hpAfter, state };
  }
  lines.push(`d100 = ${roll} (≤ ${chance}): EFEITO!`);
  if (type === 'eletricidade' && rollDie(100) <= 10) {
    lines.push('Eletricidade (10%): o alvo PERDE O TURNO em vez do efeito de Fluxo.');
    return { lines, hp: hpAfter, state };
  }
  const eff = EFFECT[type];
  // RF (físico) / RM (mágico): a cada 5 pontos, −1 turno de duração (e −1 de dano por turno no sangramento/queimadura)
  const res = d ? attrTotal(char, (origin === 'fisico' || (!origin && PHYSICAL.has(type))) ? 'res_fisica' : 'res_magica') : 0;
  const cut = Math.floor(res / 5);
  let rounds = eff.rounds;
  if (rounds !== null && cut > 0) rounds = Math.max(1, rounds - cut);
  const { error } = await supabase.rpc('apply_combat_condition', { p_participant_id: p.id, p_condition_key: eff.cond, p_duration_rounds: rounds });
  if (error) lines.push(`(não consegui aplicar a condição: ${error.message})`);
  else lines.push(`${eff.text}${rounds !== null && rounds !== eff.rounds ? ` — duração reduzida pela resistência: ${rounds} turno(s)` : ''}.`);
  return { lines, hp: hpAfter, state };
}

// início do turno de alguém: sangramento/queimadura causam % do HP máximo (mín. 1, máx. 10; −1 por 5 de RF/RM, mín. 1) e ignoram armadura
export async function startTurnEffects(participantId) {
  const { data: p } = await supabase.from('combat_participants').select('*').eq('id', participantId).maybeSingle();
  if (!p || !Array.isArray(p.conditions) || !p.conditions.length) return [];
  const burns = [
    ['sangrando', 0.05, 'sangramento', 'res_fisica'],
    ['queimando', 0.07, 'queimadura', 'res_magica'],
  ].filter(([k]) => hasCond(p, k));
  if (!burns.length) return [];
  let char = null;
  if (p.character_id) {
    const { data } = await supabase.from('characters').select('id, system_data').eq('id', p.character_id).maybeSingle();
    char = data;
  }
  let hp = p.hp_current;
  const out = [];
  for (const [, pct, label, resKey] of burns) {
    let dmg = Math.min(10, Math.max(1, Math.round(p.hp_max * pct)));
    if (char && char.system_data) dmg = Math.max(1, dmg - Math.floor(attrTotal(char, resKey) / 5));
    hp = Math.max(-30, hp - dmg);
    out.push(`${p.display_name}: ${label} −${dmg} HP`);
    logEvent(p.campaign_id, { type: 'dano', participantName: p.display_name, actorCharacterId: p.character_id || null, amount: dmg, detail: label }).catch(() => {});
  }
  await patchParticipant(p.id, { hp_current: hp });
  await syncChar(p.character_id, { hp_current: hp });
  return out;
}
