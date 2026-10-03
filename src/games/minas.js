// Easter egg — Campo Minado em canvas puro, sem lib externa, no formato
// "sobrevivência": cada campo limpo abre o próximo, maior e mais minado, e
// UMA mina põe fim à partida. Pontos = 5 por casa segura aberta + bônus de
// fase (200 × fase) + bônus de tempo (quanto mais rápido, mais). O recorde
// é o placar total da sequência.
//
// Regras clássicas: o 1º clique NUNCA é mina (nem as casas em volta, quando
// o campo tem espaço pra isso -- o campo abre numa clareira); casa vazia
// (0) abre as vizinhas em cascata; clicar num número já aberto com bandeiras
// suficientes em volta ("acorde") abre as vizinhas que faltam -- se uma
// bandeira estiver errada, explode.
//
// Entradas: mouse (clique abre, botão direito marca), toque (toque abre,
// SEGURAR marca; ou o botão 🚩 no canto liga o modo bandeira), teclado
// (setas movem o cursor, espaço/Enter abre, F/X marca). O contextmenu e os
// ponteiros são ligados no próprio canvas dentro do start() e desligados no
// stop() -- o overlay (easterEggGames.js) só liga click/pointer genéricos.
//
// O visual muda com o tema ativo (ver `styleOf`): os dois temas especiais
// ganham pintura própria (placas de aço com faixa de perigo / janelinha
// cinza do Windows 95 com contadores de LED e carinha), os demais ficam no
// clássico com as cores do tema.
import { readThemeColors } from './theme.js';
import { sfx } from './sound.js';

const LEVELS = [
  { c: 9, r: 9, m: 10 },
  { c: 11, r: 11, m: 19 },
  { c: 13, r: 13, m: 31 },
  { c: 15, r: 15, m: 46 },
];
const HEAD_H = 46;
const CELL_SCORE = 5;
const LEVEL_BONUS = 200;
const TIME_BONUS_PER_SEC = 5;
const LONG_PRESS_MS = 380;
const NEXT_LEVEL_DELAY_MS = 1500;
const GAME_OVER_DELAY_MS = 1700;

const NUM_LIGHT = ['', '#0000ff', '#007a00', '#e00000', '#000080', '#800000', '#008080', '#000000', '#707070'];
const NUM_DARK = ['', '#6fb3ff', '#6fe08a', '#ff7a7a', '#a79bff', '#ff9d6b', '#4fe3d1', '#f0f0f0', '#a9a9a9'];

