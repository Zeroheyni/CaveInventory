// Easter egg — Pac-Man em canvas puro, sem lib externa. Labirinto 19×21 com
// túnel nas laterais, 4 fantasmas com personalidades diferentes, pílulas de
// poder que viram o jogo (e os fantasmas em presa), frutas de bônus, 3 vidas
// (vida extra a cada 10.000), e fases cada vez mais rápidas. Sem fim por
// vitória: o que importa é o recorde.
//
// FANTASMAS (a mesma lógica clássica, escolhida em cada cruzamento):
//   Blinky (vermelho) persegue a casa onde você está; Pinky (rosa) mira 4
//   casas à sua frente; Inky (ciano) usa o Blinky de "régua" (vetor do
//   Blinky até 2 casas à sua frente, dobrado); Clyde (laranja) persegue,
//   mas foge pro canto dele quando chega perto demais. A cada ~20s de
//   perseguição eles recuam pros cantos por 7s (espalhar), e invertem de
//   direção na troca. Assustados andam ao acaso, devagar; comidos voltam
//   pra casinha só de olhos e saem de novo.
//
// MOVIMENTO: tudo anda sobre a grade, de centro de casa em centro de casa.
// Em cada passo "quanto falta até o próximo centro?" -- então um quadro
// lento (dt grande) nunca atravessa uma parede nem pula um cruzamento: o
// laço consome a distância do quadro em pedaços até o próximo centro. O
// Pac-Man aceita a próxima direção digitada com antecedência (vira assim
// que a curva abrir) e pode inverter no meio da casa a qualquer momento.
//
// O visual muda com o tema ativo (ver `styleOf`): os dois temas especiais
// ganham pintura própria (paredes de neon azul em fliperama escuro / doce
// kawaii pastel com carinhas), os demais ficam no clássico com as cores do
// tema.
import { readThemeColors } from './theme.js';
import { sfx } from './sound.js';

// metade esquerda do labirinto (colunas 0-9); a direita é o espelho.
// # parede · . pílula · o pílula de poder · - porta da casinha · G casinha
// (só fantasma entra) · P início do Pac-Man · espaço = caminho sem pílula
const MAZE_HALF = [
  '##########',
  '#........#',
  '#o##.###.#',
  '#.........',
  '#.##.#.###',
  '#....#...#',
  '####.###.#',
  '####.#....',
  '####.#.##-',
  '    .#.#GG',
  '####.#.###',
  '####.#....',
  '####.#.###',
  '#........#',
  '#.##.###.#',
  '#o.#.....P',
  '##.#.#.###',
  '#....#...#',
  '#.######.#',
  '#.........',
  '##########',
];
export const COLS = 19;
export const ROWS = 21;
export const TUNNEL_ROW = 9;
export function buildMaze() {
  return MAZE_HALF.map((h) => h + h.slice(0, 9).split('').reverse().join(''));
}

const TILE = 18;
const OX = 0;
const OY = 26;
const HUD_BOTTOM = 22;

const LEFT = { x: -1, y: 0 };
const RIGHT = { x: 1, y: 0 };
const UP = { x: 0, y: -1 };
const DOWN = { x: 0, y: 1 };
const DIRS = [UP, LEFT, DOWN, RIGHT]; // ordem de desempate clássica
const opposite = (d) => ({ x: -d.x, y: -d.y });
const same = (a, b) => a && b && a.x === b.x && a.y === b.y;

const MAX_DT = 0.05;
const EPS = 1e-7;
const LIVES_START = 3;
const EXTRA_LIFE_EVERY = 10000;
const DOT_SCORE = 10;
const POWER_SCORE = 50;
const GHOST_SCORES = [200, 400, 800, 1600];
const FRUIT_SCORES = [100, 300, 500, 700, 1000, 2000, 3000, 5000];
const FRUIT_AFTER = [40, 100]; // pílulas comidas pra a fruta aparecer
const FRUIT_MS = 9500;
const READY_MS = 1700;
const DEATH_MS = 1300;
const GAME_OVER_DELAY_MS = 900;
const CLEAR_MS = 1800;
const SCHEDULE = [7, 20, 7, 20, 5, 20, 5, Infinity]; // espalhar, perseguir, ...
const DOOR = { x: 9, y: 8 };
const ABOVE_DOOR = { x: 9, y: 7 };
const HOUSE_CENTER = { x: 9, y: 9 };
const CORNERS = { blinky: { x: 17, y: -2 }, pinky: { x: 1, y: -2 }, inky: { x: 17, y: 22 }, clyde: { x: 1, y: 22 } };
const GHOST_COLORS = { blinky: '#ff2d2d', pinky: '#ffb8f0', inky: '#3ee6ff', clyde: '#ffb852' };

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function styleOf() {
  const id = document.documentElement.getAttribute('data-theme');
  if (id === 'pacman-neon') return 'neon';
  if (id === 'pacman-kawaii') return 'kawaii';
  return 'classic';
}

