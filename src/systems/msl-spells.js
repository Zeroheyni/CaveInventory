// Cálculo automático das magias do Magic Learning: transforma os "escalamentos" do livro (ex.: "+5 m de alcance a cada 10 pontos" de Canalização)
// e as fórmulas de magias personalizadas (ex.: "ARM × 2" m de alcance) em números, usando os atributos da ficha de quem vai conjurar.
// Tudo aqui é puro (sem banco): recebe o personagem (com system_data) e devolve o que mostrar.
import { magicLearning, attrEffective, attrKeyByLabel, derive, mslOf, spellDifficulty } from './magic-learning.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// ------------------------------------------------------------------ variáveis disponíveis nas fórmulas
// atributo -> siglas aceitas (a primeira é a "oficial" da ficha; as outras são apelidos sem acento)
const ALIASES = {
  forca: ['FOR', 'FORCA'],
  poder_magico: ['POD', 'PODER'],
  agilidade: ['AGI', 'AGILIDADE'],
  reflexos: ['REF', 'REFLEXOS'],
  res_fisica: ['RF'],
  res_magica: ['RM'],
  intelecto: ['INT', 'INTELECTO'],
  disciplina: ['DIS', 'DISCIPLINA'],
  prec_fisica: ['PFI', 'PF'],
  prec_magica: ['PMA', 'PMG'],
  estamina: ['EST', 'ESTAMINA'],
  vitalidade: ['VIT', 'VITALIDADE'],
  ameacar: ['AME', 'AMEACAR'],
  acalmar: ['ACA', 'ACALMAR'],
  enganacao: ['ENG', 'ENGANACAO'],
  perspicacia: ['PER', 'PERSPICACIA'],
  autocontrole: ['AUT', 'AUTOCONTROLE'],
  armazenamento: ['ARM', 'ARMAZENAMENTO'],
  canalizacao: ['CAN', 'CANALIZACAO'],
  controle: ['CTR', 'CON', 'CONTROLE'],
  moldagem: ['MOL', 'MOLDAGEM'],
  sensitividade: ['SEN', 'SENSITIVIDADE'],
  interpretacao: ['ITP', 'INTERP', 'INTERPRETACAO'],
};
// status derivados que também dá pra usar
const DERIVED_VARS = [
  ['MPMAX', 'mpMax', 'MP máximo'],
  ['FLUXO', 'fluxo', 'Fluxo (MP por turno)'],
  ['MANUT', 'manutencao', 'Manutenção (vagas)'],
  ['FORMAS', 'formas', 'Formas (vagas)'],
  ['DETEC', 'deteccao', 'Detecção (m)'],
  ['DECIF', 'decifracao', 'Decifração'],
  ['CE', 'ce', 'Classe de Esquiva'],
  ['DESLOC', 'deslocamento', 'Deslocamento (m)'],
  ['HPMAX', 'hpMax', 'HP máximo'],
  ['PEMAX', 'peMax', 'PE máximo'],
];

// tabela pro botão "?" do criador de magias: sigla, nome e valor atual do personagem
export function variableTable(char, level = 1) {
  const rows = magicLearning.attributes.map((a) => ({
    group: a.group,
    name: a.label,
    abbr: ALIASES[a.key][0],
    aliases: ALIASES[a.key].slice(1),
    value: char ? attrEffective(char, a.key) : null,
  }));
  const d = char ? derive(char) : null;
  const status = DERIVED_VARS.map(([abbr, key, name]) => ({ group: 'status', name, abbr, aliases: [], value: d ? d[key] : null }));
  status.push({ group: 'status', name: 'Nível do personagem', abbr: 'NIVEL', aliases: ['NV'], value: char ? level : null });
  return [...rows, ...status];
}

export function varsFor(char, level = 1) {
  const vars = {};
  magicLearning.attributes.forEach((a) => {
    const v = char ? attrEffective(char, a.key) : 0;
    ALIASES[a.key].forEach((al) => (vars[al] = v));
    vars[norm(a.label).replace(/[^a-z]/g, '').toUpperCase()] = v;
  });
  const d = char ? derive(char) : null;
  DERIVED_VARS.forEach(([abbr, key]) => (vars[abbr] = d ? d[key] : 0));
  vars.NIVEL = vars.NV = char ? level : 1;
  return vars;
}