export function levelSpec(level) {
  if (level <= LEVELS.length) return LEVELS[level - 1];
  // depois do último: mesmo tamanho, mais minas (teto de ~31% do campo)
  const last = LEVELS[LEVELS.length - 1];
  return { c: last.c, r: last.r, m: Math.min(Math.round(last.c * last.r * 0.31), last.m + (level - LEVELS.length) * 4) };
}
function styleOf() {
  const id = document.documentElement.getAttribute('data-theme');
  if (id === 'minas-perigo') return 'perigo';
  if (id === 'minas-janela') return 'janela';
  return 'classic';
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function createMinasGame(canvas, { onScoreChange, onGameOver }) {
  const ctx = canvas.getContext('2d');
  canvas.style.touchAction = 'none';
  const W = canvas.width;
  const H = canvas.height;

  let level, cols, rows, mines, cells, cell, ox, oy;
  let score, flagsLeft, revealedCount, firstClick, startedAt, elapsedMs;
  let state; // 'play' | 'won' | 'lost' | 'over'
  let cursor; // { c, r } | null -- do teclado
  let flagMode = false;
  let raf = null;
  let running = false;
  let colors = readThemeColors();
  let style = styleOf();
  let pops = []; // animações de casa abrindo { i, t }
  let boom = []; // minas explodindo em sequência { i, at }
  let explodedIdx = -1;
  let flashText = '';
  let flashUntil = 0;
  let timers = [];
  let press = null; // { pointerId, c, r, t, long }
  let shakeUntil = 0;
  let listeners = [];

  const idx = (c, r) => r * cols + c;
  function later(fn, ms) {
    const id = setTimeout(fn, ms);
    timers.push(id);
  }
  function neighbors(c, r) {
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dc && !dr) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc >= 0 && nr >= 0 && nc < cols && nr < rows) out.push([nc, nr]);
      }
    }
    return out;
  }

  // ---------- campo ----------
  function newBoard(lv) {
    level = lv;
    const spec = levelSpec(lv);
    cols = spec.c;
    rows = spec.r;
    mines = spec.m;
    cells = [];
    for (let i = 0; i < cols * rows; i++) cells.push({ mine: false, adj: 0, revealed: false, flagged: false });
    cell = Math.min(Math.floor((W - 16) / cols), Math.floor((H - HEAD_H - 40) / rows));
    ox = Math.floor((W - cell * cols) / 2);
    oy = HEAD_H + 8 + Math.floor((H - HEAD_H - 40 - cell * rows) / 2);
    flagsLeft = mines;
    revealedCount = 0;
    firstClick = true;
    startedAt = 0;
    elapsedMs = 0;
    state = 'play';
    pops = [];
    boom = [];
    explodedIdx = -1;
    cursor = cursor || null;
    flash(`FASE ${lv} — ${mines} minas`, 1600);
  }

  // minas sorteadas DEPOIS do 1º clique, longe dele
  function placeMines(safeC, safeR) {
    const total = cols * rows;
    const banned = new Set([idx(safeC, safeR)]);
    // clareira: tira também as vizinhas se sobrar espaço pra todas as minas
    if (total - 9 >= mines) neighbors(safeC, safeR).forEach(([c, r]) => banned.add(idx(c, r)));
    const pool = [];
    for (let i = 0; i < total; i++) if (!banned.has(i)) pool.push(i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    pool.slice(0, mines).forEach((i) => {
      cells[i].mine = true;
    });
    computeAdj();
  }
  function computeAdj() {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells[idx(c, r)].adj = neighbors(c, r).filter(([nc, nr]) => cells[idx(nc, nr)].mine).length;
      }
    }
  }

  function addScore(points) {
    score += points;
    onScoreChange && onScoreChange(score);
  }
  function flash(text, ms = 1300) {
    flashText = text;
    flashUntil = Date.now() + ms;
  }

  // ---------- jogadas ----------
  function revealCell(c, r) {
    const start = cells[idx(c, r)];
    if (start.revealed || start.flagged) return;
    const queue = [[c, r]];
    let opened = 0;
    while (queue.length) {
      const [cc, rr] = queue.pop();
      const cl = cells[idx(cc, rr)];
      if (cl.revealed || cl.flagged) continue;
      cl.revealed = true;
      revealedCount += 1;
      opened += 1;
      pops.push({ i: idx(cc, rr), t: Date.now() });
      if (cl.adj === 0 && !cl.mine) neighbors(cc, rr).forEach(([nc, nr]) => queue.push([nc, nr]));
    }
    if (opened) {
      addScore(opened * CELL_SCORE);
      sfx.reveal(opened);
    }
  }

  function winLevelIfDone() {
    if (state !== 'play') return;
    if (revealedCount < cols * rows - mines) return;
    state = 'won';
    const par = Math.round(cols * rows * 0.75); // segundos "de referência"
    const secs = Math.floor(elapsedMs / 1000);
    const timeBonus = Math.max(0, par - secs) * TIME_BONUS_PER_SEC;
    const bonus = LEVEL_BONUS * level + timeBonus;
    addScore(bonus);
    // as minas que sobraram ganham bandeira (comemoração)
    cells.forEach((cl) => {
      if (cl.mine) cl.flagged = true;
    });
    flagsLeft = 0;
    sfx.levelClear();
    flash(`CAMPO LIMPO! +${bonus}${timeBonus ? ` (tempo +${timeBonus})` : ''}`, NEXT_LEVEL_DELAY_MS);
    later(() => {
      if (!running) return;
      newBoard(level + 1);
    }, NEXT_LEVEL_DELAY_MS);
  }

  function explode(c, r) {
    state = 'lost';
    explodedIdx = idx(c, r);
    sfx.mineBoom();
    shakeUntil = Date.now() + 500;
    // todas as minas explodem em sequência a partir da pisada
    const list = [];
    cells.forEach((cl, i) => {
      if (cl.mine && !cl.flagged) list.push(i);
    });
    list.sort((a, b) => Math.hypot((a % cols) - c, Math.floor(a / cols) - r) - Math.hypot((b % cols) - c, Math.floor(b / cols) - r));
    const now = Date.now();
    list.forEach((i, n) => boom.push({ i, at: now + 80 + n * 55 }));
    flash('BOOM!', 1500);
    later(() => {
      if (!running) return;
      state = 'over';
      stop();
      onGameOver && onGameOver(score);
    }, Math.max(GAME_OVER_DELAY_MS, 300 + list.length * 55));
  }

  function openAt(c, r) {
    if (state !== 'play') return;
    const cl = cells[idx(c, r)];
    if (cl.flagged) return;
    if (cl.revealed) {
      chord(c, r);
      return;
    }
    if (firstClick) {
      firstClick = false;
      startedAt = Date.now();
      placeMines(c, r);
    }
    if (cl.mine) {
      cl.revealed = true;
      explode(c, r);
      return;
    }
    revealCell(c, r);
    winLevelIfDone();
  }

  function chord(c, r) {
    const cl = cells[idx(c, r)];
    if (!cl.revealed || cl.adj === 0) return;
    const around = neighbors(c, r);
    const flagged = around.filter(([nc, nr]) => cells[idx(nc, nr)].flagged).length;
    if (flagged !== cl.adj) return;
    let hitMine = null;
    around.forEach(([nc, nr]) => {
      const n = cells[idx(nc, nr)];
      if (n.revealed || n.flagged) return;
      if (n.mine) {
        n.revealed = true;
        hitMine = hitMine || [nc, nr];
      } else revealCell(nc, nr);
    });
    if (hitMine) explode(hitMine[0], hitMine[1]);
    else winLevelIfDone();
  }

  function toggleFlag(c, r) {
    if (state !== 'play') return;
    const cl = cells[idx(c, r)];
    if (cl.revealed) return;
    if (!cl.flagged && flagsLeft <= 0) return; // sem bandeiras sobrando (igual o contador do original: pode ficar negativo; aqui trava no zero)
    cl.flagged = !cl.flagged;
    flagsLeft += cl.flagged ? -1 : 1;
    sfx.flag();
  }

  // ---------- desenho ----------
  const numColors = () => (lightBg() ? NUM_LIGHT : NUM_DARK);
  function lightBg() {
    ctx.fillStyle = colors.bg;
    const c = String(ctx.fillStyle);
    if (c[0] !== '#' || c.length < 7) return false;
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 150;
  }

  function cellRect(c, r) {
    return { x: ox + c * cell, y: oy + r * cell };
  }

  function bevel(x, y, s, raised, light, dark, face) {
    ctx.fillStyle = face;
    ctx.fillRect(x, y, s, s);
    const t = Math.max(2, Math.round(s / 10));
    ctx.fillStyle = raised ? light : dark;
    ctx.fillRect(x, y, s, t);
    ctx.fillRect(x, y, t, s);
    ctx.fillStyle = raised ? dark : light;
    ctx.fillRect(x, y + s - t, s, t);
    ctx.fillRect(x + s - t, y, t, s);
  }

  function drawMine(cx, cy, rad, body) {
    ctx.save();
    ctx.strokeStyle = body;
    ctx.lineWidth = Math.max(1.5, rad / 4);
    ctx.lineCap = 'round';
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * rad * 0.7, cy + Math.sin(a) * rad * 0.7);
      ctx.lineTo(cx + Math.cos(a) * rad * 1.35, cy + Math.sin(a) * rad * 1.35);
      ctx.stroke();
    }
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.arc(cx - rad * 0.32, cy - rad * 0.32, rad * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawFlag(x, y, s) {
    const poleX = x + s * 0.52;
    if (style === 'perigo') {
      // placa triangular de perigo em cima de uma haste
      ctx.fillStyle = '#ffd400';
      ctx.beginPath();
      ctx.moveTo(x + s * 0.5, y + s * 0.18);
      ctx.lineTo(x + s * 0.84, y + s * 0.72);
      ctx.lineTo(x + s * 0.16, y + s * 0.72);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.fillRect(x + s * 0.47, y + s * 0.34, s * 0.06, s * 0.2);
      ctx.fillRect(x + s * 0.47, y + s * 0.58, s * 0.06, s * 0.06);
      return;
    }
    ctx.fillStyle = style === 'janela' ? '#000' : colors.ink;
    ctx.fillRect(poleX - 1, y + s * 0.2, 2, s * 0.58);
    ctx.fillRect(x + s * 0.3, y + s * 0.74, s * 0.4, 2.5);
    ctx.fillStyle = colors.danger;
    ctx.beginPath();
    ctx.moveTo(poleX, y + s * 0.2);
    ctx.lineTo(poleX - s * 0.34, y + s * 0.36);
    ctx.lineTo(poleX, y + s * 0.52);
    ctx.closePath();
    ctx.fill();
  }

  function drawCell(c, r, now) {
    const cl = cells[idx(c, r)];
    const { x, y } = cellRect(c, r);
    const s = cell;
    const popAge = pops.length ? 0 : 0;
    const dark = !lightBg();
    let face;
    let light;
    let shade;
    if (style === 'janela') {
      face = '#c0c0c0';
      light = '#ffffff';
      shade = '#808080';
    } else if (style === 'perigo') {
      face = '#2b2b24';
      light = '#4b4b3e';
      shade = '#0e0e0a';
    } else {
      face = colors.panel;
      light = dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.8)';
      shade = dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.22)';
    }
    const showMine = cl.mine && (state === 'lost' || state === 'over') && !cl.flagged;
    const boomed = boom.find((b) => b.i === idx(c, r));
    if (!cl.revealed && !(showMine && boomed && now >= boomed.at)) {
      bevel(x, y, s, true, light, shade, face);
      if (style === 'perigo') {
        // parafusos nos cantos das placas
        ctx.fillStyle = '#6b6b58';
        const k = Math.max(2, s * 0.09);
        [[3, 3], [s - 3 - k, 3], [3, s - 3 - k], [s - 3 - k, s - 3 - k]].forEach(([dx, dy]) => ctx.fillRect(x + dx, y + dy, k, k));
      }
      if (cl.flagged) drawFlag(x, y, s);
      // mina errada marcada com bandeira no fim de jogo
      if ((state === 'lost' || state === 'over') && cl.flagged && !cl.mine) {
        ctx.strokeStyle = colors.danger;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 3, y + 3);
        ctx.lineTo(x + s - 3, y + s - 3);
        ctx.moveTo(x + s - 3, y + 3);
        ctx.lineTo(x + 3, y + s - 3);
        ctx.stroke();
      }
      return;
    }
    // casa aberta
    const revealedFace = style === 'janela' ? '#c0c0c0' : style === 'perigo' ? '#16160f' : colors.bg;
    ctx.fillStyle = revealedFace;
    ctx.fillRect(x, y, s, s);
    ctx.strokeStyle = style === 'janela' ? '#808080' : style === 'perigo' ? '#2b2b24' : colors.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
    // "pop" ao abrir
    const pop = pops.find((p) => p.i === idx(c, r));
    if (pop) {
      const age = (now - pop.t) / 260;
      if (age < 1) {
        ctx.fillStyle = style === 'perigo' ? '#ffd400' : colors.accent;
        ctx.globalAlpha = (1 - age) * 0.5;
        ctx.fillRect(x, y, s, s);
        ctx.globalAlpha = 1;
      }
    }
    if (cl.mine) {
      if (idx(c, r) === explodedIdx) {
        ctx.fillStyle = style === 'janela' ? '#ff0000' : colors.danger;
        ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
      }
      drawMine(x + s / 2, y + s / 2, s * 0.24, style === 'janela' ? '#000' : style === 'perigo' ? '#d8d8c8' : colors.ink);
    } else if (cl.adj > 0) {
      ctx.fillStyle = style === 'perigo' ? ['', '#ffd400', '#ff9f1a', '#ff5a2e', '#ff3b3b', '#ff4fa0', '#4fe3d1', '#ffffff', '#b0b0a0'][cl.adj] : numColors()[cl.adj];
      ctx.font = `bold ${Math.round(s * 0.62)}px ${style === 'janela' ? 'Pixelify Sans, ' : ''}monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(cl.adj), x + s / 2, y + s / 2 + 1);
    }
  }

  // contador de LED de 7 segmentos (3 dígitos)
  const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g' };
  function drawLed(value, x, y, color) {
    const text = (value < 0 ? '-' + String(Math.min(99, -value)).padStart(2, '0') : String(Math.min(999, value)).padStart(3, '0'));
    ctx.fillStyle = '#100';
    ctx.fillRect(x - 3, y - 3, 3 * 15 + 6, 28);
    for (let i = 0; i < text.length; i++) {
      const dx = x + i * 15;
      const on = SEG[text[i]] || '';
      const seg = (name, rx, ry, rw, rh) => {
        ctx.fillStyle = on.includes(name) ? color : 'rgba(255,255,255,0.06)';
        ctx.fillRect(dx + rx, y + ry, rw, rh);
      };
      seg('a', 2, 0, 8, 2);
      seg('g', 2, 11, 8, 2);
      seg('d', 2, 22, 8, 2);
      seg('f', 0, 2, 2, 9);
      seg('b', 10, 2, 2, 9);
      seg('e', 0, 13, 2, 9);
      seg('c', 10, 13, 2, 9);
    }
  }

  function drawHeader() {
    const ledColor = style === 'perigo' ? '#ffd400' : style === 'janela' ? '#ff2a1a' : colors.accent;
    if (style === 'janela') {
      ctx.fillStyle = '#c0c0c0';
      ctx.fillRect(0, 0, W, HEAD_H);
      ctx.fillStyle = '#808080';
      ctx.fillRect(4, 4, W - 8, 1);
      ctx.fillRect(4, 4, 1, HEAD_H - 8);
      ctx.fillStyle = '#fff';
      ctx.fillRect(4, HEAD_H - 5, W - 8, 1);
      ctx.fillRect(W - 5, 4, 1, HEAD_H - 8);
    } else {
      ctx.fillStyle = style === 'perigo' ? '#0e0e0a' : colors.panel;
      ctx.fillRect(0, 0, W, HEAD_H);
      ctx.fillStyle = colors.line;
      ctx.fillRect(0, HEAD_H - 1, W, 1);
      if (style === 'perigo') {
        // fita de perigo (amarelo e preto na diagonal) embaixo do cabeçalho
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, HEAD_H - 5, W, 5);
        ctx.clip();
        for (let x = -10; x < W + 10; x += 14) {
          ctx.fillStyle = '#ffd400';
          ctx.beginPath();
          ctx.moveTo(x, HEAD_H);
          ctx.lineTo(x + 7, HEAD_H);
          ctx.lineTo(x + 12, HEAD_H - 5);
          ctx.lineTo(x + 5, HEAD_H - 5);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
    }
    drawLed(flagsLeft, 12, 10, ledColor);
    const secs = state === 'play' && !firstClick ? Math.floor((Date.now() - startedAt) / 1000) : Math.floor(elapsedMs / 1000);
    drawLed(secs, W - 12 - 45 - 4, 10, ledColor);
    // carinha: 🙂 jogando, 😮 segurando clique, 😎 venceu, 😵 perdeu (desenhada)
    const fx = W / 2;
    const fy = 23;
    const mood = state === 'lost' || state === 'over' ? 'dead' : state === 'won' ? 'cool' : press ? 'oh' : 'smile';
    ctx.fillStyle = style === 'perigo' ? '#ffd400' : '#ffe14d';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(fx, fy, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#111';
    if (mood === 'cool') {
      ctx.fillRect(fx - 8, fy - 5, 16, 4);
    } else if (mood === 'dead') {
      ctx.strokeStyle = '#111';
      [[-4, -3], [4, -3]].forEach(([dx, dy]) => {
        ctx.beginPath();
        ctx.moveTo(fx + dx - 2, fy + dy - 2);
        ctx.lineTo(fx + dx + 2, fy + dy + 2);
        ctx.moveTo(fx + dx + 2, fy + dy - 2);
        ctx.lineTo(fx + dx - 2, fy + dy + 2);
        ctx.stroke();
      });
    } else {
      ctx.fillRect(fx - 5, fy - 4, 2.5, 3);
      ctx.fillRect(fx + 3, fy - 4, 2.5, 3);
    }
    ctx.strokeStyle = '#111';
    ctx.beginPath();
    if (mood === 'dead') ctx.arc(fx, fy + 8, 4, Math.PI * 1.1, Math.PI * 1.9);
    else if (mood === 'oh') ctx.arc(fx, fy + 5, 2.5, 0, Math.PI * 2);
    else ctx.arc(fx, fy + 2, 5.5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    // botão do modo bandeira (toque)
    const bx = W / 2 + 28;
    ctx.fillStyle = flagMode ? colors.accent : 'rgba(128,128,128,0.35)';
    ctx.fillRect(bx, 9, 28, 28);
    drawFlag(bx + 3, 11, 22);
  }

  function draw() {
    colors = readThemeColors();
    style = styleOf();
    const now = Date.now();
    ctx.save();
    if (shakeUntil > now) {
      const k = (shakeUntil - now) / 500;
      ctx.translate((Math.random() - 0.5) * 7 * k, (Math.random() - 0.5) * 7 * k);
    }
    ctx.fillStyle = style === 'janela' ? '#c0c0c0' : style === 'perigo' ? '#0c0c08' : colors.bg;
    ctx.fillRect(0, 0, W, H);
    drawHeader();
    // cada mina explodindo em sequência: clarão laranja
    boom.forEach((b) => {
      if (now >= b.at && !cells[b.i]._boomed) {
        cells[b.i]._boomed = true;
        sfx.reveal(1);
      }
    });
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) drawCell(c, r, now);
    boom.forEach((b) => {
      const age = (now - b.at) / 420;
      if (age >= 0 && age < 1) {
        const { x, y } = cellRect(b.i % cols, Math.floor(b.i / cols));
        ctx.fillStyle = `rgba(255,${Math.round(180 - age * 120)},40,${(1 - age) * 0.85})`;
        ctx.beginPath();
        ctx.arc(x + cell / 2, y + cell / 2, cell * (0.4 + age * 0.9), 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // cursor do teclado
    if (cursor && state === 'play') {
      const { x, y } = cellRect(cursor.c, cursor.r);
      ctx.strokeStyle = style === 'perigo' ? '#ffd400' : colors.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
    }
    pops = pops.filter((p) => now - p.t < 300);
    ctx.restore();
    // dica / aviso
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '10px monospace';
    ctx.fillStyle = style === 'janela' ? '#404040' : colors.inkDim;
    ctx.fillText(`FASE ${level}  ·  clique abre · botão direito ou segurar marca 🚩`, W / 2, H - 14);
    if (flashUntil > now) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, H / 2 - 16, W, 32);
      ctx.fillStyle = style === 'perigo' ? '#ffd400' : colors.warn;
      ctx.font = 'bold 15px monospace';
      ctx.fillText(flashText, W / 2, H / 2);
    }
  }

  // ---------- laço ----------
  function tick() {
    if (!running) return;
    if (state === 'play' && !firstClick) elapsedMs = Date.now() - startedAt;
    draw();
    raf = requestAnimationFrame(tick);
  }

  // ---------- entrada ----------
  function cellAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return null;
    const px = ((clientX - rect.left) * W) / rect.width;
    const py = ((clientY - rect.top) * H) / rect.height;
    return { px, py, c: Math.floor((px - ox) / cell), r: Math.floor((py - oy) / cell) };
  }
  const inBoard = (p) => p && p.c >= 0 && p.r >= 0 && p.c < cols && p.r < rows;

  function onPointerDown(e) {
    const p = cellAt(e.clientX, e.clientY);
    if (!p) return;
    // botão do modo bandeira
    if (p.px >= W / 2 + 28 && p.px <= W / 2 + 56 && p.py >= 9 && p.py <= 37) {
      flagMode = !flagMode;
      return;
    }
    // carinha = recomeça? só limpa o foco (a partida só reinicia pelo overlay)
    if (!inBoard(p)) return;
    cursor = null;
    if (e.button === 2) {
      toggleFlag(p.c, p.r);
      return;
    }
    if (e.button !== undefined && e.button > 2) return;
    press = { pointerId: e.pointerId, c: p.c, r: p.r, t: Date.now(), long: false, touch: e.pointerType === 'touch' };
    // segurar (toque) marca a bandeira
    const mine = press;
    later(() => {
      if (press === mine && !mine.long) {
        mine.long = true;
        toggleFlag(mine.c, mine.r);
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(20);
      }
    }, LONG_PRESS_MS);
  }
  function onPointerUp(e) {
    if (!press) return;
    const mine = press;
    press = null;
    if (mine.long) return;
    const p = cellAt(e.clientX, e.clientY);
    if (!inBoard(p) || p.c !== mine.c || p.r !== mine.r) return; // soltou em outra casa: cancela
    if (flagMode) toggleFlag(p.c, p.r);
    else openAt(p.c, p.r);
  }
  function onContext(e) {
    e.preventDefault();
  }

  function handleKey(e) {
    const k = e.key;
    const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1] }[k];
    if (move) {
      e.preventDefault();
      if (!cursor) cursor = { c: Math.floor(cols / 2), r: Math.floor(rows / 2) };
      else cursor = { c: clamp(cursor.c + move[0], 0, cols - 1), r: clamp(cursor.r + move[1], 0, rows - 1) };
      return;
    }
    if (k === ' ' || k === 'Enter') {
      e.preventDefault();
      if (!cursor) cursor = { c: Math.floor(cols / 2), r: Math.floor(rows / 2) };
      openAt(cursor.c, cursor.r);
    } else if (k === 'f' || k === 'F' || k === 'x' || k === 'X') {
      e.preventDefault();
      if (!cursor) cursor = { c: Math.floor(cols / 2), r: Math.floor(rows / 2) };
      toggleFlag(cursor.c, cursor.r);
    }
  }

  function start() {
    stopTimers();
    score = 0;
    cursor = null;
    flagMode = false;
    press = null;
    newBoard(1);
    draw();
    onScoreChange && onScoreChange(score);
    running = true;
    const add = (type, fn) => {
      canvas.addEventListener(type, fn);
      listeners.push([type, fn]);
    };
    add('pointerdown', onPointerDown);
    add('pointerup', onPointerUp);
    add('pointercancel', () => {
      press = null;
    });
    add('contextmenu', onContext);
    raf = requestAnimationFrame(tick);
  }
  function stopTimers() {
    timers.forEach((id) => clearTimeout(id));
    timers = [];
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