export function createPacmanGame(canvas, { onScoreChange, onGameOver }) {
  const ctx = canvas.getContext('2d');
  canvas.style.touchAction = 'none';
  const W = canvas.width;
  const H = canvas.height;

  const grid = buildMaze();
  let pellets; // Set de "x,y" ainda em campo
  let powers;
  let totalPellets;
  let pac;
  let ghosts;
  let score, lives, level, nextExtra;
  let state; // 'ready' | 'play' | 'dying' | 'clear' | 'over'
  let paused = true; // espera a 1ª direção
  let readyUntil = 0; // ms (relógio de jogo, ver `clockMs`)
  let clockMs = 0;
  let lifeTime = 0;
  let lifePellets = 0;
  let eatenThisLife = 0;
  let ghostPhaseIdx = 0;
  let ghostPhaseT = 0;
  let frightMs = 0; // sobra de tempo assustado
  let ghostCombo = 0;
  let fruit = null; // { x, y, until, score, kind }
  let fruitsSpawned = 0;
  let flashText = '';
  let flashUntil = 0;
  let deathT = 0;
  let clearT = 0;
  let raf = null;
  let running = false;
  let lastTs = null;
  let colors = readThemeColors();
  let style = styleOf();
  let timers = [];
  let listeners = [];
  let swipe = null;
  let chompToggle = 0;
  let shakeUntil = 0;
  let particles = [];

  function later(fn, ms) {
    timers.push(setTimeout(fn, ms));
  }
  function stopTimers() {
    timers.forEach((t) => clearTimeout(t));
    timers = [];
  }

  // ---------- labirinto ----------
  function cellAt(tx, ty) {
    if (ty === TUNNEL_ROW && (tx < 0 || tx >= COLS)) return ' '; // casas "virtuais" do túnel
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return '#';
    return grid[ty][tx];
  }
  // quem pode pisar onde: o Pac-Man nunca entra na casinha nem na porta; fantasma só
  // entra/sai pela porta quando está saindo ou foi comido
  function passable(tx, ty, kind, ghostState) {
    const c = cellAt(tx, ty);
    if (c === '#') return false;
    if (c === '-') return kind === 'ghost' && (ghostState === 'leaving' || ghostState === 'eaten');
    if (c === 'G') return kind === 'ghost' && (ghostState === 'house' || ghostState === 'leaving' || ghostState === 'eaten');
    return true;
  }
  const centered = (e) => Math.abs(e.x - Math.round(e.x)) < EPS && Math.abs(e.y - Math.round(e.y)) < EPS;

  function distToNextCenter(e) {
    if (centered(e)) return 1;
    if (e.dir.x > 0) return Math.ceil(e.x - EPS) - e.x;
    if (e.dir.x < 0) return e.x - Math.floor(e.x + EPS);
    if (e.dir.y > 0) return Math.ceil(e.y - EPS) - e.y;
    return e.y - Math.floor(e.y + EPS);
  }
  function wrapTunnel(e) {
    // túnel: as casas "virtuais" -1 e COLS são o mesmo ponto (fora da tela dos dois lados), então o ciclo tem COLS+1 casas
    if (e.x < -1 - EPS) e.x += COLS + 1;
    else if (e.x > COLS + EPS) e.x -= COLS + 1;
  }

  // anda `dist` casas, decidindo a direção em cada centro com `chooser`
  function advance(e, dist, chooser, onCenter) {
    let guard = 0;
    while (dist > 1e-9 && guard++ < 50) {
      if (centered(e)) {
        e.x = Math.round(e.x);
        e.y = Math.round(e.y);
        const d = chooser(e);
        if (!d) return false;
        e.dir = d;
      }
      const toNext = distToNextCenter(e);
      const step = Math.min(dist, toNext);
      e.x += e.dir.x * step;
      e.y += e.dir.y * step;
      dist -= step;
      e.travel = (e.travel || 0) + step;
      wrapTunnel(e);
      if (Math.abs(toNext - step) < 1e-9) {
        e.x = Math.round(e.x);
        e.y = Math.round(e.y);
        // chegou num centro de casa: quem anda avisa (o Pac-Man come aqui, nunca pula uma pílula)
        if (onCenter && onCenter() === false) return false;
      }
    }
    return true;
  }

  // ---------- criação ----------
  function countPellets() {
    pellets = new Set();
    powers = new Set();
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = grid[y][x];
        if (c === '.') pellets.add(`${x},${y}`);
        else if (c === 'o') {
          pellets.add(`${x},${y}`);
          powers.add(`${x},${y}`);
        }
      }
    }
    totalPellets = pellets.size;
  }
  function makePac() {
    return { x: 9, y: 15, dir: LEFT, next: LEFT, travel: 0, dead: false };
  }
  function makeGhosts() {
    const g = (id, x, y, st, dir) => ({ id, x, y, dir, state: st, fright: false, travel: 0, bob: Math.random() * 6 });
    return [g('blinky', 9, 7, 'roam', LEFT), g('pinky', 9, 9, 'house', UP), g('inky', 8, 9, 'house', UP), g('clyde', 10, 9, 'house', UP)];
  }
  function resetPositions() {
    pac = makePac();
    ghosts = makeGhosts();
    ghostPhaseIdx = 0;
    ghostPhaseT = 0;
    frightMs = 0;
    ghostCombo = 0;
    fruit = null;
    lifeTime = 0;
    lifePellets = 0;
    state = 'ready';
    readyUntil = clockMs + READY_MS;
  }
  function reset() {
    stopTimers();
    score = 0;
    lives = LIVES_START;
    level = 1;
    nextExtra = EXTRA_LIFE_EVERY;
    fruitsSpawned = 0;
    eatenThisLife = 0;
    clockMs = 0;
    paused = true;
    swipe = null;
    particles = [];
    flashText = '';
    flashUntil = 0;
    countPellets();
    resetPositions();
    state = 'ready';
    readyUntil = Infinity; // espera o 1º comando
  }

  // ---------- velocidades (casas por segundo) ----------
  const pacSpeed = () => Math.min(8.2, 7 + (level - 1) * 0.12);
  const ghostSpeed = () => Math.min(7.8, 6.1 + (level - 1) * 0.25);
  const frightDuration = () => Math.max(1.4, 7.5 - (level - 1) * 1.1);
  function speedOf(g) {
    if (g.state === 'eaten') return 13;
    if (g.state === 'house' || g.state === 'leaving') return 3.4;
    const tunnel = Math.round(g.y) === TUNNEL_ROW && (g.x < 3.5 || g.x > COLS - 4.5);
    if (g.fright) return 3.8 * (tunnel ? 0.7 : 1);
    let s = ghostSpeed();
    // Blinky acelera quando restam poucas pílulas ("Cruise Elroy")
    if (g.id === 'blinky' && pellets.size <= 20) s += 0.7;
    if (tunnel) s *= 0.55;
    return s;
  }

  // ---------- fantasmas ----------
  function pacTile() {
    return { x: clamp(Math.round(pac.x), 0, COLS - 1), y: Math.round(pac.y) };
  }
  function chaseTarget(g) {
    const p = pacTile();
    if (g.id === 'blinky') return p;
    if (g.id === 'pinky') return { x: p.x + pac.dir.x * 4, y: p.y + pac.dir.y * 4 };
    if (g.id === 'inky') {
      const b = ghosts[0];
      const ahead = { x: p.x + pac.dir.x * 2, y: p.y + pac.dir.y * 2 };
      return { x: ahead.x * 2 - Math.round(b.x), y: ahead.y * 2 - Math.round(b.y) };
    }
    // clyde: persegue de longe, foge pro canto quando chega a menos de 8 casas
    const d = Math.hypot(Math.round(g.x) - p.x, Math.round(g.y) - p.y);
    return d > 8 ? p : CORNERS.clyde;
  }
  function currentPhase() {
    return SCHEDULE[ghostPhaseIdx] === undefined || ghostPhaseIdx % 2 === 0 ? 'scatter' : 'chase';
  }
  function targetFor(g) {
    if (g.state === 'eaten') return HOUSE_CENTER;
    if (g.state === 'leaving') return ABOVE_DOOR;
    return currentPhase() === 'scatter' ? CORNERS[g.id] : chaseTarget(g);
  }
  function ghostChooser(g) {
    const tx = Math.round(g.x);
    const ty = Math.round(g.y);
    // dentro da casinha, saindo: alinha com a coluna da porta e sobe
    if (g.state === 'leaving') {
      if (ty === ABOVE_DOOR.y && tx === ABOVE_DOOR.x) {
        g.state = 'roam';
        g.fright = false;
        // sai virando pra um dos lados (esquerda se o Pac-Man está na esquerda)
        return pacTile().x < 9 ? LEFT : RIGHT;
      }
      if (tx < 9) return RIGHT;
      if (tx > 9) return LEFT;
      return UP;
    }
    if (g.state === 'eaten' && tx === HOUSE_CENTER.x && ty === HOUSE_CENTER.y) {
      g.state = 'leaving';
      g.fright = false;
      return UP;
    }
    const options = DIRS.filter((d) => {
      if (same(d, opposite(g.dir)) && !g.forceReverse) return false;
      return passable(tx + d.x, ty + d.y, 'ghost', g.state);
    });
    g.forceReverse = false;
    if (!options.length) {
      // beco sem saída: só resta voltar
      const back = opposite(g.dir);
      return passable(tx + back.x, ty + back.y, 'ghost', g.state) ? back : null;
    }
    if (g.fright && g.state === 'roam') return options[Math.floor(Math.random() * options.length)];
    const target = targetFor(g);
    let best = options[0];
    let bestD = Infinity;
    options.forEach((d) => {
      const dd = (tx + d.x - target.x) ** 2 + (ty + d.y - target.y) ** 2;
      if (dd < bestD - 1e-9) {
        bestD = dd;
        best = d;
      }
    });
    return best;
  }

  function releaseGhosts() {
    ghosts.forEach((g) => {
      if (g.state !== 'house') return;
      const rule = {
        pinky: lifeTime >= 2.2,
        inky: lifePellets >= 18 || lifeTime >= 9,
        clyde: lifePellets >= 38 || lifeTime >= 16,
      }[g.id];
      if (rule) g.state = 'leaving';
    });
  }

  // ---------- Pac-Man ----------
  function pacChooser(e) {
    const tx = Math.round(e.x);
    const ty = Math.round(e.y);
    if (e.next && passable(tx + e.next.x, ty + e.next.y, 'pac')) return e.next;
    if (passable(tx + e.dir.x, ty + e.dir.y, 'pac')) return e.dir;
    return null;
  }
  function setDirection(d) {
    pac.next = d;
    // inverter no meio da casa é sempre permitido
    if (!centered(pac) && same(d, opposite(pac.dir))) pac.dir = d;
    if (paused) begin();
  }

  function eatAtPac() {
    if (!centered(pac)) return;
    const key = `${Math.round(pac.x)},${Math.round(pac.y)}`;
    if (!pellets.has(key)) return;
    pellets.delete(key);
    lifePellets += 1;
    eatenThisLife += 1;
    if (powers.has(key)) {
      powers.delete(key);
      addScore(POWER_SCORE);
      startFright();
      sfx.power();
    } else {
      addScore(DOT_SCORE);
      chompToggle = 1 - chompToggle;
      sfx.chomp(chompToggle);
    }
    if (fruitsSpawned < FRUIT_AFTER.length && totalPellets - pellets.size >= FRUIT_AFTER[fruitsSpawned]) {
      fruitsSpawned += 1;
      const kind = Math.min(level - 1, FRUIT_SCORES.length - 1);
      fruit = { x: 9, y: 11, until: clockMs + FRUIT_MS, score: FRUIT_SCORES[kind], kind };
    }
    if (pellets.size === 0) levelClear();
  }
  function startFright() {
    frightMs = frightDuration() * 1000;
    ghostCombo = 0;
    ghosts.forEach((g) => {
      if (g.state === 'roam') {
        g.fright = true;
        g.forceReverse = true;
        if (!centered(g)) g.dir = opposite(g.dir);
      }
    });
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
  function flash(text, ms = 1300) {
    flashText = text;
    flashUntil = Date.now() + ms;
  }

  function checkFruit() {
    if (!fruit) return;
    if (clockMs > fruit.until) {
      fruit = null;
      return;
    }
    if (Math.hypot(pac.x - fruit.x, pac.y - fruit.y) < 0.6) {
      addScore(fruit.score);
      flash(`FRUTA +${fruit.score}`);
      sfx.fruit();
      fruit = null;
    }
  }

  function checkCollisions() {
    for (const g of ghosts) {
      if (g.state === 'eaten') continue;
      let dx = Math.abs(g.x - pac.x);
      dx = Math.min(dx, COLS + 1 - dx); // o túnel é um ciclo
      if (Math.hypot(dx, g.y - pac.y) < 0.62) {
        if (g.fright && g.state === 'roam') {
          const pts = GHOST_SCORES[Math.min(ghostCombo, 3)];
          ghostCombo += 1;
          g.state = 'eaten';
          g.fright = false;
          addScore(pts);
          flash(`+${pts}`, 800);
          sfx.eatGhost();
          burst(g.x, g.y, GHOST_COLORS[g.id], 10);
        } else {
          killPac();
          return;
        }
      }
    }
  }
  function burst(tx, ty, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      particles.push({ x: tx, y: ty, vx: Math.cos(a) * (2 + Math.random() * 3), vy: Math.sin(a) * (2 + Math.random() * 3), life: 1, color });
    }
    if (particles.length > 70) particles.splice(0, particles.length - 70);
  }

  function killPac() {
    if (state !== 'play') return;
    state = 'dying';
    pac.dead = true;
    deathT = 0;
    lives -= 1;
    sfx.pacDeath();
    shakeUntil = Date.now() + 260;
  }

  function levelClear() {
    state = 'clear';
    clearT = 0;
    sfx.levelClear();
    flash(`FASE ${level} COMPLETA!`, CLEAR_MS);
  }

  // ---------- laço de atualização ----------
  function update(dt) {
    clockMs += dt * 1000;
    particles.forEach((q) => {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.life -= dt * 2;
    });
    particles = particles.filter((q) => q.life > 0);

    if (state === 'dying') {
      deathT += dt * 1000;
      if (deathT >= DEATH_MS) {
        if (lives <= 0) {
          state = 'over';
          later(() => {
            if (!running) return;
            stop();
            sfx.gameOver();
            onGameOver && onGameOver(score);
          }, GAME_OVER_DELAY_MS);
        } else {
          resetPositions();
        }
      }
      return;
    }
    if (state === 'clear') {
      clearT += dt * 1000;
      if (clearT >= CLEAR_MS) {
        level += 1;
        fruitsSpawned = 0;
        countPellets();
        resetPositions();
      }
      return;
    }
    if (state === 'over') return;
    if (state === 'ready') {
      if (!paused && clockMs >= readyUntil) state = 'play';
      return;
    }

    // ---- jogando ----
    lifeTime += dt;
    // espalhar/perseguir (o relógio PARA enquanto os fantasmas estão assustados)
    if (frightMs > 0) {
      frightMs -= dt * 1000;
      if (frightMs <= 0) {
        frightMs = 0;
        ghosts.forEach((g) => {
          g.fright = false;
        });
      }
    } else {
      ghostPhaseT += dt;
      if (ghostPhaseT >= SCHEDULE[ghostPhaseIdx]) {
        ghostPhaseT = 0;
        ghostPhaseIdx += 1;
        ghosts.forEach((g) => {
          if (g.state === 'roam' && !g.fright) {
            g.forceReverse = true;
            if (!centered(g)) g.dir = opposite(g.dir);
          }
        });
      }
    }
    releaseGhosts();

    // Pac-Man (come a pílula de cada centro que atravessa, mesmo num quadro lento)
    const atCenter = () => {
      eatAtPac();
      return state === 'play';
    };
    atCenter(); // parado num centro (ex.: recém-reposicionado) também come
    if (state !== 'play') return;
    advance(pac, pacSpeed() * dt, pacChooser, atCenter);
    if (state !== 'play') return;
    checkFruit();
    ghosts.forEach((g) => {
      if (g.state === 'house') {
        g.bob += dt * 6;
        return;
      }
      advance(g, speedOf(g) * dt, ghostChooser);
    });
    checkCollisions();
  }

  // ---------- desenho ----------
  function lightBg() {
    ctx.fillStyle = colors.bg;
    const c = String(ctx.fillStyle);
    if (c[0] !== '#' || c.length < 7) return false;
    return (parseInt(c.slice(1, 3), 16) * 299 + parseInt(c.slice(3, 5), 16) * 587 + parseInt(c.slice(5, 7), 16) * 114) / 1000 > 150;
  }
  function pal() {
    if (style === 'neon') return { bg: '#02030d', wall: '#3b5bff', wallGlow: '#3b5bff', pellet: '#ffd9a8', pac: '#ffe600', door: '#ff9bf0', fright: '#2433ff', frightFlash: '#ffffff', text: '#f4f4ff' };
    if (style === 'kawaii') return { bg: '#fff7ea', wall: '#9ad8c6', wallGlow: null, pellet: '#f59a23', pac: '#ffb02e', door: '#f7a6c8', fright: '#8fb6ff', frightFlash: '#ffffff', text: '#6a4a3a' };
    const light = lightBg();
    return { bg: colors.bg, wall: colors.accentCore, wallGlow: colors.accent, pellet: colors.ink, pac: light ? '#e0a800' : '#ffe14d', door: colors.danger, fright: '#2a3fd6', frightFlash: '#ffffff', text: colors.ink };
  }

  function wallNeighbors(x, y) {
    const w = (tx, ty) => cellAt(tx, ty) === '#' || (ty !== TUNNEL_ROW && (tx < 0 || tx >= COLS));
    return { up: w(x, y - 1), down: w(x, y + 1), left: w(x - 1, y), right: w(x + 1, y) };
  }

  function drawWalls(p) {
    ctx.save();
    if (style === 'kawaii') {
      ctx.fillStyle = p.wall;
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (grid[y][x] !== '#') continue;
          const px = OX + x * TILE;
          const py = OY + y * TILE;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(px + 1, py + 1, TILE - 2, TILE - 2, 6);
          else ctx.rect(px + 1, py + 1, TILE - 2, TILE - 2);
          ctx.fill();
        }
      }
      // ligações entre blocos vizinhos (cantos preenchidos) pra parecer uma massa só
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (grid[y][x] !== '#') continue;
          const px = OX + x * TILE;
          const py = OY + y * TILE;
          if (x + 1 < COLS && grid[y][x + 1] === '#') ctx.fillRect(px + TILE - 4, py + 2, 8, TILE - 4);
          if (y + 1 < ROWS && grid[y + 1][x] === '#') ctx.fillRect(px + 2, py + TILE - 4, TILE - 4, 8);
        }
      }
      ctx.restore();
      return;
    }
    ctx.strokeStyle = p.wall;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    if (p.wallGlow) {
      ctx.shadowColor = p.wallGlow;
      ctx.shadowBlur = style === 'neon' ? 9 : 4;
    }
    ctx.beginPath();
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (grid[y][x] !== '#') continue;
        const n = wallNeighbors(x, y);
        const px = OX + x * TILE;
        const py = OY + y * TILE;
        const i = 3; // recuo da linha pra dentro da casa de parede (dá a espessura "oca" do labirinto)
        if (!n.up) { ctx.moveTo(px + i, py + i); ctx.lineTo(px + TILE - i, py + i); }
        if (!n.down) { ctx.moveTo(px + i, py + TILE - i); ctx.lineTo(px + TILE - i, py + TILE - i); }
        if (!n.left) { ctx.moveTo(px + i, py + i); ctx.lineTo(px + i, py + TILE - i); }
        if (!n.right) { ctx.moveTo(px + TILE - i, py + i); ctx.lineTo(px + TILE - i, py + TILE - i); }
      }
    }
    ctx.stroke();
    ctx.restore();
    // porta da casinha
    ctx.fillStyle = p.door;
    ctx.fillRect(OX + DOOR.x * TILE + 2, OY + DOOR.y * TILE + TILE / 2 - 1.5, TILE - 4, 3);
  }

  function drawPellets(p, now) {
    ctx.fillStyle = p.pellet;
    pellets.forEach((key) => {
      const [x, y] = key.split(',').map(Number);
      const cx = OX + x * TILE + TILE / 2;
      const cy = OY + y * TILE + TILE / 2;
      if (powers.has(key)) {
        if (Math.floor(now / 260) % 2 === 0 || state !== 'play') {
          ctx.beginPath();
          ctx.arc(cx, cy, style === 'kawaii' ? 6 : 5.5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, style === 'kawaii' ? 2.6 : 1.9, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  function drawFruit() {
    if (!fruit) return;
    const cx = OX + fruit.x * TILE + TILE / 2;
    const cy = OY + fruit.y * TILE + TILE / 2;
    const k = fruit.kind % 4;
    ctx.save();
    ctx.translate(cx, cy);
    if (k === 0) {
      // cereja
      ctx.strokeStyle = '#3a8a3a';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-3, 2);
      ctx.quadraticCurveTo(0, -8, 4, -7);
      ctx.moveTo(3, 3);
      ctx.quadraticCurveTo(4, -4, 4, -7);
      ctx.stroke();
      ctx.fillStyle = '#e0202e';
      ctx.beginPath();
      ctx.arc(-3.5, 4, 4, 0, Math.PI * 2);
      ctx.arc(3.5, 5, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (k === 1) {
      // morango
      ctx.fillStyle = '#e8283a';
      ctx.beginPath();
      ctx.moveTo(-6, -3);
      ctx.quadraticCurveTo(0, -8, 6, -3);
      ctx.quadraticCurveTo(5, 6, 0, 8);
      ctx.quadraticCurveTo(-5, 6, -6, -3);
      ctx.fill();
      ctx.fillStyle = '#3a9a3a';
      ctx.fillRect(-4, -7, 8, 3);
    } else if (k === 2) {
      // laranja
      ctx.fillStyle = '#ff9a1f';
      ctx.beginPath();
      ctx.arc(0, 1, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a9a3a';
      ctx.fillRect(-1, -7, 4, 3);
    } else {
      // maçã
      ctx.fillStyle = '#d8222a';
      ctx.beginPath();
      ctx.arc(-2.5, 1, 5, 0, Math.PI * 2);
      ctx.arc(2.5, 1, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a9a3a';
      ctx.fillRect(-0.5, -7, 2, 4);
    }
    ctx.restore();
  }

  function drawPac(p, now) {
    const cx = OX + pac.x * TILE + TILE / 2;
    const cy = OY + pac.y * TILE + TILE / 2;
    const r = TILE * 0.46;
    ctx.save();
    ctx.translate(cx, cy);
    if (state === 'dying') {
      // a boca vai abrindo até sumir (pizza fechando por trás)
      const k = clamp(deathT / DEATH_MS, 0, 1);
      ctx.fillStyle = p.pac;
      const open = k * Math.PI;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, -Math.PI / 2 + open, -Math.PI / 2 + Math.PI * 2 - open);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }
    const ang = Math.atan2(pac.dir.y, pac.dir.x);
    const mouth = state === 'play' || paused ? (Math.sin((pac.travel || 0) * 2.4 + 1) + 1) * 0.5 * 0.85 : 0.25;
    ctx.rotate(ang);
    if (style === 'neon') {
      ctx.shadowColor = '#ffe600';
      ctx.shadowBlur = 10;
    }
    ctx.fillStyle = p.pac;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, mouth, Math.PI * 2 - mouth);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    if (style === 'kawaii') {
      // olhinho, bochecha e lacinho
      ctx.rotate(-ang);
      ctx.fillStyle = '#5a3a2a';
      ctx.beginPath();
      ctx.arc(1.5, -4, 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,110,150,0.6)';
      ctx.beginPath();
      ctx.arc(-3, 1, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff6fa5';
      ctx.beginPath();
      ctx.moveTo(-1, -r + 1);
      ctx.lineTo(-6, -r - 3);
      ctx.lineTo(-6, -r + 4);
      ctx.closePath();
      ctx.moveTo(-1, -r + 1);
      ctx.lineTo(4, -r - 3);
      ctx.lineTo(4, -r + 4);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.rotate(-ang);
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(1, -4.2, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    void now;
  }

  function drawGhost(g, p, now) {
    const cx = OX + g.x * TILE + TILE / 2;
    let cy = OY + g.y * TILE + TILE / 2;
    if (g.state === 'house') cy += Math.sin(g.bob) * 2.5;
    const r = TILE * 0.5;
    const eaten = g.state === 'eaten';
    const frightFlash = g.fright && frightMs < 2000 && Math.floor(now / 170) % 2 === 0;
    ctx.save();
    ctx.translate(cx, cy);
    if (!eaten) {
      const col = g.fright ? (frightFlash ? p.frightFlash : p.fright) : GHOST_COLORS[g.id];
      ctx.fillStyle = col;
      if (style === 'neon' && !g.fright) {
        ctx.shadowColor = col;
        ctx.shadowBlur = 8;
      }
      ctx.beginPath();
      ctx.arc(0, -1, r, Math.PI, 0);
      ctx.lineTo(r, r - 1);
      // barra ondulada que se mexe (3 ondas, fase pela distância andada)
      const ph = Math.floor((g.travel || 0) * 3) % 2;
      const waves = 3;
      const w = (r * 2) / waves;
      for (let i = 0; i < waves; i++) {
        const x0 = r - i * w;
        ctx.lineTo(x0 - w / 2, r - 1 - ((i + ph) % 2 === 0 ? 4 : 0));
        ctx.lineTo(x0 - w, r - 1);
      }
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    // olhos (olham na direção do movimento) -- ou carinha assustada
    if (g.fright && !eaten) {
      ctx.fillStyle = frightFlash ? '#ff3b3b' : '#ffe9c0';
      ctx.fillRect(-4, -4, 2.4, 2.4);
      ctx.fillRect(2, -4, 2.4, 2.4);
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let i = 0; i < 5; i++) ctx.lineTo(-5 + i * 2.5, 3 + (i % 2 ? -1.5 : 1));
      ctx.stroke();
    } else {
      const ex = g.dir.x * 1.6;
      const ey = g.dir.y * 1.6;
      [-3.4, 3.4].forEach((dx) => {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.ellipse(dx, -3, 2.9, 3.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1a2cd8';
        ctx.beginPath();
        ctx.arc(dx + ex, -3 + ey, 1.5, 0, Math.PI * 2);
        ctx.fill();
      });
      if (style === 'kawaii' && !eaten) {
        ctx.fillStyle = 'rgba(255,110,150,0.55)';
        ctx.beginPath();
        ctx.arc(-6, 2, 2, 0, Math.PI * 2);
        ctx.arc(6, 2, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawHud(p) {
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = p.text;
    ctx.fillText(`FASE ${level}`, 10, 13);
    ctx.textAlign = 'right';
    ctx.fillStyle = style === 'kawaii' ? '#6a4a3a' : colors.inkDim;
    ctx.font = '10px monospace';
    ctx.fillText(`${pellets.size} pílulas`, W - 10, 13);
    // vidas: pacs pequenos embaixo
    for (let i = 0; i < Math.max(0, lives - (state === 'dying' ? 0 : 1) + (state === 'ready' || state === 'play' ? 0 : 0)); i++) {
      const cx = 18 + i * 22;
      const cy = H - HUD_BOTTOM / 2 - 1;
      ctx.fillStyle = p.pac;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, 7, 0.45, Math.PI * 2 - 0.45);
      ctx.closePath();
      ctx.fill();
    }
    // fruta da fase no canto
    if (level >= 1) {
      const saved = fruit;
      fruit = { x: (W - 22) / TILE - 0.5, y: (H - HUD_BOTTOM / 2 - OY - 1) / TILE - 0.5, kind: Math.min(level - 1, FRUIT_SCORES.length - 1) };
      drawFruit();
      fruit = saved;
    }
  }

  function draw() {
    colors = readThemeColors();
    style = styleOf();
    const p = pal();
    const now = Date.now();
    ctx.save();
    if (shakeUntil > now) ctx.translate((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, W, H);
    // piscar das paredes quando a fase termina
    const blink = state === 'clear' && Math.floor(clearT / 200) % 2 === 0;
    if (blink) {
      const pp = { ...p, wall: '#ffffff', wallGlow: '#ffffff' };
      drawWalls(pp);
    } else drawWalls(p);
    if (state !== 'clear') drawPellets(p, now);
    drawFruit();
    if (state !== 'dying' || deathT < DEATH_MS) ghosts.forEach((g) => (state === 'dying' ? null : drawGhost(g, p, now)));
    drawPac(p, now);
    particles.forEach((q) => {
      ctx.globalAlpha = Math.max(0, q.life);
      ctx.fillStyle = q.color;
      ctx.fillRect(OX + q.x * TILE + TILE / 2 - 1.5, OY + q.y * TILE + TILE / 2 - 1.5, 3, 3);
    });
    ctx.globalAlpha = 1;
    ctx.restore();
    drawHud(p);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (state === 'ready') {
      ctx.fillStyle = style === 'kawaii' ? '#e0701a' : '#ffe600';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(paused ? 'PRONTO? setas/WASD ou deslize' : 'PRONTO!', W / 2, OY + 11 * TILE + TILE / 2);
    } else if (flashUntil > now && state === 'play') {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, OY + 11 * TILE - 2, W, 22);
      ctx.fillStyle = style === 'kawaii' ? '#fff' : colors.warn;
      ctx.font = 'bold 13px monospace';
      ctx.fillText(flashText, W / 2, OY + 11 * TILE + 9);
    } else if (flashUntil > now && (state === 'clear' || state === 'over')) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, OY + 11 * TILE - 2, W, 22);
      ctx.fillStyle = '#ffe600';
      ctx.font = 'bold 13px monospace';
      ctx.fillText(flashText, W / 2, OY + 11 * TILE + 9);
    }
  }

  function tick(ts) {
    if (!running) return;
    const dt = lastTs === null ? 0.016 : Math.min((ts - lastTs) / 1000, MAX_DT);
    lastTs = ts;
    update(dt);
    if (!running) return;
    draw();
    raf = requestAnimationFrame(tick);
  }

  // ---------- entrada ----------
  function begin() {
    if (!paused) return;
    paused = false;
    readyUntil = clockMs + READY_MS;
  }
  function handleKey(e) {
    const map = { ArrowUp: UP, w: UP, W: UP, ArrowDown: DOWN, s: DOWN, S: DOWN, ArrowLeft: LEFT, a: LEFT, A: LEFT, ArrowRight: RIGHT, d: RIGHT, D: RIGHT };
    const d = map[e.key];
    if (!d) return;
    e.preventDefault();
    setDirection(d);
  }
  function onPointerDown(e) {
    swipe = { x: e.clientX, y: e.clientY };
  }
  function onPointerUp(e) {
    if (!swipe) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
    if (Math.abs(dx) > Math.abs(dy)) setDirection(dx > 0 ? RIGHT : LEFT);
    else setDirection(dy > 0 ? DOWN : UP);
  }

  function start() {
    stopTimers();
    reset();
    draw();
    onScoreChange && onScoreChange(score);
    running = true;
    lastTs = null;
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
