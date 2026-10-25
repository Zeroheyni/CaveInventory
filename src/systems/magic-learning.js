// Regras do sistema "Magic Learning" (Magical Skill Learning) -- ver MSL_Regras_para_Site.md.
// Ficha em characters.system_data.msl (jsonb); só nível/XP e HP/PE atuais usam as colunas de sempre (level, xp, hp_current,
// estamina_current), pra rastreador de combate, tabuleiro e dados continuarem funcionando sem mudança.
// Convenções do livro: divisões arredondam pra baixo; atributo nunca fica abaixo de 0; "teste" = 1d20 + atributo//2 + modificadores.
import { SINGLE_CURRENCY } from './currency.js';
import { ADVANTAGES, DISADVANTAGES, SKILLS, SKILL_BONUS, MSL_CONDITIONS, SANITY_LOSS } from './msl-data.js';

const A = (key, label, abbr, icon, color, group, sub, short) => ({ key, label, abbr, icon, color, group, sub, short: short || label });
export const ATTRIBUTE_GROUPS = [
  { id: 'basico', label: 'Básicos' },
  { id: 'social', label: 'Sociais' },
  { id: 'magico', label: 'Mágicos' },
];
const attributes = [
  A('forca', 'Força', 'FOR', '💪', '#ff8a4c', 'basico', 'potencia', 'Força'),
  A('poder_magico', 'Poder Mágico', 'POD', '✨', '#b98bff', 'basico', 'potencia', 'Poder Mágico'),
  A('agilidade', 'Agilidade', 'AGI', '🏃', '#5ad4ff', 'basico', 'mobilidade', 'Agilidade'),
  A('reflexos', 'Reflexos', 'REF', '⚡', '#ffd93d', 'basico', 'mobilidade', 'Reflexos'),
  A('res_fisica', 'Resistência Física', 'RF', '🛡', '#c9b878', 'basico', 'resistencia', 'Física'),
  A('res_magica', 'Resistência Mágica', 'RM', '🔮', '#9d7bff', 'basico', 'resistencia', 'Mágica'),
  A('intelecto', 'Intelecto', 'INT', '🧠', '#5ad4ff', 'basico', 'foco', 'Intelecto'),
  A('disciplina', 'Disciplina', 'DIS', '📿', '#2dd4bf', 'basico', 'foco', 'Disciplina'),
  A('prec_fisica', 'Precisão Física', 'PFí', '🎯', '#4ade80', 'basico', 'precisao', 'Física'),
  A('prec_magica', 'Precisão Mágica', 'PMá', '🌠', '#e879f9', 'basico', 'precisao', 'Mágica'),
  A('estamina', 'Estamina', 'EST', '🔋', '#ffb84d', 'basico', 'vigor', 'Estamina'),
  A('vitalidade', 'Vitalidade', 'VIT', '❤', '#ff5a5a', 'basico', 'vigor', 'Vitalidade'),
  A('ameacar', 'Ameaçar', 'AME', '😠', '#ff5a5a', 'social'),
  A('acalmar', 'Acalmar', 'ACA', '🕊', '#4ade80', 'social'),
  A('enganacao', 'Enganação', 'ENG', '🎭', '#e879f9', 'social'),
  A('perspicacia', 'Perspicácia', 'PER', '👁', '#2dd4bf', 'social'),
  A('autocontrole', 'Autocontrole', 'AUT', '🧘', '#5ad4ff', 'social'),
  A('armazenamento', 'Armazenamento', 'ARM', '🏺', '#b98bff', 'magico'),
  A('canalizacao', 'Canalização', 'CAN', '🌊', '#5ad4ff', 'magico'),
  A('controle', 'Controle', 'CTR', '🎛', '#ffd93d', 'magico'),
  A('moldagem', 'Moldagem', 'MOL', '🗿', '#c9b878', 'magico'),
  A('sensitividade', 'Sensitividade', 'SEN', '📡', '#2dd4bf', 'magico'),
  A('interpretacao', 'Interpretação', 'ITP', '📜', '#ff8a4c', 'magico'),
];
// "Função" de cada atributo no Ficha-Guia; sociais dizem com o que o alvo resiste, mágicos onde costumam escalar nas magias
const INFO = {
  forca: { desc: 'Dano corpo a corpo, força bruta e capacidade de carga' },
  poder_magico: { desc: 'Potência de magias ofensivas e efeitos mágicos. Escala o dano de itens mágicos (ex.: cajados)' },
  agilidade: { desc: 'Deslocamento e movimentação no campo de batalha' },
  reflexos: { desc: 'Esquiva e velocidade de reação' },
  res_fisica: { desc: 'Reduz efeitos físicos negativos: atordoamento, empurrões, quedas, queimadura, veneno, sangramento' },
  res_magica: { desc: 'Diminui intensidade e duração de efeitos mágicos prejudiciais. Resiste a magias' },
  intelecto: { desc: 'Facilita aprender magias e conhecimento arcano. Sem impacto direto no combate' },
  disciplina: { desc: 'Facilita aprender estilos de luta e técnicas físicas. Sem impacto direto no combate' },
  prec_fisica: { desc: 'Acerto de ataques físicos, corpo a corpo e à distância' },
  prec_magica: { desc: 'Acerto de magias que exigem mira direta' },
  estamina: { desc: 'Resistência a esforço físico. Define o PE' },
  vitalidade: { desc: 'Define o HP' },
  ameacar: { desc: 'Intimidar, mexer na emoção do alvo para o medo', resist: 'Autocontrole' },
  acalmar: { desc: 'Mexer na emoção do alvo para a calmaria', resist: 'Autocontrole' },
  enganacao: { desc: 'Mentir, enganar', resist: 'Perspicácia' },
  perspicacia: { desc: 'Perceber mentiras e intenções' },
  autocontrole: { desc: 'Resistir a Ameaçar e Acalmar' },
  armazenamento: { desc: 'Capacidade de armazenar energia mágica', scales: 'reservas, efeitos que duram mais ou acumulam energia' },
  canalizacao: { desc: 'Capacidade de canalizar energia mágica pela matéria', scales: 'alcance, direcionamento, propagação, alvos extras' },
  controle: { desc: 'Coordenação da energia mágica (ex.: usar magias ao mesmo tempo)', scales: 'duração, número de alvos, precisão' },
  moldagem: { desc: 'Moldar energia mágica em formatos, sem moldes', scales: 'formas criativas, área de efeito, construções' },
  sensitividade: { desc: 'Sentir energia mágica, geralmente por um dos sentidos', scales: 'detectar, prever, reagir mais rápido' },
  interpretacao: { desc: 'Interpretar energia criptografada, moldada em formatos complexos ou transmutada', scales: 'decifrar, transformar, efeitos incomuns' },
};
attributes.forEach((a) => Object.assign(a, INFO[a.key] || {}));
const ATTR_KEYS = attributes.map((a) => a.key);