// ------------------------------------------------------------------ avaliador de fórmulas (sem eval)
// números, + - * / ( ) , siglas, "x"/"×" como multiplicação, "÷" como divisão; "/" arredonda pra baixo (regra do livro); MIN(a,b) MAX(a,b)
export function evalFormula(expr, vars) {
  const src = String(expr || '').trim();
  if (!src) throw new Error('fórmula vazia');
  const tokens = [];
  const re = /\s*(?:(\d+(?:[.,]\d+)?)|([A-Za-zÀ-ÖØ-öø-ÿ_]+)|([-+*/()×÷,]))/gy;
  let m;
  let pos = 0;
  while (pos < src.length && (m = re.exec(src))) {
    pos = re.lastIndex;
    if (m[1] !== undefined) tokens.push({ t: 'n', v: parseFloat(m[1].replace(',', '.')), s: m[1] });
    else if (m[2] !== undefined) tokens.push({ t: 'i', v: m[2], s: m[2] });
    else tokens.push({ t: 'o', v: m[3] === '×' ? '*' : m[3] === '÷' ? '/' : m[3], s: m[3] });
  }
  if (src.slice(pos).trim()) throw new Error('não entendi "' + src.slice(pos).trim().slice(0, 12) + '"');
  // "x" solto entre operandos = multiplicação
  tokens.forEach((tk) => {
    if (tk.t === 'i' && /^x$/i.test(tk.v)) {
      tk.t = 'o';
      tk.v = '*';
    }
  });
  let i = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++];
  const shown = [];
  function atom() {
    const tk = take();
    if (!tk) throw new Error('fórmula incompleta');
    if (tk.t === 'n') {
      shown.push(tk.s);
      return tk.v;
    }
    if (tk.t === 'o' && tk.v === '(') {
      shown.push('(');
      const v = expr1();
      const c = take();
      if (!c || c.v !== ')') throw new Error('falta fechar o parêntese');
      shown.push(')');
      return v;
    }
    if (tk.t === 'o' && tk.v === '-') {
      shown.push('−');
      return -atom();
    }
    if (tk.t === 'i') {
      const name = norm(tk.v).replace(/[^a-z_]/g, '').toUpperCase();
      if ((name === 'MIN' || name === 'MAX') && peek() && peek().v === '(') {
        take();
        shown.push(name + '(');
        const a = expr1();
        const comma = take();
        if (!comma || comma.v !== ',') throw new Error(name + ' precisa de dois valores separados por vírgula');
        shown.push(', ');
        const b = expr1();
        const c = take();
        if (!c || c.v !== ')') throw new Error('falta fechar o parêntese');
        shown.push(')');
        return name === 'MIN' ? Math.min(a, b) : Math.max(a, b);
      }
      if (!(name in vars)) throw new Error('"' + tk.v + '" não é uma sigla conhecida (veja o ? ao lado)');
      shown.push(name + '(' + vars[name] + ')');
      return vars[name];
    }
    throw new Error('fórmula inválida perto de "' + tk.s + '"');
  }
  function term() {
    let v = atom();
    while (peek() && (peek().v === '*' || peek().v === '/') && peek().t === 'o') {
      const op = take().v;
      shown.push(op === '*' ? '×' : '÷');
      const r = atom();
      if (op === '*') v *= r;
      else {
        if (r === 0) throw new Error('divisão por zero');
        v = Math.floor(v / r); // divisões arredondam pra baixo
      }
    }
    return v;
  }
  function expr1() {
    let v = term();
    while (peek() && (peek().v === '+' || peek().v === '-') && peek().t === 'o') {
      const op = take().v;
      shown.push(op === '+' ? ' + ' : ' − ');
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  const value = expr1();
  if (i < tokens.length) throw new Error('sobrou "' + tokens[i].s + '" na fórmula');
  return { value: Math.floor(value), text: shown.join('') };
}

// ------------------------------------------------------------------ escalamentos do livro -> linhas calculáveis
const STEP_RE = /^(.*?)\s*a cada\s+(\d+)\s+pontos?\b[,.]?\s*(.*)$/i;
function parseTerm(t) {
  const m = /^\+?\s*(\d+d\d+|\d+)\s*(.*)$/i.exec(t.trim());
  if (!m) return null;
  const dice = /^(\d+)d(\d+)$/i.exec(m[1]);
  return dice
    ? { kind: 'dice', n: parseInt(dice[1], 10), sides: parseInt(dice[2], 10), unit: m[2].replace(/[.,]$/, '').trim() }
    : { kind: 'num', n: parseInt(m[1], 10), unit: m[2].replace(/[.,]$/, '').trim() };
}
// { attrKey, every, terms:[{kind,n,sides,unit}] } ou { attrKey, every, qual:'texto' }
export function parseBookScaling(spell) {
  return (spell.escalamentos || []).map((e) => {
    const attrKey = attrKeyByLabel(e.atributo);
    const m = STEP_RE.exec(e.efeito || '');
    if (!m) return { attrKey, every: null, qual: e.efeito || '' };
    const before = m[1].trim();
    const after = m[3].trim();
    if (!before) return { attrKey, every: parseInt(m[2], 10), qual: after };
    const terms = before
      .split(/\s+e\s+(?=\+)/i)
      .map(parseTerm)
      .filter(Boolean);
    if (!terms.length) return { attrKey, every: parseInt(m[2], 10), qual: before };
    return { attrKey, every: parseInt(m[2], 10), terms };
  });
}

// categoria pra somar com o valor base da magia
function categoryOf(unit) {
  const u = norm(unit);
  if (/por projetil/.test(u)) return null;
  if (/\bdano\b/.test(u) && !/bloqueado/.test(u)) return 'dano';
  if (/alcance/.test(u) && !/da arma/.test(u)) return 'alcance';
  if (/\braio\b/.test(u)) return 'raio';
  if (/duracao|turno/.test(u)) return 'duracao';
  return null;
}
function baseOf(spell, cat) {
  const own = spell.base && spell.base[cat];
  if (own !== undefined && own !== null && String(own).trim() !== '') return cat === 'dano' ? String(own).replace(/\s+/g, '') : Number(own);
  const alvo = String(spell.alvo || '');
  const efeito = String(spell.efeito || '');
  if (cat === 'dano') {
    const m = /(\d+d\d+(?:\s*[+-]\s*\d+)?|\d+)\s+de\s+dano/i.exec(efeito);
    return m ? m[1].replace(/\s+/g, '') : null;
  }
  if (cat === 'alcance') {
    const m = /(?:até|a até|alcance de)\s+(\d+)\s*m/i.exec(alvo) || /(?:até|a até)\s+(\d+)\s*m/i.exec(efeito);
    return m ? parseInt(m[1], 10) : null;
  }
  if (cat === 'raio') {
    const m = /raio de\s+(\d+)\s*m/i.exec(alvo + ' ' + efeito);
    return m ? parseInt(m[1], 10) : null;
  }
  if (cat === 'duracao') {
    const m = /(\d+)\s+turnos?/i.exec(efeito + ' ' + alvo);
    return m ? parseInt(m[1], 10) : null;
  }
  return null;
}
const joinDice = (dice, flat) => {
  const parts = Object.entries(dice)
    .sort((a, b) => b[0] - a[0])
    .map(([s, n]) => `${n}d${s}`);
  if (flat) parts.push(String(flat));
  return parts.join(' + ') || '0';
};
function addBaseDamage(dice, flatRef, base) {
  // base tipo "1d6", "2d8+3", "5"
  String(base)
    .split(/(?=[+-])/)
    .forEach((p) => {
      const d = /^\+?(\d+)d(\d+)$/i.exec(p);
      if (d) dice[d[2]] = (dice[d[2]] || 0) + parseInt(d[1], 10);
      else if (/^[+-]?\d+$/.test(p)) flatRef.v += parseInt(p, 10);
    });
}

// ------------------------------------------------------------------ cálculo completo de uma magia pra um personagem
// spell.calc (magias personalizadas): [{ label, type:'valor'|'dados'|'passos', formula, sides, unit, attr, every, amount }]
export function computeSpell(spell, char, level = 1) {
  const vars = varsFor(char, level);
  const out = { dc: null, dcBonus: 0, rows: [], totals: [], errors: [] };
  const mainKey = attrKeyByLabel(spell.atributo_principal);
  const attrVal = (key) => (key && char ? attrEffective(char, key) : 0);
  const bonus = { dano: { dice: {}, flat: { v: 0 }, any: false }, alcance: 0, raio: 0, duracao: 0, has: {} };

  // 1) escalamentos do livro
  parseBookScaling(spell).forEach((sc) => {
    const v = attrVal(sc.attrKey);
    const label = sc.attrKey ? magicLearning.attributes.find((a) => a.key === sc.attrKey).label : '?';
    if (!sc.every) {
      out.rows.push({ source: 'livro', attr: label, value: v, text: sc.qual, active: true, qualitative: true });
      return;
    }
    const steps = Math.floor(v / sc.every);
    if (sc.qual !== undefined) {
      out.rows.push({ source: 'livro', attr: label, value: v, steps, every: sc.every, text: steps > 0 ? `${steps}× — ${sc.qual}` : `(a cada ${sc.every} pontos: ${sc.qual})`, active: steps > 0, qualitative: true });
      return;
    }
    const pieces = sc.terms.map((t) => {
      const cat = categoryOf(t.unit);
      if (t.kind === 'dice') {
        const total = t.n * steps;
        if (cat === 'dano' && steps) {
          bonus.dano.dice[t.sides] = (bonus.dano.dice[t.sides] || 0) + total;
          bonus.dano.any = true;
        }
        return steps ? `+${total}d${t.sides}${t.unit ? ' ' + t.unit : ''}` : null;
      }
      const total = t.n * steps;
      if (steps && cat === 'dano') {
        bonus.dano.flat.v += total;
        bonus.dano.any = true;
      } else if (steps && cat) bonus[cat] += total;
      if (cat) bonus.has[cat] = true;
      if (/dificuldade/.test(norm(t.unit)) && steps) out.dcBonus += total;
      return steps ? `+${total}${t.unit ? ' ' + t.unit : ''}` : null;
    });
    out.rows.push({
      source: 'livro',
      attr: label,
      value: v,
      steps,
      every: sc.every,
      text: pieces.filter(Boolean).join(' e ') || `nada ainda (a cada ${sc.every} pontos)`,
      active: steps > 0,
    });
  });

  // 2) fórmulas da magia personalizada
  (spell.calc || []).forEach((row) => {
    try {
      const cat = categoryOf((row.label || '') + ' ' + (row.unit || ''));
      if (row.type === 'passos') {
        const key = row.attr;
        const v = attrVal(key);
        const every = Math.max(1, parseInt(row.every, 10) || 1);
        const steps = Math.floor(v / every);
        const amount = parseFloat(row.amount) || 0;
        const total = steps * amount;
        out.rows.push({ source: 'custom', label: row.label, attr: magicLearning.attributes.find((a) => a.key === key)?.label || '?', value: v, steps, every, text: `${total >= 0 ? '+' : ''}${total} ${row.unit || ''}`.trim(), formulaText: `+${amount} a cada ${every} pontos`, active: steps > 0 });
        if (cat === 'dano') {
          bonus.dano.flat.v += total;
          bonus.dano.any = true;
        } else if (cat) {
          bonus[cat] += total;
          bonus.has[cat] = true;
        }
        if (/dificuldade/.test(norm((row.label || '') + ' ' + (row.unit || '')))) out.dcBonus += total;
      } else {
        const r = evalFormula(row.formula, vars);
        const sides = Math.max(2, parseInt(row.sides, 10) || 6);
        const text = row.type === 'dados' ? `${r.value}d${sides}${row.unit ? ' ' + row.unit : ''}` : `${r.value}${row.unit ? ' ' + row.unit : ''}`;
        out.rows.push({ source: 'custom', label: row.label, text, formulaText: `${row.formula} → ${r.text} = ${r.value}`, value: r.value, active: true });
        if (cat === 'dano') {
          if (row.type === 'dados') bonus.dano.dice[sides] = (bonus.dano.dice[sides] || 0) + r.value;
          else bonus.dano.flat.v += r.value;
          bonus.dano.any = true;
        } else if (cat && row.type !== 'dados') {
          bonus[cat] += r.value;
          bonus.has[cat] = true;
        }
        if (/dificuldade/.test(norm((row.label || '') + ' ' + (row.unit || ''))) && row.type !== 'dados') out.dcBonus += r.value;
      }
    } catch (err) {
      out.errors.push(`${row.label || 'linha'}: ${err.message}`);
    }
  });

  // 3) totais = valor base da magia + bônus dos escalamentos
  const base = (cat) => baseOf(spell, cat);
  if (bonus.dano.any) {
    const dice = { ...bonus.dano.dice };
    const flat = { v: bonus.dano.flat.v };
    const b = base('dano');
    if (b) addBaseDamage(dice, flat, b);
    out.totals.push({ label: 'Dano', text: joinDice(dice, flat.v), note: b ? `base ${b} + escalamentos` : 'escalamentos (some ao dano base da magia)' });
  } else if (base('dano') && ((spell.escalamentos && spell.escalamentos.length) || spell.custom)) {
    out.totals.push({ label: 'Dano', text: String(base('dano')), note: 'base (seus atributos ainda não somam nada)' });
  }
  [['alcance', 'Alcance', 'm'], ['raio', 'Raio', 'm'], ['duracao', 'Duração', 'turnos']].forEach(([cat, label, unit]) => {
    if (!bonus.has[cat] && !bonus[cat]) return;
    const b = base(cat);
    if (b !== null) out.totals.push({ label, text: `${b + bonus[cat]} ${unit}`, note: `base ${b} + ${bonus[cat]}` });
    else if (bonus[cat]) out.totals.push({ label, text: `+${bonus[cat]} ${unit}`, note: 'bônus (some ao valor base da magia)' });
  });

  // 4) dificuldade pra resistir
  if (mainKey && char) out.dc = spellDifficulty(char, mainKey, out.dcBonus);
  return out;
}

// valida e normaliza uma magia personalizada vinda do formulário do mestre
export function normalizeCustomSpell(raw) {
  const num = (v, d = null) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? d : Number(v));
  const calc = (raw.calc || [])
    .filter((r) => r && (r.label || r.formula || r.attr))
    .map((r) => ({
      label: String(r.label || '').slice(0, 40),
      type: ['valor', 'dados', 'passos'].includes(r.type) ? r.type : 'valor',
      formula: String(r.formula || '').slice(0, 120),
      sides: num(r.sides, 6),
      unit: String(r.unit || '').slice(0, 40),
      attr: r.attr || '',
      every: num(r.every, 10),
      amount: num(r.amount, 1),
    }));
  return {
    id: raw.id,
    nome: String(raw.nome || '').trim().slice(0, 60),
    escola: String(raw.escola || '').slice(0, 30),
    estilo: String(raw.estilo || '').slice(0, 40),
    nivel: Math.min(5, Math.max(1, num(raw.nivel, 1))),
    classificacao: String(raw.classificacao || 'Livre'),
    contexto_legal: raw.contexto_legal || null,
    descricao: String(raw.descricao || '').slice(0, 300),
    atributo_principal: String(raw.atributo_principal || ''),
    atributos_secundarios: Array.isArray(raw.atributos_secundarios) ? raw.atributos_secundarios : [],
    ativacao: String(raw.ativacao || '').slice(0, 120),
    alvo: String(raw.alvo || '').slice(0, 200),
    resistencia: String(raw.resistencia || '').slice(0, 200),
    efeito: String(raw.efeito || '').slice(0, 1200),
    custo_mp: num(raw.custo_mp, null),
    manutencao: num(raw.manutencao, null),
    custo_texto: String(raw.custo_texto || (num(raw.custo_mp, null) !== null ? raw.custo_mp + ' MP' : '')).slice(0, 120),
    sustentada: !!raw.sustentada,
    rastro: String(raw.rastro || 'Efêmero'),
    escalamentos: [],
    base: {
      dano: String((raw.base && raw.base.dano) || '').trim().slice(0, 30),
      alcance: String((raw.base && raw.base.alcance) ?? '').trim().slice(0, 10),
      raio: String((raw.base && raw.base.raio) ?? '').trim().slice(0, 10),
      duracao: String((raw.base && raw.base.duracao) ?? '').trim().slice(0, 10),
    },
    calc,
    custom: true,
  };
}
