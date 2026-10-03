// Easter egg — Farkle (o jogo de dados "arrisca ou guarda") em canvas puro,
// sem lib externa, no formato solo: 10 rodadas, vale o total de pontos.
// Casa com o resto do site (RPG de mesa): é dado de verdade, só que com
// gosto de cassino.
//
// Regras: cada turno você rola 6 dados, SEPARA pelo menos um dado que
// pontue e escolhe entre ROLAR de novo os que sobraram (arriscando tudo o
// que acumulou no turno) ou GUARDAR os pontos do turno. Rolou e nenhum
// dado pontua = FARKLE: o turno inteiro se perde. Separou os 6 dados
// pontuando = DADOS QUENTES: rola os 6 de novo e o turno continua. Três
// farkles seguidos custam 500 pontos.
//
// Pontuação: 1 vale 100, 5 vale 50; trinca de X vale X×100 (trinca de 1 vale
// 1000) e cada dado a mais da mesma face DOBRA (4 iguais = 2×, 5 = 4×,
// 6 = 8×); sequência 1-2-3-4-5-6 = 1500; três pares = 1500; duas trincas
// = 2500. A seleção só é válida se TODOS os dados escolhidos contribuem
// (nada de dado "de carona"); o jogo mostra a pontuação da seleção ao vivo.
//
// Entradas: clique/toque nos dados (alterna a seleção) e nos botões da
// tela; teclado: 1-6 alterna o dado daquela posição, A seleciona tudo que
// pontua, R/espaço rola, B/Enter guarda.
//
// O visual muda com o tema ativo (ver `styleOf`): os dois temas especiais
// ganham pintura própria (mesa de cassino de veludo com borda de ouro /
// mesa de taverna de madeira clara), os demais ficam no clássico com as
// cores do tema.
import { readThemeColors } from './theme.js';
import { sfx } from './sound.js';

const ROUNDS = 10;
const DICE = 6;
const ROLL_MS = 650;
const FARKLE_PENALTY = 500;
const FARKLES_FOR_PENALTY = 3;
const NEXT_TURN_DELAY_MS = 1300;
const END_DELAY_MS = 1500;

// ---------- pontuação (pura, exportada pros testes) ----------
function counts(vals) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  vals.forEach((v) => {
    c[v] += 1;
  });
  return c;
}
function tripleBase(face) {
  return face === 1 ? 1000 : face * 100;
}
// pontua um conjunto de dados. valid = TODOS os dados contribuem.
export function scoreSelection(vals) {
  const n = vals.length;
  if (n === 0) return { score: 0, used: 0, valid: false };
  const c = counts(vals);
  const options = [];
  // combinações de 6 dados
  if (n === 6) {
    const faces = c.slice(1).filter((x) => x > 0);
    if (faces.length === 6) options.push({ score: 1500, used: 6 }); // sequência
    const pairs = c.slice(1).reduce((s, x) => s + Math.floor(x / 2), 0);
    if (pairs === 3) options.push({ score: 1500, used: 6 }); // três pares (inclui quadra + par)
    if (faces.length === 2 && faces[0] === 3 && faces[1] === 3) options.push({ score: 2500, used: 6 }); // duas trincas
  }
  // pontuação "normal": trincas+ e 1/5 soltos
  let normal = 0;
  let used = 0;
  for (let f = 1; f <= 6; f++) {
    if (c[f] >= 3) {
      normal += tripleBase(f) * 2 ** (c[f] - 3);
      used += c[f];
    } else if (f === 1) {
      normal += 100 * c[f];
      used += c[f];
    } else if (f === 5) {
      normal += 50 * c[f];
      used += c[f];
    }
  }
  options.push({ score: normal, used });
  const full = options.filter((o) => o.used === n).sort((a, b) => b.score - a.score)[0];
  if (full) return { score: full.score, used: n, valid: true };
  const best = options.sort((a, b) => b.used - a.used || b.score - a.score)[0];
  return { score: best.score, used: best.used, valid: false };
}
// algum subconjunto desses dados pontua? (senão é farkle)
export function hasScoring(vals) {
  const c = counts(vals);
  if (c[1] > 0 || c[5] > 0) return true;
  if (c.some((x, f) => f > 0 && x >= 3)) return true;
  if (vals.length === 6) {
    if (c.slice(1).every((x) => x === 1)) return true;
    if (c.slice(1).reduce((s, x) => s + Math.floor(x / 2), 0) === 3) return true;
  }
  return false;
}
// índices dos dados que "valem alguma coisa" (pra seleção automática)
export function scoringIndices(vals) {
  const c = counts(vals);
  if (vals.length === 6) {
    const s = scoreSelection(vals);
    if (s.valid) return vals.map((_, i) => i); // os 6 pontuam juntos (sequência/pares/trincas)
  }
  const out = [];
  vals.forEach((v, i) => {
    if (v === 1 || v === 5 || c[v] >= 3) out.push(i);
  });
  return out;
}