// os atributos básicos aparecem em 6 pares (como no livro)
export const BASIC_SUBGROUPS = [
  { id: 'potencia', label: 'Potência', icon: '⚡', color: '#ff8a4c' },
  { id: 'mobilidade', label: 'Mobilidade', icon: '🏃', color: '#5ad4ff' },
  { id: 'resistencia', label: 'Resistência', icon: '🛡️', color: '#c9b878' },
  { id: 'precisao', label: 'Precisão', icon: '🎯', color: '#4ade80' },
  { id: 'foco', label: 'Foco', icon: '🧠', color: '#b98bff' },
  { id: 'vigor', label: 'Vigor', icon: '🔥', color: '#ff5a5a' },
];

export const CREATION_POOLS = { basicos: 19, sociais: 8, magicos: 10 };
export const CREATION_SKILL_GRADES = 4; // graus de perícia na criação (máx. grau 2 por perícia)
const POOL_OF_GROUP = { basico: 'basicos', social: 'sociais', magico: 'magicos' };
export const poolKeyOfAttr = (key) => POOL_OF_GROUP[(attributes.find((a) => a.key === key) || {}).group];

const advById = Object.fromEntries(ADVANTAGES.map((a) => [a.id, a]));
const disById = Object.fromEntries(DISADVANTAGES.map((d) => [d.id, d]));
export const advantageById = (id) => advById[id] || null;
export const disadvantageById = (id) => disById[id] || null;

