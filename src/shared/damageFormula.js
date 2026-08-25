// Avaliador de fórmula de dano -- transforma um texto como "2 + FOR/2"
// ou "DMFlecha + FOR/2" num número final, puxando os status da ficha
// do personagem e o dano de munição vinculada. Usado tanto no
// inventário pessoal (character.js) quanto no painel de combate do
// mestre (combat.js), por isso fica compartilhado aqui.
//
// Siglas de status reconhecidas (case-insensitive, "palavra inteira"
// pra não confundir com nome de item): FOR, VIT, AGI, DES, INT, EST, OBS.
export const STATUS_ABBREV_MAP = {
  FOR: 'forca',
  VIT: 'vitalidade',
  AGI: 'agilidade',
  DES: 'destreza',
  INT: 'inteligencia',
  EST: 'estamina',
  OBS: 'observacao',
};

// avaliador aritmético simples e seguro (sem eval/Function) -- só
// aceita dígitos, ponto decimal, + - * / % e parênteses depois da
// substituição de variáveis.
function evalArithmetic(raw) {
  const s = raw.replace(/\s+/g, '');
  if (!s) throw new Error('fórmula vazia');
  let i = 0;
  function peek() {
    return s[i];
  }
  function parseExpr() {
    let v = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = s[i++];
      const rhs = parseTerm();
      v = op === '+' ? v + rhs : v - rhs;
    }
    return v;
  }
  function parseTerm() {
    let v = parseFactor();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = s[i++];
      const rhs = parseFactor();
      if (op === '*') v *= rhs;
      else if (op === '/') v /= rhs;
      else v %= rhs;
    }
    return v;
  }
  function parseFactor() {
    if (peek() === '+') {
      i++;
      return parseFactor();
    }
    if (peek() === '-') {
      i++;
      return -parseFactor();
    }
    if (peek() === '(') {
      i++;
      const v = parseExpr();
      if (peek() !== ')') throw new Error('parêntese não fechado');
      i++;
      return v;
    }
    const start = i;
    while (i < s.length && /[0-9.]/.test(s[i])) i++;
    if (start === i) throw new Error('token inesperado em "' + s.slice(i, i + 6) + '"');
    return parseFloat(s.slice(start, i));
  }
  const result = parseExpr();
  if (i !== s.length) throw new Error('sobrou texto: "' + s.slice(i) + '"');
  if (!isFinite(result)) throw new Error('resultado inválido');
  return result;
}

// statusValues: { vitalidade, forca, agilidade, destreza, inteligencia, estamina, observacao }
// resolveAmmoDamage(name): number|null -- dano já calculado da munição cujo nome bate com `name`
// (normalizado, sem espaço/acento) -- usado pros tokens "DM<Nome>".
// Retorna null se não der pra calcular (fórmula vazia, variável
// faltando, sintaxe inválida) -- quem chama decide o que mostrar nesse caso.
export function evaluateDamageFormula(formula, statusValues, resolveAmmoDamage) {
  if (!formula || typeof formula !== 'string') return null;
  let expr = formula;

  expr = expr.replace(/DM([A-Za-zÀ-ÖØ-öø-ÿ]+)/gi, (match, name) => {
    const val = resolveAmmoDamage ? resolveAmmoDamage(name) : null;
    return val === null || val === undefined ? match : String(val);
  });

  expr = expr.replace(/\b(FOR|VIT|AGI|DES|INT|EST|OBS)\b/gi, (match) => {
    const key = STATUS_ABBREV_MAP[match.toUpperCase()];
    const val = statusValues ? statusValues[key] : undefined;
    return typeof val === 'number' ? String(val) : match;
  });

  try {
    return Math.round(evalArithmetic(expr));
  } catch (e) {
    return null;
  }
}

// normaliza um nome de item pra comparar com o token "DM<Nome>" --
// tira espaço/acento/case, então "Flecha de Fogo" vira "flechadefogo"
// e bate com "DMFlechaDeFogo" ou "DMflechadefogo" etc.
export function normalizeItemName(name) {
  return (name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
