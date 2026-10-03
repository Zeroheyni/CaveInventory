// Easter egg — Frogger em canvas puro, sem lib externa. Leve o sapo da
// calçada até uma das 5 tocas no topo: primeiro atravessando 5 pistas de
// trânsito, depois 5 faixas de rio pulando em troncos e tartarugas (que
// mergulham de tempos em tempos). Atropelado, afogado, levado pra fora da
// tela, tocando na parede ou estourando o tempo = perde uma vida (3 vidas,
// vida extra a cada 10.000). 5 tocas ocupadas = fase vencida, e o trânsito
// e a correnteza ficam 10% mais rápidos a cada fase.
//
// Cada pulo anda UMA casa (teclas ou deslize no toque; toque simples = pra
// frente) com uma animaçãozinha de ~100ms; um comando pode ficar na fila
// durante o pulo, pra não "engolir" tecla apertada rápido. Física em
// delta-time de verdade (ms reais entre quadros, com teto), então a
// velocidade do trânsito é a mesma em qualquer taxa de quadros.
//
// As faixas são "anéis": cada uma tem um período (largura de um objeto +
// vão) e o anel é múltiplo desse período, então os objetos andam pra
// sempre, sem sorteio e sem nunca formar um vão intransponível.
//
// O visual muda com o tema ativo (ver `styleOf`): os dois temas especiais
// ganham pintura própria (travessia noturna sob a lua, com faróis / lago de
// nenúfares em aquarela), os demais ficam no clássico com as cores do tema.
import { readThemeColors } from './theme.js';
import { sfx } from './sound.js';

const COLS = 13;
const ROWS = 14;
const CELL = 28;
const HUD_ROW = 0;
const HOME_ROW = 1;
const RIVER_FIRST = 2;
const RIVER_LAST = 6;
const MEDIAN_ROW = 7;
const ROAD_FIRST = 8;
const ROAD_LAST = 12;
const START_ROW = 13;
const HOP_MS = 105;
const MAX_DT_MS = 80;
const LIVES_START = 3;
const TIME_PER_LIFE = 32; // segundos
const DEATH_MS = 750;
const EXTRA_LIFE_EVERY = 10000;
const HOME_COLS = [1, 4, 6, 8, 11]; // coluna de cada toca
const HOME_TOL = 0.62; // o quanto o sapo pode estar fora do centro da toca (em casas)
const ROW_SCORE = 10;
const HOME_SCORE = 50;
const TIME_BONUS = 10; // por segundo sobrando
const LEVEL_BONUS = 1000;
const SPEED_STEP = 1.1;
const SPEED_CAP = 2.3;

// pistas: de baixo (perto do início) pra cima. period/w em casas, speed em casas/s.
const ROAD_LANES = [
  { dir: -1, speed: 1.5, period: 5, w: 1, kind: 'car' },
  { dir: 1, speed: 2.1, period: 6, w: 1, kind: 'race' },
  { dir: -1, speed: 1.2, period: 7, w: 2, kind: 'truck' },
  { dir: 1, speed: 2.7, period: 6, w: 1, kind: 'car' },
  { dir: -1, speed: 1.8, period: 8, w: 2, kind: 'truck' },
];
// rio: de baixo pra cima também (a faixa mais perto da calçada primeiro)
const RIVER_LANES = [
  { dir: 1, speed: 1.0, period: 5, w: 2, kind: 'turtle', dives: true },
  { dir: -1, speed: 1.4, period: 6, w: 3, kind: 'log' },
  { dir: 1, speed: 2.2, period: 9, w: 5, kind: 'log' },
  { dir: -1, speed: 0.9, period: 5, w: 2, kind: 'turtle', dives: true },
  { dir: 1, speed: 1.7, period: 6, w: 3, kind: 'log' },
];
const RING_MIN = COLS + 8; // largura mínima do anel (casas)
const RING_LEFT = -5; // o anel começa um pouco fora da tela, à esquerda