// ------------------------------------------------------------- dados da ficha (com padrões)
// Aceita o personagem (com system_data) ou o próprio objeto da ficha. Nunca devolve campo faltando.
export function mslOf(char) {
  const raw = (char && char.system_data && char.system_data.msl) || {};
  const attrs = {};
  const temp = {};
  ATTR_KEYS.forEach((k) => {
    attrs[k] = Math.max(0, parseInt((raw.attrs || {})[k], 10) || 0);
    temp[k] = parseInt((raw.temp || {})[k], 10) || 0;
  });
  return {
    attrs,
    temp, // modificadores temporários (magias, efeitos): afetam testes/CE/deslocamento, NÃO os máximos
    initialized: !!raw.initialized,
    pool: { ...(raw.initialized ? { basicos: 0, sociais: 0, magicos: 0 } : CREATION_POOLS), ...(raw.pool || {}) },
    skillGrades: raw.skillGrades === undefined ? (raw.initialized ? 0 : CREATION_SKILL_GRADES) : Math.max(0, parseInt(raw.skillGrades, 10) || 0),
    skills: { ...(raw.skills || {}) }, // id -> grau 0..3
    oficio: raw.oficio || '', // qual ofício (perícia Ofício)
    idiomas: Array.isArray(raw.idiomas) ? raw.idiomas : [],
    advantages: Array.isArray(raw.advantages) ? raw.advantages : [], // [{ id, note }]
    disadvantages: Array.isArray(raw.disadvantages) ? raw.disadvantages : [],
    talents: Array.isArray(raw.talents) ? raw.talents : [], // [id]
    spells: Array.isArray(raw.spells) ? raw.spells : [], // [id]
    school: raw.school || '',
    element: raw.element || '',
    mp: raw.mp === undefined || raw.mp === null ? null : parseInt(raw.mp, 10),
    sanidade: raw.sanidade === undefined || raw.sanidade === null ? 100 : parseInt(raw.sanidade, 10),
    exaustao: Math.max(0, parseInt(raw.exaustao, 10) || 0),
    traumas: Array.isArray(raw.traumas) ? raw.traumas : [], // [{ d, name, text }]
    notes: raw.notes || '',
    armor: Math.max(0, parseInt(raw.armor, 10) || 0), // armadura de itens
    active: Array.isArray(raw.active) ? raw.active : [], // magias ativas: sustentadas, formas e criaturas invocadas
    fluxoUsed: Math.max(0, parseInt(raw.fluxoUsed, 10) || 0), // MP gasto no turno atual (limite = Fluxo)
    done: !!raw.done, // criação concluída
    family: String(raw.family || ''), // família mágica (Herança Arcana): libera as magias de família dessa família
    perksConfirmed: !!raw.perksConfirmed, // vantagens/desvantagens confirmadas: o jogador não mexe mais (só o mestre destranca)
    canCreateSpells: !!raw.canCreateSpells, // o mestre libera: jogador só cria magia própria se isto estiver ligado (padrão: não pode)
    noMagic: !!raw.noMagic, // "ainda não tem magia": esconde atributos/status mágicos e não cobra a distribuição deles
  };
}