function styleOf() {
  const id = document.documentElement.getAttribute('data-theme');
  if (id === 'farkle-cassino') return 'cassino';
  if (id === 'farkle-taverna') return 'taverna';
  return 'classic';
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function rollDie() {
  return 1 + Math.floor(Math.random() * 6);
}
// pips de cada face em coordenadas -1..1
const PIPS = {
  1: [[0, 0]],
  2: [[-0.5, -0.5], [0.5, 0.5]],
  3: [[-0.5, -0.5], [0, 0], [0.5, 0.5]],
  4: [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]],
  5: [[-0.5, -0.5], [0.5, -0.5], [0, 0], [-0.5, 0.5], [0.5, 0.5]],
  6: [[-0.5, -0.55], [0.5, -0.55], [-0.5, 0], [0.5, 0], [-0.5, 0.55], [0.5, 0.55]],
};

export function createFarkleGame(canvas, { onScoreChange, onGameOver }) {
  const ctx = canvas.getContext('2d');
  canvas.style.touchAction = 'none';
  const W = canvas.width;
  const H = canvas.height;

  const FREE_SIZE = 46;
  const KEPT_SIZE = 32;
  const FREE_Y = 138;
  const KEPT_Y = 232;
  const BTN_Y = 332;
  const BTN_H = 38;

  let dice; // { v, kept, sel, x, y, tx, ty, spin, show }
  let round, total, turnScore, farkles, phase; // 'ready' | 'rolling' | 'pick' | 'farkle' | 'bank' | 'over'
  let rollEndsAt = 0;
  let rollTimer = 0;
  let bestTurn = 0;
  let flashText = '';
  let flashUntil = 0;
  let flashColor = null;
  let raf = null;
  let running = false;
  let colors = readThemeColors();
  let style = styleOf();
  let timers = [];
  let listeners = [];
  let particles = [];
  let shakeUntil = 0;

  function later(fn, ms) {
    timers.push(setTimeout(fn, ms));
  }
  function stopTimers() {
    timers.forEach((t) => clearTimeout(t));
    timers = [];
  }

  // ---------- estado ----------
  function slotPos(i) {
    const total6 = DICE * FREE_SIZE + (DICE - 1) * 6;
    return { x: (W - total6) / 2 + i * (FREE_SIZE + 6) + FREE_SIZE / 2, y: FREE_Y };
  }
  function keptPos(n) {
    const total = DICE * KEPT_SIZE + (DICE - 1) * 6;
    return { x: (W - total) / 2 + n * (KEPT_SIZE + 6) + KEPT_SIZE / 2, y: KEPT_Y };
  }
  function resetDice() {
    dice = [];
    for (let i = 0; i < DICE; i++) {
      const p = slotPos(i);
      dice.push({ v: 1, kept: false, sel: false, x: p.x, y: p.y, tx: p.x, ty: p.y, spin: 0, show: 1 });
    }
  }
  function newTurn() {
    resetDice();
    turnScore = 0;
    phase = 'ready';
  }
  function reset() {
    round = 1;
    total = 0;
    farkles = 0;
    bestTurn = 0;
    particles = [];
    shakeUntil = 0;
    flashText = '';
    flashUntil = 0;
    stopTimers();
    newTurn();
  }
  const freeDice = () => dice.filter((d) => !d.kept);
  const selDice = () => dice.filter((d) => !d.kept && d.sel);
  function selection() {
    const vals = selDice().map((d) => d.v);
    return vals.length ? scoreSelection(vals) : { score: 0, used: 0, valid: false };
  }

  function addTotal(p) {
    total = Math.max(0, total + p);
    onScoreChange && onScoreChange(total);
  }
  function flash(text, ms = 1300, color = null) {
    flashText = text;
    flashUntil = Date.now() + ms;
    flashColor = color;
  }
  function sparkle(x, y, color, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 30 + Math.random() * 90;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30, life: 1, color });
    }
    if (particles.length > 90) particles.splice(0, particles.length - 90);
  }

  // ---------- jogadas ----------
  function startRoll() {
    // rola só os dados livres; sorteia o resultado agora, mostra depois da animação
    const free = freeDice();
    free.forEach((d) => {
      d.v = rollDie();
      d.sel = false;
    });
    free.forEach((d) => {
      d.spin = Math.random() * 6; // só enfeite da animação (separado dos sorteios dos valores)
    });
    phase = 'rolling';
    rollEndsAt = Date.now() + ROLL_MS;
    sfx.diceRoll();
  }
  function finishRoll() {
    const vals = freeDice().map((d) => d.v);
    if (!hasScoring(vals)) {
      // FARKLE
      phase = 'farkle';
      farkles += 1;
      const lost = turnScore;
      turnScore = 0;
      sfx.farkle();
      shakeUntil = Date.now() + 450;
      let msg = lost > 0 ? `FARKLE! perdeu ${lost}` : 'FARKLE!';
      if (farkles >= FARKLES_FOR_PENALTY) {
        addTotal(-FARKLE_PENALTY);
        farkles = 0;
        msg = `3 FARKLES SEGUIDOS! −${FARKLE_PENALTY}`;
      }
      flash(msg, NEXT_TURN_DELAY_MS, colors.danger);
      later(() => endTurn(), NEXT_TURN_DELAY_MS);
      return;
    }
    phase = 'pick';
  }
  function endTurn() {
    if (!running) return;
    if (round >= ROUNDS) {
      phase = 'over';
      flash(`FIM! total ${total}`, END_DELAY_MS, colors.warn);
      later(() => {
        if (!running) return;
        stop();
        sfx.gameOver();
        onGameOver && onGameOver(total);
      }, END_DELAY_MS);
      return;
    }
    round += 1;
    newTurn();
  }

  function toggleDie(i) {
    if (phase !== 'pick') return;
    const d = dice[i];
    if (d.kept) return;
    d.sel = !d.sel;
    sfx.select();
  }

  function keepSelected() {
    const sel = selection();
    selDice().forEach((d) => {
      d.kept = true;
      d.sel = false;
    });
    turnScore += sel.score;
    // reposiciona os guardados na linha de baixo
    let n = 0;
    dice.forEach((d) => {
      if (d.kept) {
        const p = keptPos(n++);
        d.tx = p.x;
        d.ty = p.y;
      }
    });
    return sel;
  }

  function rollAction() {
    if (phase === 'ready') {
      startRoll();
      return;
    }
    if (phase !== 'pick') return;
    const sel = selection();
    if (!sel.valid) {
      flash('selecione dados que pontuam', 900, colors.warn);
      sfx.select();
      return;
    }
    keepSelected();
    if (dice.every((d) => d.kept)) {
      // DADOS QUENTES: os 6 pontuaram -- libera todos pra rolar de novo
      flash('DADOS QUENTES! 🔥', 1100, colors.warn);
      sfx.hotDice();
      sparkle(W / 2, FREE_Y, colors.warn, 26);
      dice.forEach((d, i) => {
        const p = slotPos(i);
        d.kept = false;
        d.x = d.tx = p.x;
        d.y = d.ty = p.y;
      });
    }
    startRoll();
  }

  function bankAction() {
    if (phase !== 'pick') return;
    const sel = selection();
    if (!sel.valid) {
      flash('selecione dados que pontuam', 900, colors.warn);
      return;
    }
    keepSelected();
    const gained = turnScore;
    bestTurn = Math.max(bestTurn, gained);
    addTotal(gained);
    farkles = 0;
    phase = 'bank';
    sfx.bank();
    sparkle(W / 2, KEPT_Y, colors.accent, 22);
    flash(`+${gained} guardados`, NEXT_TURN_DELAY_MS - 300, colors.accent);
    later(() => endTurn(), NEXT_TURN_DELAY_MS - 300);
  }

  function autoSelect() {
    if (phase !== 'pick') return;
    const free = dice.map((d, i) => ({ d, i })).filter((x) => !x.d.kept);
    const idx = scoringIndices(free.map((x) => x.d.v));
    free.forEach((x, k) => {
      x.d.sel = idx.includes(k);
    });
    sfx.select();
  }

  // ---------- desenho ----------
  function lightBg() {
    ctx.fillStyle = colors.bg;
    const c = String(ctx.fillStyle);
    if (c[0] !== '#' || c.length < 7) return false;
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 150;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function dieColors() {
    if (style === 'cassino') return { body: '#f6efe0', edge: '#d4a937', pip: '#161212', one: '#b3122a', shadow: 'rgba(0,0,0,0.5)' };
    if (style === 'taverna') return { body: '#f3e9d0', edge: '#8a6a3c', pip: '#33261a', one: '#b33a1a', shadow: 'rgba(60,40,20,0.35)' };
    const light = lightBg();
    return { body: light ? '#fffdf6' : '#eae6dc', edge: colors.line, pip: '#1c1c1c', one: colors.danger, shadow: 'rgba(0,0,0,0.4)' };
  }

  function drawDie(x, y, size, v, opts = {}) {
    const dc = dieColors();
    const { sel = false, dim = false, rot = 0, lift = 0 } = opts;
    ctx.save();
    ctx.translate(x, y - lift);
    ctx.rotate(rot);
    // sombra
    ctx.fillStyle = dc.shadow;
    ctx.beginPath();
    ctx.ellipse(0, size / 2 + 3 + lift * 0.4, size * 0.42, size * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    if (dim) ctx.globalAlpha = 0.55;
    if (sel) {
      ctx.shadowColor = style === 'cassino' ? '#ffd45a' : colors.accent;
      ctx.shadowBlur = 16;
    }
    const r = size * 0.2;
    ctx.fillStyle = dc.body;
    roundRect(-size / 2, -size / 2, size, size, r);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = sel ? (style === 'cassino' ? '#ffd45a' : colors.accent) : dc.edge;
    ctx.lineWidth = sel ? 3 : style === 'cassino' ? 2 : 1.5;
    roundRect(-size / 2, -size / 2, size, size, r);
    ctx.stroke();
    // brilho
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    roundRect(-size / 2 + 3, -size / 2 + 3, size - 6, size * 0.28, r * 0.6);
    ctx.fill();
    // pips
    const pr = size * 0.085;
    ctx.fillStyle = v === 1 ? dc.one : dc.pip;
    (PIPS[v] || PIPS[1]).forEach(([px, py]) => {
      ctx.beginPath();
      ctx.arc(px * size * 0.5 * 0.9, py * size * 0.5 * 0.9, v === 1 ? pr * 1.5 : pr, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawTable() {
    if (style === 'cassino') {
      ctx.fillStyle = '#12060a';
      ctx.fillRect(0, 0, W, H);
      // feltro de veludo com foco de luz
      const g = ctx.createRadialGradient(W / 2, 170, 20, W / 2, 170, 280);
      g.addColorStop(0, '#5a0f24');
      g.addColorStop(1, '#1c0810');
      ctx.fillStyle = g;
      ctx.fillRect(8, 56, W - 16, 262);
      ctx.strokeStyle = '#d4a937';
      ctx.lineWidth = 3;
      roundRect(8, 56, W - 16, 262, 14);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(212,169,55,0.4)';
      ctx.lineWidth = 1;
      roundRect(14, 62, W - 28, 250, 10);
      ctx.stroke();
      // naipes bem sutis no feltro
      ctx.fillStyle = 'rgba(212,169,55,0.08)';
      ctx.font = '40px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ['♠', '♥', '♣', '♦'].forEach((s, i) => ctx.fillText(s, 52 + i * 86, 288));
      return;
    }
    if (style === 'taverna') {
      ctx.fillStyle = '#e9d6ac';
      ctx.fillRect(0, 0, W, H);
      // veios da madeira
      ctx.strokeStyle = 'rgba(120,80,40,0.16)';
      ctx.lineWidth = 1;
      for (let y = 8; y < H; y += 14) {
        ctx.beginPath();
        ctx.moveTo(0, y + Math.sin(y) * 2);
        for (let x = 0; x <= W; x += 30) ctx.lineTo(x, y + Math.sin(y * 0.7 + x * 0.04) * 2.5);
        ctx.stroke();
      }
      // couro no centro da mesa
      ctx.fillStyle = '#7a4a2a';
      roundRect(8, 56, W - 16, 262, 12);
      ctx.fill();
      ctx.strokeStyle = '#4a2a14';
      ctx.lineWidth = 3;
      roundRect(8, 56, W - 16, 262, 12);
      ctx.stroke();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(240,210,160,0.55)';
      ctx.lineWidth = 1.2;
      roundRect(15, 63, W - 30, 248, 8);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = colors.panel;
    roundRect(8, 56, W - 16, 262, 12);
    ctx.fill();
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 2;
    roundRect(8, 56, W - 16, 262, 12);
    ctx.stroke();
  }

  function drawButton(x, y, w, h, label, enabled, primary) {
    const accent = style === 'cassino' ? '#d4a937' : colors.accent;
    const warn = style === 'cassino' ? '#f3d27a' : colors.warn;
    const fill = primary ? accent : warn;
    ctx.save();
    ctx.globalAlpha = enabled ? 1 : 0.35;
    ctx.fillStyle = fill;
    roundRect(x, y, w, h, 9);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    roundRect(x + 2, y + 2, w - 4, h * 0.4, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    roundRect(x, y, w, h, 9);
    ctx.stroke();
    // texto escuro em botão claro, claro em botão escuro (o destaque do tema pode ser qualquer um dos dois)
    ctx.fillStyle = fill;
    const fc = String(ctx.fillStyle);
    const dark = fc[0] === '#' && fc.length >= 7 && (parseInt(fc.slice(1, 3), 16) * 299 + parseInt(fc.slice(3, 5), 16) * 587 + parseInt(fc.slice(5, 7), 16) * 114) / 1000 < 130;
    ctx.fillStyle = dark ? '#ffffff' : '#111';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    ctx.restore();
  }

  const BTN_ROLL = { x: 28, w: 150 };
  const BTN_BANK = { x: 182, w: 150 };
  const BTN_AUTO = { x: W / 2 - 62, y: 260, w: 124, h: 24 };

  function drawHud(now) {
    ctx.textBaseline = 'middle';
    const ink = style === 'cassino' ? '#f3d27a' : style === 'taverna' ? '#3a2614' : colors.ink;
    ctx.fillStyle = ink;
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`RODADA ${round}/${ROUNDS}`, 14, 20);
    ctx.textAlign = 'right';
    ctx.fillText(`TOTAL ${total}`, W - 14, 20);
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = style === 'cassino' ? '#d9c28a' : style === 'taverna' ? '#5a4128' : colors.inkDim;
    const turnTxt = phase === 'ready' ? 'role os dados pra começar o turno' : `no turno: ${turnScore}${farkles ? `  ·  farkles seguidos: ${farkles}/3` : ''}`;
    ctx.fillText(turnTxt, W / 2, 42);
    // linha dos guardados
    ctx.fillStyle = style === 'cassino' ? 'rgba(243,210,122,0.7)' : style === 'taverna' ? 'rgba(240,222,190,0.8)' : colors.inkDim;
    ctx.font = '10px monospace';
    ctx.fillText(dice.some((d) => d.kept) ? 'guardados neste turno' : '', W / 2, KEPT_Y - 26);
    // pontuação da seleção ao vivo
    if (phase === 'pick') {
      const sel = selection();
      let txt = 'toque nos dados que pontuam';
      let col = style === 'taverna' ? '#f3e3c3' : ink;
      if (selDice().length) {
        if (sel.valid) {
          txt = `seleção vale ${sel.score}  ·  turno ficaria em ${turnScore + sel.score}`;
          col = style === 'cassino' ? '#9dffb4' : style === 'taverna' ? '#d8ffc8' : colors.accent;
        } else {
          txt = 'seleção inválida: todos têm que pontuar';
          col = style === 'taverna' ? '#ffd0c0' : colors.danger;
        }
      }
      ctx.fillStyle = col;
      ctx.font = '10.5px monospace';
      ctx.fillText(txt, W / 2, 302);
    }
    // botões
    const canAct = phase === 'pick' && selection().valid;
    drawButton(BTN_ROLL.x, BTN_Y, BTN_ROLL.w, BTN_H, phase === 'ready' ? 'ROLAR 6' : `ROLAR ${freeDice().length - selDice().length || 6}`, phase === 'ready' || canAct, true);
    drawButton(BTN_BANK.x, BTN_Y, BTN_BANK.w, BTN_H, 'GUARDAR', canAct, false);
    // auto
    if (phase === 'pick') {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      roundRect(BTN_AUTO.x, BTN_AUTO.y, BTN_AUTO.w, BTN_AUTO.h, 7);
      ctx.fill();
      ctx.strokeStyle = style === 'cassino' ? '#d4a937' : style === 'taverna' ? '#f0d9a8' : colors.line;
      ctx.lineWidth = 1;
      roundRect(BTN_AUTO.x, BTN_AUTO.y, BTN_AUTO.w, BTN_AUTO.h, 7);
      ctx.stroke();
      ctx.fillStyle = style === 'cassino' ? '#f3d27a' : '#f4ecd8';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('✓ selecionar tudo (A)', BTN_AUTO.x + BTN_AUTO.w / 2, BTN_AUTO.y + BTN_AUTO.h / 2 + 1);
      ctx.restore();
    }
    ctx.fillStyle = style === 'taverna' ? '#5a4128' : colors.inkDim;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('1 = 100 · 5 = 50 · trinca X×100 (de 1 = 1000)', W / 2, 391);
    ctx.fillText('sequência/3 pares 1500 · 3 farkles seguidos = −500', W / 2, 406);
    void now;
  }

  function draw() {
    colors = readThemeColors();
    style = styleOf();
    const now = Date.now();
    ctx.save();
    if (shakeUntil > now) {
      const k = (shakeUntil - now) / 450;
      ctx.translate((Math.random() - 0.5) * 8 * k, (Math.random() - 0.5) * 6 * k);
    }
    drawTable();
    const rolling = phase === 'rolling';
    dice.forEach((d, i) => {
      if (d.kept) {
        drawDie(d.x, d.y, KEPT_SIZE, d.v, { dim: true });
        return;
      }
      const isReady = phase === 'ready';
      let shown = d.v;
      let rot = 0;
      let lift = d.sel ? 10 : 0;
      let x = d.x;
      let y = d.y;
      if (rolling) {
        const left = clamp((rollEndsAt - now) / ROLL_MS, 0, 1);
        shown = 1 + (Math.floor(now / 70 + i * 3) % 6);
        rot = Math.sin(now / 60 + i) * 0.5 * left + d.spin * left * 0.4;
        x += Math.sin(now / 40 + i * 2) * 5 * left;
        y -= Math.abs(Math.sin(now / 90 + i)) * 22 * left;
      }
      if (phase === 'farkle') rot = Math.sin(now / 50 + i) * 0.08;
      drawDie(x, y, FREE_SIZE, isReady ? 6 : shown, { sel: d.sel, rot, lift, dim: isReady });
    });
    // partículas
    particles.forEach((p) => {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    });
    ctx.globalAlpha = 1;
    ctx.restore();
    drawHud(now);
    if (flashUntil > now) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(0, 86, W, 32);
      ctx.fillStyle = flashColor || colors.warn;
      ctx.font = 'bold 15px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(flashText, W / 2, 102);
    }
  }

  // ---------- laço ----------
  let lastTs = null;
  function tick(ts) {
    if (!running) return;
    const dt = lastTs === null ? 0.016 : Math.min((ts - lastTs) / 1000, 0.08);
    lastTs = ts;
    // dados guardados deslizam até a linha de baixo
    dice.forEach((d) => {
      d.x += (d.tx - d.x) * Math.min(1, dt * 14);
      d.y += (d.ty - d.y) * Math.min(1, dt * 14);
    });
    particles.forEach((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 180 * dt;
      p.life -= dt * 1.4;
    });
    particles = particles.filter((p) => p.life > 0);
    if (phase === 'rolling' && Date.now() >= rollEndsAt) finishRoll();
    draw();
    raf = requestAnimationFrame(tick);
  }

  // ---------- entrada ----------
  function pointAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return null;
    return { x: ((clientX - rect.left) * W) / rect.width, y: ((clientY - rect.top) * H) / rect.height };
  }
  function onPointerDown(e) {
    const p = pointAt(e.clientX, e.clientY);
    if (!p) return;
    // botões
    if (p.y >= BTN_Y && p.y <= BTN_Y + BTN_H) {
      if (p.x >= BTN_ROLL.x && p.x <= BTN_ROLL.x + BTN_ROLL.w) rollAction();
      else if (p.x >= BTN_BANK.x && p.x <= BTN_BANK.x + BTN_BANK.w) bankAction();
      return;
    }
    if (phase === 'pick' && p.x >= BTN_AUTO.x && p.x <= BTN_AUTO.x + BTN_AUTO.w && p.y >= BTN_AUTO.y && p.y <= BTN_AUTO.y + BTN_AUTO.h) {
      autoSelect();
      return;
    }
    // dados livres
    for (let i = 0; i < DICE; i++) {
      const d = dice[i];
      if (d.kept) continue;
      const pos = slotPos(i);
      if (Math.abs(p.x - pos.x) <= FREE_SIZE / 2 + 3 && Math.abs(p.y - (pos.y - (d.sel ? 10 : 0))) <= FREE_SIZE / 2 + 3) {
        toggleDie(i);
        return;
      }
    }
    // toque no centro da mesa antes de rolar = rola
    if (phase === 'ready' && p.y > 56 && p.y < 318) rollAction();
  }

  function handleKey(e) {
    const k = e.key;
    if (k >= '1' && k <= '6') {
      e.preventDefault();
      toggleDie(Number(k) - 1);
    } else if (k === 'a' || k === 'A') {
      e.preventDefault();
      autoSelect();
    } else if (k === 'r' || k === 'R' || k === ' ') {
      e.preventDefault();
      rollAction();
    } else if (k === 'b' || k === 'B' || k === 'Enter') {
      e.preventDefault();
      bankAction();
    }
  }

  function start() {
    stopTimers();
    reset();
    draw();
    onScoreChange && onScoreChange(total);
    running = true;
    lastTs = null;
    canvas.addEventListener('pointerdown', onPointerDown);
    listeners.push(['pointerdown', onPointerDown]);
    raf = requestAnimationFrame(tick);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    stopTimers();
    listeners.forEach(([t, fn]) => canvas.removeEventListener(t, fn));
    listeners = [];
  }

  return { start, stop, handleKey, get running() { return running; } };
}