function styleOf() {
  const id = document.documentElement.getAttribute('data-theme');
  if (id === 'frogger-noite') return 'noite';
  if (id === 'frogger-nenufar') return 'nenufar';
  return 'classic';
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function mod(a, n) {
  return ((a % n) + n) % n;
}
// uma faixa do mundo: laneIndex 0.. em linhas absolutas
function buildLane(def, row, phase) {
  const ring = def.period * Math.ceil(RING_MIN / def.period);
  return { ...def, row, ring, count: ring / def.period, offset: phase, diveClock: Math.random() * 6 };
}

export function createFroggerGame(canvas, { onScoreChange, onGameOver }) {
  const ctx = canvas.getContext('2d');
  canvas.style.touchAction = 'none';
  const W = canvas.width;
  const H = canvas.height;

  let lanes; // { row, dir, speed, period, w, kind, ring, count, offset, dives }
  let frog; // { x (casas, canto esq.), row, hopFrom, hopTo, hopT, face, dead }
  let state; // 'play' | 'dying' | 'level' | 'over'
  let score, lives, level, speedMul, homes, timeLeft, bestRow, nextExtra;
  let queued = null;
  let raf = null;
  let running = false;
  let lastTs = null;
  let colors = readThemeColors();
  let style = styleOf();
  let deathAt = 0;
  let deathKind = 'squash';
  let flashText = '';
  let flashUntil = 0;
  let timers = [];
  let listeners = [];
  let swipe = null;
  let particles = [];
  let clock = 0; // segundos de jogo (anima ondas, mergulho das tartarugas)
  let shakeUntil = 0;
  let paused = true;

  function later(fn, ms) {
    timers.push(setTimeout(fn, ms));
  }
  function stopTimers() {
    timers.forEach((t) => clearTimeout(t));
    timers = [];
  }

  // ---------- mundo ----------
  function buildWorld() {
    lanes = [];
    ROAD_LANES.forEach((d, i) => lanes.push(buildLane(d, ROAD_LAST - i, i * 1.7)));
    RIVER_LANES.forEach((d, i) => lanes.push(buildLane(d, RIVER_LAST - i, i * 2.3 + 0.5)));
  }
  const laneOf = (row) => lanes.find((l) => l.row === row) || null;
  const laneSpeed = (l) => l.speed * speedMul;
  function itemX(l, k) {
    // posição (casa) do k-ésimo objeto da faixa agora
    return mod(k * l.period + l.offset * 1, l.ring) + RING_LEFT;
  }
  function isSubmerged(l, k) {
    if (!l.dives) return false;
    // cada grupo de tartarugas tem a própria fase: 5.2s de ciclo, ~1.5s submersa
    const t = mod(clock + k * 1.3 + l.row * 0.7, 5.2);
    return t > 3.7;
  }
  function platformAt(l, cx) {
    for (let k = 0; k < l.count; k++) {
      const x = itemX(l, k);
      if (cx >= x + 0.08 && cx <= x + l.w - 0.08 && !isSubmerged(l, k)) return { k, x };
    }
    return null;
  }

  function startFrog() {
    frog = { x: Math.floor(COLS / 2), row: START_ROW, hopFrom: null, hopTo: null, hopT: 0, face: 0, dead: false, ride: 0 };
    queued = null;
    timeLeft = TIME_PER_LIFE;
    bestRow = START_ROW;
  }

  function reset() {
    score = 0;
    lives = LIVES_START;
    level = 1;
    speedMul = 1;
    homes = HOME_COLS.map(() => false);
    nextExtra = EXTRA_LIFE_EVERY;
    state = 'play';
    clock = 0;
    lastTs = null;
    particles = [];
    flashText = '';
    flashUntil = 0;
    shakeUntil = 0;
    paused = true;
    buildWorld();
    startFrog();
  }

  function addScore(p) {
    score += p;
    onScoreChange && onScoreChange(score);
    if (score >= nextExtra) {
      nextExtra += EXTRA_LIFE_EVERY;
      lives += 1;
      sfx.extraLife();
      flash('VIDA EXTRA!');
    }
  }
  function flash(text, ms = 1200) {
    flashText = text;
    flashUntil = Date.now() + ms;
  }
  function puff(x, y, color, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 20 + Math.random() * 60;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, color });
    }
    if (particles.length > 80) particles.splice(0, particles.length - 80);
  }

  // ---------- pulo ----------
  function frogPx() {
    // posição de desenho (centro) com a animação do pulo
    let x = frog.x;
    let row = frog.row;
    let lift = 0;
    if (frog.hopTo) {
      const t = clamp(frog.hopT / HOP_MS, 0, 1);
      x = frog.hopFrom.x + (frog.hopTo.x - frog.hopFrom.x) * t;
      row = frog.hopFrom.row + (frog.hopTo.row - frog.hopFrom.row) * t;
      lift = Math.sin(t * Math.PI) * 6;
    }
    return { cx: (x + 0.5) * CELL, cy: (row + 0.5) * CELL - lift, x, row, lift };
  }

  function hop(dx, dy) {
    if (state !== 'play' || frog.dead) return;
    paused = false;
    if (frog.hopTo) {
      queued = [dx, dy];
      return;
    }
    const nx = frog.x + dx;
    const nrow = frog.row + dy;
    if (nrow < HOME_ROW || nrow > START_ROW) return;
    // nas margens laterais o sapo não sai da tela (nos troncos ele pode ser levado pra fora e morrer, mas não PULA pra fora)
    if (nx < -0.5 || nx > COLS - 0.5) return;
    frog.hopFrom = { x: frog.x, row: frog.row };
    // em linhas de chão (rua/calçada) o pulo lateral cai na grade inteira
    const onWater = laneOf(frog.row) && (laneOf(frog.row).kind === 'log' || laneOf(frog.row).kind === 'turtle');
    frog.hopTo = { x: dx ? (onWater ? nx : Math.round(nx)) : frog.x, row: nrow };
    frog.hopT = 0;
    frog.face = dx < 0 ? -Math.PI / 2 : dx > 0 ? Math.PI / 2 : dy > 0 ? Math.PI : 0;
    sfx.hop();
  }

  function finishHop() {
    frog.x = frog.hopTo.x;
    frog.row = frog.hopTo.row;
    frog.hopFrom = null;
    frog.hopTo = null;
    frog.hopT = 0;
    if (frog.row < bestRow) {
      bestRow = frog.row;
      addScore(ROW_SCORE);
    }
    landing();
    if (queued && state === 'play' && !frog.dead) {
      const [dx, dy] = queued;
      queued = null;
      hop(dx, dy);
    }
  }

  // o que acontece quando o sapo pousa numa linha
  function landing() {
    const row = frog.row;
    if (row === HOME_ROW) {
      const cx = frog.x + 0.5;
      const slot = HOME_COLS.findIndex((c) => Math.abs(c + 0.5 - cx) < HOME_TOL);
      if (slot < 0 || homes[slot]) {
        die('wall');
        return;
      }
      homes[slot] = true;
      const bonus = Math.max(0, Math.floor(timeLeft)) * TIME_BONUS;
      addScore(HOME_SCORE + bonus);
      sfx.home();
      puff((HOME_COLS[slot] + 0.5) * CELL, (HOME_ROW + 0.5) * CELL, colors.accent, 14);
      flash(`TOCA! +${HOME_SCORE + bonus}`);
      if (homes.every(Boolean)) levelUp();
      else startFrog();
      return;
    }
    const lane = laneOf(row);
    if (lane && lane.kind !== 'log' && lane.kind !== 'turtle') return; // rua: o atropelamento é checado a cada quadro
    if (lane) {
      const plat = platformAt(lane, frog.x + 0.5);
      if (!plat) die('drown');
    }
  }

  function levelUp() {
    state = 'level';
    addScore(LEVEL_BONUS);
    sfx.levelClear();
    flash(`FASE ${level} COMPLETA! +${LEVEL_BONUS}`, 1600);
    later(() => {
      if (!running) return;
      level += 1;
      speedMul = Math.min(SPEED_CAP, speedMul * SPEED_STEP);
      homes = HOME_COLS.map(() => false);
      startFrog();
      state = 'play';
    }, 1600);
  }

  function die(kind) {
    if (state !== 'play' || frog.dead) return;
    frog.dead = true;
    state = 'dying';
    deathKind = kind;
    deathAt = Date.now();
    lives -= 1;
    queued = null;
    shakeUntil = Date.now() + 260;
    const p = frogPx();
    puff(p.cx, p.cy, kind === 'drown' ? '#bfe8ff' : kind === 'squash' ? colors.danger : colors.warn, 14);
    if (kind === 'drown') sfx.splash();
    else sfx.squash();
    later(() => {
      if (!running) return;
      if (lives <= 0) {
        state = 'over';
        sfx.gameOver();
        stop();
        onGameOver && onGameOver(score);
        return;
      }
      startFrog();
      state = 'play';
    }, DEATH_MS);
  }

  // ---------- atualização ----------
  function update(dtMs) {
    const dt = dtMs / 1000;
    if (!paused) clock += dt;
    // objetos sempre andam depois do 1º comando (antes o mundo fica congelado, esperando)
    if (!paused) lanes.forEach((l) => { l.offset += l.dir * laneSpeed(l) * dt; });

    particles.forEach((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt * 1.6;
    });
    particles = particles.filter((p) => p.life > 0);

    if (state !== 'play' || paused) return;

    if (frog.hopTo) {
      frog.hopT += dtMs;
      if (frog.hopT >= HOP_MS) finishHop();
    }
    if (state !== 'play' || frog.dead) return;

    timeLeft -= dt;
    if (timeLeft <= 0) {
      die('time');
      return;
    }

    const lane = laneOf(frog.row);
    // arrastado pela plataforma (só parado numa linha de rio, ou no meio de um pulo lateral)
    if (lane && (lane.kind === 'log' || lane.kind === 'turtle') && !frog.hopTo) {
      const plat = platformAt(lane, frog.x + 0.5);
      if (!plat) {
        die('drown');
        return;
      }
      frog.x += lane.dir * laneSpeed(lane) * dt;
      if (frog.x < -0.55 || frog.x > COLS - 0.45) {
        die('swept');
        return;
      }
    }
    // trânsito
    const roadLane = lane && (lane.kind === 'car' || lane.kind === 'race' || lane.kind === 'truck') ? lane : null;
    const curRow = frog.hopTo && frog.hopT / HOP_MS > 0.5 ? frog.hopTo.row : frog.row;
    const rl = laneOf(curRow);
    const traffic = rl && (rl.kind === 'car' || rl.kind === 'race' || rl.kind === 'truck') ? rl : roadLane;
    if (traffic) {
      const fx = frogPx().x;
      for (let k = 0; k < traffic.count; k++) {
        const x = itemX(traffic, k);
        if (fx + 0.8 > x + 0.06 && fx + 0.2 < x + traffic.w - 0.06) {
          die('squash');
          return;
        }
      }
    }
  }

  // ---------- desenho ----------
  function palette() {
    if (style === 'noite') {
      return { sky: '#050d14', river: '#08222e', riverHi: '#0f3a4a', road: '#14171c', roadLine: '#e9d77a', bank: '#0d2417', median: '#123320', start: '#0d2417', log: '#4a3320', logHi: '#6b4a2f', turtle: '#1f6b57', frogC: colors.accent, cars: ['#ff5a7a', '#5ac8ff', '#ffd25a', '#b78bff'], light: '#fff3b0' };
    }
    if (style === 'nenufar') {
      return { sky: '#eaf4ec', river: '#bfe3dc', riverHi: '#d8f1ea', road: '#cfc8d8', roadLine: '#fffdf4', bank: '#a9d3a1', median: '#bfe3b2', start: '#a9d3a1', log: '#b08a5e', logHi: '#caa479', turtle: '#6cae6a', frogC: '#2f9d57', cars: ['#f08fb0', '#8fc7f0', '#f2d27a', '#c3a6f0'], light: '#ffffff' };
    }
    return { sky: colors.bg, river: colors.accentFaint, riverHi: colors.line, road: colors.panel, roadLine: colors.inkDim, bank: colors.bg, median: colors.panel, start: colors.panel, log: colors.inkDim, logHi: colors.ink, turtle: colors.accentCore, frogC: colors.accent, cars: [colors.danger, colors.warn, colors.ink, colors.inkDim], light: colors.ink };
  }

  function fillRow(row, color, h = 1) {
    ctx.fillStyle = color;
    ctx.fillRect(0, row * CELL, W, CELL * h);
  }

  function drawBackground(p) {
    ctx.fillStyle = p.sky;
    ctx.fillRect(0, 0, W, H);
    // rio
    ctx.fillStyle = style === 'classic' ? colors.bg : p.river;
    ctx.fillRect(0, RIVER_FIRST * CELL, W, (RIVER_LAST - RIVER_FIRST + 1) * CELL);
    if (style === 'classic') {
      ctx.fillStyle = colors.accentFaint;
      ctx.fillRect(0, RIVER_FIRST * CELL, W, (RIVER_LAST - RIVER_FIRST + 1) * CELL);
    }
    // ondinhas: traços que correm devagar
    ctx.strokeStyle = p.riverHi;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.7;
    for (let r = RIVER_FIRST; r <= RIVER_LAST; r++) {
      for (let i = 0; i < 6; i++) {
        const x = mod(i * 71 + r * 37 + clock * (r % 2 ? 9 : -9), W + 40) - 20;
        const y = r * CELL + 6 + ((i * 13 + r * 7) % 16);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 6, y - 3, x + 12, y);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    if (style === 'noite') {
      // reflexo da lua no rio
      const g = ctx.createRadialGradient(W * 0.72, RIVER_FIRST * CELL + 2, 4, W * 0.72, RIVER_FIRST * CELL + 2, 90);
      g.addColorStop(0, 'rgba(255,248,210,0.28)');
      g.addColorStop(1, 'rgba(255,248,210,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, RIVER_FIRST * CELL, W, (RIVER_LAST - RIVER_FIRST + 1) * CELL);
    }
    // margem das tocas (grama) com as 5 tocas
    ctx.fillStyle = p.bank;
    ctx.fillRect(0, HOME_ROW * CELL, W, CELL);
    for (let i = 0; i < HOME_COLS.length; i++) {
      const x = HOME_COLS[i] * CELL - 3;
      ctx.fillStyle = style === 'classic' ? colors.bg : p.river;
      ctx.fillRect(x, HOME_ROW * CELL + 2, CELL + 6, CELL - 4);
      ctx.strokeStyle = style === 'nenufar' ? '#6a8f63' : colors.line;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.5, HOME_ROW * CELL + 2.5, CELL + 5, CELL - 5);
    }
    // canteiro do meio e calçada do início
    ctx.fillStyle = p.median;
    ctx.fillRect(0, MEDIAN_ROW * CELL, W, CELL);
    ctx.fillStyle = p.start;
    ctx.fillRect(0, START_ROW * CELL, W, CELL);
    // estrada
    ctx.fillStyle = p.road;
    ctx.fillRect(0, ROAD_FIRST * CELL, W, (ROAD_LAST - ROAD_FIRST + 1) * CELL);
    // faixas tracejadas entre as pistas
    ctx.fillStyle = p.roadLine;
    ctx.globalAlpha = 0.55;
    for (let r = ROAD_FIRST + 1; r <= ROAD_LAST; r++) {
      for (let x = 4; x < W; x += 36) ctx.fillRect(x, r * CELL - 1, 18, 2);
    }
    ctx.globalAlpha = 1;
    if (style === 'nenufar') {
      // aquarela: manchas de tinta no rio
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.ellipse(40 + i * 60 + Math.sin(clock + i) * 6, RIVER_FIRST * CELL + 20 + (i % 3) * 38, 26, 9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawVehicle(l, x, k, p) {
    const px = x * CELL;
    const py = l.row * CELL + 3;
    const w = l.w * CELL - 4;
    const h = CELL - 6;
    const color = p.cars[(k + l.row) % p.cars.length];
    ctx.save();
    ctx.translate(px + 2, py);
    if (l.dir > 0) {
      // espelha pra a frente ficar pro lado certo
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.fillStyle = color;
    const body = ctx.roundRect ? () => { ctx.beginPath(); ctx.roundRect(0, 0, w, h, 5); ctx.fill(); } : () => ctx.fillRect(0, 0, w, h);
    if (l.kind === 'truck') {
      // carroceria atrás, cabine na frente (lado esquerdo)
      ctx.fillStyle = style === 'nenufar' ? '#e8e0f0' : '#2b3340';
      ctx.fillRect(w * 0.34, 1, w * 0.66, h - 2);
      ctx.fillStyle = color;
      ctx.fillRect(0, 2, w * 0.34, h - 4);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(2, 5, 5, h - 10);
    } else {
      body();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(w * 0.18, 3, w * 0.22, h - 6);
      if (l.kind === 'race') {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillRect(w * 0.45, h / 2 - 1, w * 0.5, 2);
      }
    }
    ctx.fillStyle = '#111';
    ctx.fillRect(w * 0.12, h - 3, 5, 3);
    ctx.fillRect(w * 0.7, h - 3, 5, 3);
    // faróis (de noite brilham, com um feixe na frente)
    if (style === 'noite') {
      ctx.fillStyle = p.light;
      ctx.fillRect(0, 3, 3, 3);
      ctx.fillRect(0, h - 7, 3, 3);
      const g = ctx.createLinearGradient(0, 0, -34, 0);
      g.addColorStop(0, 'rgba(255,243,176,0.45)');
      g.addColorStop(1, 'rgba(255,243,176,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 3);
      ctx.lineTo(-34, -4);
      ctx.lineTo(-34, h + 4);
      ctx.lineTo(0, h - 3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawLog(l, x, p) {
    const px = x * CELL;
    const py = l.row * CELL + 4;
    const w = l.w * CELL;
    ctx.fillStyle = p.log;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(px + 1, py, w - 2, CELL - 8, 8);
      ctx.fill();
    } else ctx.fillRect(px + 1, py, w - 2, CELL - 8);
    ctx.fillStyle = p.logHi;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(px + 6, py + 3, w - 12, 3);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    for (let i = 1; i < l.w; i++) {
      ctx.beginPath();
      ctx.arc(px + i * CELL - 6, py + (CELL - 8) / 2, 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawTurtles(l, x, k, p, submerged, warn) {
    for (let i = 0; i < l.w; i++) {
      const cx = (x + i + 0.5) * CELL;
      const cy = (l.row + 0.5) * CELL;
      ctx.globalAlpha = submerged ? 0.18 : warn ? 0.45 + 0.4 * Math.sin(clock * 24) : 1;
      if (style === 'nenufar') {
        // vitória-régia: disco com um corte e uma florzinha rosa
        ctx.fillStyle = p.turtle;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, CELL * 0.46, 0.35, Math.PI * 2 - 0.2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#f08fb0';
        ctx.beginPath();
        ctx.arc(cx + 3, cy - 3, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffe3ee';
        ctx.beginPath();
        ctx.arc(cx + 3, cy - 3, 1.8, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // casco + cabecinha + patas
        ctx.fillStyle = p.turtle;
        ctx.beginPath();
        ctx.ellipse(cx, cy, CELL * 0.4, CELL * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.beginPath();
        ctx.ellipse(cx - 2, cy - 3, CELL * 0.22, CELL * 0.12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = p.turtle;
        const hx = cx + l.dir * CELL * 0.4;
        ctx.beginPath();
        ctx.arc(hx, cy, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawLanes(p) {
    lanes.forEach((l) => {
      for (let k = 0; k < l.count; k++) {
        const x = itemX(l, k);
        if (x > COLS + 1 || x + l.w < -1) continue;
        if (l.kind === 'log') drawLog(l, x, p);
        else if (l.kind === 'turtle') {
          const t = mod(clock + k * 1.3 + l.row * 0.7, 5.2);
          drawTurtles(l, x, k, p, t > 3.7, t > 3.1 && t <= 3.7);
        } else drawVehicle(l, x, k, p);
      }
    });
  }

  function drawFrog(p) {
    if (frog.dead && state === 'dying') {
      const age = (Date.now() - deathAt) / DEATH_MS;
      const pos = frogPx();
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - age);
      if (deathKind === 'drown') {
        // anéis de água abrindo
        ctx.strokeStyle = '#d8f3ff';
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(pos.cx, pos.cy, 6 + age * 20 + i * 6, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        // esparramado: uma mancha achatada com X nos olhos
        ctx.fillStyle = deathKind === 'squash' ? colors.danger : p.frogC;
        ctx.beginPath();
        ctx.ellipse(pos.cx, pos.cy, 14, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 1.4;
        [-5, 5].forEach((dx) => {
          ctx.beginPath();
          ctx.moveTo(pos.cx + dx - 2, pos.cy - 3);
          ctx.lineTo(pos.cx + dx + 2, pos.cy + 1);
          ctx.moveTo(pos.cx + dx + 2, pos.cy - 3);
          ctx.lineTo(pos.cx + dx - 2, pos.cy + 1);
          ctx.stroke();
        });
      }
      ctx.restore();
      return;
    }
    const pos = frogPx();
    const hopK = frog.hopTo ? Math.sin(clamp(frog.hopT / HOP_MS, 0, 1) * Math.PI) : 0;
    // sombra no chão
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(pos.cx, (pos.row + 0.5) * CELL + 6, 9 - hopK * 3, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(pos.cx, pos.cy);
    ctx.rotate(frog.face);
    ctx.scale(1 - hopK * 0.08, 1 + hopK * 0.2);
    ctx.fillStyle = p.frogC;
    // patas traseiras e dianteiras
    ctx.beginPath();
    ctx.ellipse(-8, 6, 4, 6, -0.5, 0, Math.PI * 2);
    ctx.ellipse(8, 6, 4, 6, 0.5, 0, Math.PI * 2);
    ctx.ellipse(-8, -5, 3, 4, 0.6, 0, Math.PI * 2);
    ctx.ellipse(8, -5, 3, 4, -0.6, 0, Math.PI * 2);
    ctx.fill();
    // corpo e cabeça
    ctx.beginPath();
    ctx.ellipse(0, 1, 7.5, 9.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.ellipse(-1.5, 3, 3, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // olhos
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-4, -8, 3.2, 0, Math.PI * 2);
    ctx.arc(4, -8, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(-4, -8.6, 1.5, 0, Math.PI * 2);
    ctx.arc(4, -8.6, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawHomes(p) {
    homes.forEach((filled, i) => {
      if (!filled) return;
      const cx = (HOME_COLS[i] + 0.5) * CELL;
      const cy = (HOME_ROW + 0.5) * CELL;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(0.8, 0.8);
      ctx.fillStyle = p.frogC;
      ctx.beginPath();
      ctx.ellipse(0, 1, 8, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(-4, -8, 3, 0, Math.PI * 2);
      ctx.arc(4, -8, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawHud() {
    // vidas: sapinhos
    for (let i = 0; i < Math.max(0, lives); i++) {
      ctx.fillStyle = palette().frogC;
      ctx.beginPath();
      ctx.ellipse(14 + i * 20, 13, 6, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(10 + i * 20, 5, 3, 3);
      ctx.fillRect(15 + i * 20, 5, 3, 3);
    }
    // barra de tempo
    const bw = 150;
    const bx = W - bw - 12;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(bx, 8, bw, 10);
    const frac = clamp(timeLeft / TIME_PER_LIFE, 0, 1);
    ctx.fillStyle = frac > 0.33 ? colors.accent : colors.danger;
    ctx.fillRect(bx, 8, bw * frac, 10);
    ctx.fillStyle = colors.inkDim;
    ctx.font = '9px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillText(`FASE ${level}`, bx - 8, 13);
  }

  function drawParticles() {
    particles.forEach((q) => {
      ctx.globalAlpha = Math.max(0, q.life);
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3);
    });
    ctx.globalAlpha = 1;
  }

  function draw() {
    colors = readThemeColors();
    style = styleOf();
    const p = palette();
    const now = Date.now();
    ctx.save();
    if (shakeUntil > now) {
      const k = (shakeUntil - now) / 260;
      ctx.translate((Math.random() - 0.5) * 6 * k, (Math.random() - 0.5) * 6 * k);
    }
    drawBackground(p);
    drawHomes(p);
    drawLanes(p);
    drawFrog(p);
    drawParticles();
    ctx.restore();
    drawHud();
    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, H - 96, W, 40);
      ctx.fillStyle = '#f4f4f4';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('setas/WASD (ou deslize) pulam uma casa', W / 2, H - 83);
      ctx.fillText('5 tocas no topo = fase vencida', W / 2, H - 67);
    } else if (flashUntil > now) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, H / 2 - 14, W, 28);
      ctx.fillStyle = colors.warn;
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(flashText, W / 2, H / 2);
    }
  }

  // ---------- laço ----------
  function tick(ts) {
    if (!running) return;
    const dtMs = lastTs === null ? 16 : Math.min(ts - lastTs, MAX_DT_MS);
    lastTs = ts;
    update(dtMs);
    if (!running) return;
    draw();
    raf = requestAnimationFrame(tick);
  }

  // ---------- entrada ----------
  function handleKey(e) {
    const k = e.key;
    const map = { ArrowUp: [0, -1], w: [0, -1], W: [0, -1], ArrowDown: [0, 1], s: [0, 1], S: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0], ArrowRight: [1, 0], d: [1, 0], D: [1, 0] };
    const m = map[k];
    if (!m) return;
    e.preventDefault();
    if (e.repeat) return;
    hop(m[0], m[1]);
  }
  function onPointerDown(e) {
    swipe = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }
  function onPointerUp(e) {
    if (!swipe) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    swipe = null;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (ax < 14 && ay < 14) hop(0, -1); // toque simples = pra frente
    else if (ax > ay) hop(dx > 0 ? 1 : -1, 0);
    else hop(0, dy > 0 ? 1 : -1);
  }

  function start() {
    stopTimers();
    reset();
    draw();
    onScoreChange && onScoreChange(score);
    running = true;
    const add = (t, fn) => {
      canvas.addEventListener(t, fn);
      listeners.push([t, fn]);
    };
    add('pointerdown', onPointerDown);
    add('pointerup', onPointerUp);
    add('pointercancel', () => {
      swipe = null;
    });
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