// ------------------------------------------------------------- bônus de vantagens/desvantagens
function perks(msl) {
  const out = { bonus: {}, flags: {} };
  const add = (list, byId) =>
    list.forEach((e) => {
      const def = byId[e.id];
      if (!def) return;
      Object.entries(def.bonus || {}).forEach(([k, v]) => (out.bonus[k] = (out.bonus[k] || 0) + v));
      Object.entries(def.flags || {}).forEach(([k, v]) => {
        // flags numéricas somam, exceto os "limites" (menor/maior valor vence conforme o caso)
        if (k === 'exaustaoMax') out.flags[k] = k in out.flags ? Math.min(out.flags[k], v) : v;
        else if (k === 'critico') out.flags[k] = Math.min(out.flags[k] || 20, v);
        else if (k === 'morteHp') out.flags[k] = Math.max(out.flags[k] || -16, v);
        else out.flags[k] = (out.flags[k] || 0) + v;
      });
    });
  add(msl.advantages, advById);
  add(msl.disadvantages, disById);
  return out;
}
export const has = (msl, id) => msl.advantages.some((e) => e.id === id) || msl.disadvantages.some((e) => e.id === id);

// ------------------------------------------------------------- atributos
// total permanente (base + bônus de vantagens): é ele que entra nos status derivados
export function attrTotal(char, key) {
  const msl = mslOf(char);
  return Math.max(0, msl.attrs[key] + (perks(msl).bonus[key] || 0));
}
// efetivo pros TESTES: total + modificador temporário
export function attrEffective(char, key) {
  return Math.max(0, attrTotal(char, key) + mslOf(char).temp[key]);
}
// modificador de teste do atributo (atributo // 2)
export const attrMod = (char, key) => Math.floor(attrEffective(char, key) / 2);

// ------------------------------------------------------------- perícias e testes
export const skillGrade = (msl, id) => Math.min(3, Math.max(0, parseInt(msl.skills[id], 10) || 0));
export const skillBonus = (grade) => SKILL_BONUS[grade] || 0;
export function skillMod(char, skillId) {
  const msl = mslOf(char);
  const def = SKILLS.find((s) => s.id === skillId);
  if (!def) return 0;
  return attrMod(char, def.attr) + skillBonus(skillGrade(msl, skillId));
}
// modificador total de um teste de atributo (+ perícia opcional + extras)
export function testMod(char, attrKey, skillId, extra = 0) {
  const msl = mslOf(char);
  let m = attrMod(char, attrKey) + extra;
  if (skillId) m += skillBonus(skillGrade(msl, skillId));
  return m;
}

// ------------------------------------------------------------- status derivados
export function derive(char) {
  const msl = mslOf(char);
  const p = perks(msl);
  const t = (k) => attrTotal(char, k);
  const e = (k) => attrEffective(char, k);
  const exaust = msl.exaustao;
  const ignoredExaust = p.flags.ignoraExaustao ? 1 : 0;
  const exaustPenalty = -2 * Math.max(0, exaust - ignoredExaust) || 0;
  const hpMax = Math.max(1, 15 + t('vitalidade') * 5 + (p.flags.hpMax || 0));
  return {
    hpMax,
    peMax: 20 + t('estamina') * 10,
    ce: 10 + Math.floor(e('reflexos') / 2) + exaustPenalty,
    cc: 5 + t('forca') * 5, // capacidade de carga (peso)
    deslocamento: Math.max(0, 5 + Math.floor(e('agilidade') / 5) + (p.flags.deslocamento || 0)),
    mpMax: 10 + t('armazenamento') * 10,
    fluxo: 5 + t('canalizacao') * 2,
    manutencao: 1 + Math.floor(t('controle') / 5),
    formas: 1 + Math.floor(t('moldagem') / 5),
    deteccao: 5 + t('sensitividade') * 2,
    decifracao: 1 + Math.floor(t('interpretacao') / 4) + (p.flags.decifracao || 0),
    sanidadeMax: 100,
    iniciativaMod: Math.floor(e('reflexos') / 2) + (p.flags.iniciativa || 0),
    armadura: msl.armor + (p.flags.armadura || 0),
    exaustaoMax: p.flags.exaustaoMax || 5, // desmaia quando o nível chega nele
    exaustaoPenalidade: exaustPenalty,
    critico: p.flags.critico || 20,
    morteHp: p.flags.morteHp || -16, // abaixo de -15 = morto (com Propenso a Ferimentos: <= -10)
    arremesso: 3 + Math.floor(e('forca') / 2), // alcance de arremesso (m)
  };
}

// dificuldade fixa de uma magia: 10 + atributo principal // 2 + bônus de escalamentos
export const spellDifficulty = (char, mainAttrKey, bonus = 0) => 10 + Math.floor(attrEffective(char, mainAttrKey) / 2) + bonus;
// caminho da magia -> chave de atributo (o JSON guarda o nome por extenso)
export function attrKeyByLabel(label) {
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const a = attributes.find((x) => norm(x.label) === norm(label)) || attributes.find((x) => norm(x.label).startsWith(norm(label)));
  return a ? a.key : null;
}

// ------------------------------------------------------------- estado de ferimento
export function woundState(hp, hpMax, morteHp = -16) {
  // morre em <= -16 (Propenso a Ferimentos: <= -10); de -1 até lá, "Morrendo"
  if (hp < 0 && hp <= morteHp) return { id: 'morto', label: 'Morto', tone: 'dead' };
  if (hp < 0) return { id: 'morrendo', label: 'Morrendo', tone: 'dying' };
  if (hp > 0.6 * hpMax) return { id: 'bem', label: 'Bem', tone: 'ok' };
  if (hp > 0.3 * hpMax) return { id: 'ferido', label: 'Ferido', tone: 'mid' };
  return { id: 'grave', label: 'Gravemente ferido', tone: 'low' };
}

// ------------------------------------------------------------- XP e níveis
export const xpNeededFor = (level) => level * 100;
export function pointsOnLevel(newLevel) {
  const tenth = newLevel % 10 === 0;
  return { basicos: 3 + (tenth ? 5 : 0), sociais: 2 + (tenth ? 3 : 0), magicos: 3 + (tenth ? 2 : 0), pericia: newLevel % 5 === 0 ? 1 : 0 };
}
// soma XP e sobe de nível quantas vezes precisar; devolve o novo nível/xp e os pontos ganhos
export function applyXp(level, xp, amount) {
  let L = Math.max(1, level);
  let X = Math.max(0, xp + amount);
  const gains = { basicos: 0, sociais: 0, magicos: 0, pericia: 0 };
  let up = 0;
  while (X >= xpNeededFor(L) && up < 200) {
    X -= xpNeededFor(L);
    L += 1;
    up += 1;
    const g = pointsOnLevel(L);
    Object.keys(gains).forEach((k) => (gains[k] += g[k]));
  }
  return { level: L, xp: X, gains, levelsGained: up };
}

// ------------------------------------------------------------- criação: contas de PV (vantagens custam, desvantagens dão)
export function pvSummary(msl) {
  const gained = msl.disadvantages.reduce((s, e) => s + ((disById[e.id] || {}).level || 0), 0);
  const spent = msl.advantages.reduce((s, e) => s + ((advById[e.id] || {}).level || 0), 0);
  const lvl3dis = msl.disadvantages.filter((e) => (disById[e.id] || {}).level === 3).length;
  const lvl3adv = msl.advantages.filter((e) => (advById[e.id] || {}).level === 3).length;
  return { gained: Math.min(gained, 8), rawGained: gained, spent, left: Math.min(gained, 8) - spent, lvl3dis, lvl3adv };
}

// ------------------------------------------------------------- manutenção das magias ativas (início do turno)
// cobra o MP de manutenção de cada magia sustentada / criatura invocada (conta no Fluxo do turno), desconta a duração e encerra o que
// acabou ou não pôde ser pago (na ordem da lista). Devolve o novo estado, sem gravar nada.
export function upkeepTurn(char) {
  const msl = mslOf(char);
  const d = derive(char);
  let mp = msl.mp === null ? d.mpMax : msl.mp;
  let paid = 0;
  const next = [];
  const lines = [];
  msl.active.forEach((e) => {
    const item = { ...e };
    if (item.turns !== null && item.turns !== undefined) item.turns -= 1;
    if (item.turns !== null && item.turns !== undefined && item.turns <= 0) {
      lines.push(`${e.name} acabou (duração)`);
      return;
    }
    if (item.upkeep > 0) {
      if (mp >= item.upkeep) {
        mp -= item.upkeep;
        paid += item.upkeep;
      } else {
        lines.push(`${e.name} se encerrou: faltou MP pra manutenção`);
        return;
      }
    }
    next.push(item);
  });
  return { active: next, before: msl.active.length, mp, paid, lines };
}

// ------------------------------------------------------------- sanidade
export function sanityStage(s) {
  if (s <= 0) return { id: 'colapso', label: 'Colapso (o mestre controla até o fim da cena)' };
  if (s < 25) return { id: 'trauma2', label: 'Segundo trauma' };
  if (s < 50) return { id: 'trauma1', label: 'Primeiro trauma' };
  return { id: 'ok', label: 'Estável' };
}
export const sanityLossDef = (id) => SANITY_LOSS.find((s) => s.id === id);

export const rollDie = (sides) => 1 + Math.floor(Math.random() * sides);
export const rollDice = (n, sides) => Array.from({ length: n }, () => rollDie(sides));

// ============================================================= o sistema (mesmo formato do cave-story.js)
export const magicLearning = {
  id: 'magic-learning',
  label: 'Magic Learning',
  currency: SINGLE_CURRENCY, // dinheiro normal (um valor só), não as 4 moedas bronze/prata/ouro/platina
  hasPublicInventory: false, // sem inventário público nem baú do veículo (transporte)
  hasOwnSheet: true, // a ficha tem tela própria (screens/fichaMsl.js) -- ficha.js do Cave Story não vale aqui

  attributes,
  attributeGroups: ATTRIBUTE_GROUPS,
  // atalhos pro dock do tabuleiro (os 23 atributos não cabem em chips)
  dockStats: ['forca', 'agilidade', 'reflexos', 'intelecto', 'poder_magico', 'vitalidade'],
  attributeTestDie: 'd20',
  // valor "cru" do atributo (o que o Cave Story guarda na coluna); aqui vem de system_data + vantagens
  statValue(char, key) {
    return attrTotal(char, key);
  },
  // siglas das fórmulas de dano dos itens (FOR, VIT, AGI, EST, INT) -> valor do atributo equivalente
  formulaStats(char) {
    return { forca: attrTotal(char, 'forca'), vitalidade: attrTotal(char, 'vitalidade'), agilidade: attrTotal(char, 'agilidade'), estamina: attrTotal(char, 'estamina'), inteligencia: attrTotal(char, 'intelecto') };
  },

  // modificador que entra no teste de um atributo (Cave Story usa o valor cheio; aqui é atributo // 2)
  attributeMod(char, key) {
    return attrMod(char, key);
  },

  // NPC com override digitado pelo mestre vence; senão calcula pela ficha
  hpMax(char) {
    if (char.hp_max_override !== undefined && char.hp_max_override !== null) return char.hp_max_override;
    return derive(char).hpMax;
  },
  // "estamina" do app = PE no Magic Learning
  estaminaMax(char) {
    if (char.estamina_max_override !== undefined && char.estamina_max_override !== null) return char.estamina_max_override;
    return derive(char).peMax;
  },
  xpNeeded: xpNeededFor,
  carryMax(_strength, bonus, char) {
    return char && char.system_data ? derive(char).cc + (bonus || 0) : 5 + 5 * (_strength || 0) + (bonus || 0);
  },

  conditions: MSL_CONDITIONS,
  // nomes das barras no app (HP / PE)
  vitalLabels: { estamina: 'PE' },
};
