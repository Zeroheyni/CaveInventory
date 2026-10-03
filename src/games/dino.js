// Easter egg — Dino (o "jogo sem internet" do Chrome) em canvas puro, sem
// lib externa. Corrida infinita: pule cactos (espaço/↑/W/clique), abaixe
// pra passar por baixo dos pterodátilos médios (↓/S) e acelere cada vez
// mais. Segurar o pulo faz ele subir mais alto; soltar cedo faz um pulinho.
// ↓ no ar derruba o dino rápido. A cada 700 pontos o dia vira noite (e
// vice-versa), como no original.
//
// Física contínua via requestAnimationFrame com delta-time normalizado
// (ver flappy.js: sem isso o jogo roda mais rápido/lento dependendo dos
// quadros por segundo do navegador). O espaçamento entre obstáculos é
// calculado em função da velocidade ATUAL e do tempo de um pulo (ver
// `minGapFor`), pra nunca gerar uma sequência impossível de pular.
//
// O visual muda com o tema ativo (ver `styleOf`): o tema "Era Jurássica"
// ganha vulcões/lava/brasas e pterodátilos de fogo; os demais usam o
// pixel-art clássico com as cores do tema (no tema claro "Sem Internet" fica
// idêntico ao original do Chrome, cinza no branco).
import { readThemeColors } from './theme.js';
import { sfx } from './sound.js';

const REF_FRAME_MS = 1000 / 60;
const MAX_DT_FRAMES = 4;

const GRAVITY = 0.62;
const JUMP_V = -10.6;
const JUMP_CUT = 0.45; // soltar o botão com o dino subindo multiplica a velocidade por isso
const FAST_FALL = 2.6; // gravidade ×N com ↓ no ar
const SPEED_START = 6;
const SPEED_MAX = 13.8;
const SPEED_ACCEL = 0.0016; // por quadro
const SCORE_PER_PX = 0.017; // 6px/quadro ≈ 6 pontos por segundo... ×60 quadros: ver tick
const PX = 2; // tamanho de cada "pixel" da arte
const DINO_X = 44;
const MILESTONE = 100;
const NIGHT_EVERY = 700;
const BIRD_FROM_SCORE = 450;
const GAME_OVER_DELAY_MS = 650;

// ---------------- pixel-art ----------------
// '#' = preenchido, '.' = vazio, 'x' = vazio só na carinha de morto (olho em X)
const row = (s, w) => s.padEnd(w, '.');
const DINO_W = 22;
const DINO_BODY = [
  '..............########',
  '..............##.#####',
  '..............########',
  '..............########',
  '..............####....',
  '..............#####...',
  '#............########.',
  '#...........#########.',
  '##..........#########.',
  '###........##########.',
  '####......###########.',
  '.#########.##########.',
  '..##################.#',
  '...################..#',
  '....###############.##',
  '.....#############....',
  '......###########.....',
  '.......#########......',
].map((s) => row(s, DINO_W));
const LEGS_A = ['........###..###......', '........###..###......', '........###..####.....', '........###...........', '........###...........', '........####..........'].map((s) => row(s, DINO_W));
const LEGS_B = ['........###..###......', '........###..###......', '........####.###......', '............###.......', '............###.......', '............####......'].map((s) => row(s, DINO_W));
const LEGS_JUMP = ['........###..###......', '........###..###......', '........###..###......', '........###..###......', '........###..###......', '........####.####.....'].map((s) => row(s, DINO_W));
// olho em X (morto): 5 furinhos no quadrado 3×3 da cabeça
const DEAD_HOLES = [[15, 0], [17, 0], [16, 1], [15, 2], [17, 2]];

const DUCK_W = 30;
const DINO_DUCK_A = [
  '.....................########',
  '.....................##.#####',
  '.....................########',
  '#....................####....',
  '##.......##############.#####',
  '####....################.....',
  '.###################.####...',
  '..##################.####...',
  '...###############..##.......',
  '....#############............',
  '.....###..###................',
  '.....###..###................',
  '.....###..####...............',
  '.....####.....................',
].map((s) => row(s, DUCK_W));
const DINO_DUCK_B = DINO_DUCK_A.slice(0, 10).concat([
  '.....###..###................',
  '.....####.###................',
  '..........###................',
  '..........####...............',
]).map((s) => row(s, DUCK_W));

const BIRD_W = 26;
const BIRD_UP = [
  '..........#...............',
  '..........##.........#....',
  '.........###........##....',
  '........####.......###....',
  '.......#####......####....',
  '......##########.#####....',
  '.....###########.######...',
  '....#############.#####...',
  '...####################..',
  '..###################.....',
  '.....###########.........',
  '.........####............',
].map((s) => row(s, BIRD_W));
const BIRD_DOWN = [
  '..........................',
  '...........###............',
  '....................##....',
  '......#########....####...',
  '.....###########.######...',
  '....#############.#######.',
  '...####################..',
  '..######################.',
  '.....###########.....##...',
  '........#######......#....',
  '.......#####..............',
  '......###.................',
].map((s) => row(s, BIRD_W));

function styleOf() {
  const id = document.documentElement.getAttribute('data-theme');
  if (id === 'dino-jurassico') return 'jurassic';
  return 'classic';
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function rand(a, b) {
  return a + Math.random() * (b - a);
}

export function createDinoGame(canvas, { onScoreChange, onGameOver }) {
  const ctx = canvas.getContext('2d');
  canvas.style.touchAction = 'none';
  const W = canvas.width;
  const H = canvas.height;
  const GROUND_Y = H - 30; // linha do chão (topo dos pés)

  let dino; // { y, vy, onGround, duck, runT }
  let obstacles; // { kind:'cactus'|'bird', x, y, w, h, ...}
  let clouds, bumps, stars, embers;
  let speed, distance, score, lastReported;
  let nextSpawnX; // quando o obstáculo mais à direita passar disso, nasce outro
  let jumpHeld = false;
  let duckHeld = false;
  let raf = null;
  let running = false;
  let paused = true;
  let dead = false;
  let lastTimestamp = null;
  let colors = readThemeColors();
  let style = styleOf();
  let night = false;
  let nightT = 0; // 0 dia ... 1 noite (transição suave)
  let nextNightAt = NIGHT_EVERY;
  let milestoneBlinkUntil = 0;
  let milestoneValue = 0;
  let overTimer = null;
  let shakeUntil = 0;
  let dust = [];

  // ---------- geometria ----------
  function dinoBox() {
    if (dino.duck && dino.onGround) return { x: DINO_X + 6, y: GROUND_Y - 24, w: 44, h: 24 };
    return { x: DINO_X + 9, y: dino.y - 42, w: 26, h: 42 };
  }
  // tempo de um pulo completo em quadros e a distância que ele cobre na velocidade atual
  function airtime() {
    return (2 * -JUMP_V) / GRAVITY;
  }
  function minGapFor(width) {
    // deixa o dino pousar e reagir antes do próximo: ~80% do alcance de um pulo + margem
    return width + airtime() * speed * 0.8 + 36;
  }

  function reset() {
    dino = { y: GROUND_Y, vy: 0, onGround: true, duck: false, runT: 0 };
    obstacles = [];
    clouds = [];
    for (let i = 0; i < 4; i++) clouds.push({ x: rand(0, W), y: rand(20, 80), s: rand(0.6, 1.1) });
    bumps = [];
    for (let x = 0; x < W + 40; x += rand(20, 70)) bumps.push({ x, w: rand(2, 9), dy: Math.floor(rand(3, 12)) });
    stars = [];
    for (let i = 0; i < 34; i++) stars.push({ x: rand(0, W), y: rand(8, GROUND_Y - 40), s: Math.random() < 0.3 ? 2 : 1, t: rand(0, 6) });
    embers = [];
    speed = SPEED_START;
    distance = 0;
    score = 0;
    lastReported = 0;
    nextSpawnX = W + 240;
    jumpHeld = false;
    duckHeld = false;
    dead = false;
    night = false;
    nightT = 0;
    nextNightAt = NIGHT_EVERY;
    milestoneBlinkUntil = 0;
    lastTimestamp = null;
    shakeUntil = 0;
    dust = [];
    clearTimeout(overTimer);
  }

  // ---------- obstáculos ----------
  function spawnObstacle() {
    const canBird = score >= BIRD_FROM_SCORE;
    const birdChance = clamp(0.22 + (score - BIRD_FROM_SCORE) / 4000, 0.22, 0.42);
    let o;
    if (canBird && Math.random() < birdChance) {
      // 3 alturas: baixa (pula), média (abaixa), alta (passa por cima de nada: dá pra correr por baixo)
      const lane = [GROUND_Y - 22, GROUND_Y - 52, GROUND_Y - 84][Math.floor(Math.random() * 3)];
      o = { kind: 'bird', x: W + 20, y: lane, w: 44, h: 22, extra: rand(0.4, 1.4), t: 0 };
    } else {
      const big = Math.random() < 0.45;
      const count = 1 + Math.floor(Math.random() * (score > 1200 ? 3 : 2));
      const unitW = big ? 24 : 16;
      const h = big ? 50 : 34;
      o = { kind: 'cactus', x: W + 20, y: GROUND_Y - h, w: unitW * count + (count - 1) * 4, h, count, unitW, big };
    }
    obstacles.push(o);
    const gap = minGapFor(o.w) * (1 + Math.random() * 0.85);
    nextSpawnX = o.x + o.w + gap; // posição do PRÓXIMO nascimento, relativa ao x do obstáculo novo
  }

  function updateObstacles(dt) {
    obstacles.forEach((o) => {
      o.x -= (speed + (o.extra || 0)) * dt;
      if (o.kind === 'bird') o.t += dt;
    });
    nextSpawnX -= speed * dt;
    obstacles = obstacles.filter((o) => o.x + o.w > -10);
    if (nextSpawnX <= W) spawnObstacle();
  }

  function collides() {
    const d = dinoBox();
    return obstacles.some((o) => {
      // caixa um pouco menor que o desenho -- colisão "justa"
      const ox = o.x + 3;
      const oy = o.y + 3;
      const ow = o.w - 6;
      const oh = o.h - 5;
      return d.x < ox + ow && d.x + d.w > ox && d.y < oy + oh && d.y + d.h > oy;
    });
  }

  // ---------- lógica ----------
  function jump() {
    if (!dino.onGround || dead) return;
    dino.vy = JUMP_V;
    dino.onGround = false;
    dino.duck = false;
    sfx.jump();
  }

  function updateDino(dt) {
    if (dino.onGround) {
      dino.duck = duckHeld;
      dino.runT += dt * (speed / 6);
      if (jumpHeld) jump();
    } else {
      let g = GRAVITY;
      if (duckHeld) g *= FAST_FALL; // ↓ no ar: cai rápido
      dino.vy += g * dt;
      dino.y += dino.vy * dt;
      if (dino.y >= GROUND_Y) {
        dino.y = GROUND_Y;
        dino.vy = 0;
        dino.onGround = true;
        for (let i = 0; i < 5; i++) dust.push({ x: DINO_X + 22 + rand(-8, 8), y: GROUND_Y, vx: rand(-1.8, 0.6), vy: rand(-1.2, -0.2), life: 1 });
      }
    }
  }

  function updateWorld(dt) {
    distance += speed * dt;
    speed = Math.min(SPEED_MAX, speed + SPEED_ACCEL * dt);
    const newScore = Math.floor(distance * SCORE_PER_PX * 6);
    if (newScore !== score) {
      score = newScore;
      if (score !== lastReported) {
        lastReported = score;
        onScoreChange && onScoreChange(score);
      }
      if (score >= milestoneValue + MILESTONE && Math.floor(score / MILESTONE) > Math.floor(milestoneValue / MILESTONE)) {
        milestoneValue = score;
        milestoneBlinkUntil = Date.now() + 700;
        sfx.milestone();
      }
      if (score >= nextNightAt) {
        night = !night;
        nextNightAt += NIGHT_EVERY;
      }
    }
    // dia <-> noite suave
    const target = night ? 1 : 0;
    nightT += clamp(target - nightT, -0.012 * dt, 0.012 * dt);

    clouds.forEach((c) => {
      c.x -= (0.3 + c.s * 0.25) * dt * (speed / 6);
      if (c.x < -60) {
        c.x = W + rand(10, 100);
        c.y = rand(20, 80);
      }
    });
    bumps.forEach((b) => {
      b.x -= speed * dt;
    });
    if (bumps.length && bumps[0].x < -20) {
      bumps.shift();
      const last = bumps[bumps.length - 1];
      bumps.push({ x: last.x + rand(20, 70), w: rand(2, 9), dy: Math.floor(rand(3, 12)) });
    }
    if (style === 'jurassic') {
      if (Math.random() < 0.35 * dt) embers.push({ x: rand(0, W), y: GROUND_Y + rand(0, 8), vy: rand(0.4, 1.3), vx: rand(-0.3, 0.3), life: 1, s: Math.random() < 0.3 ? 2 : 1 });
      if (embers.length > 70) embers.splice(0, embers.length - 70);
    }
    embers.forEach((e) => {
      e.x += (e.vx - speed * 0.12) * dt;
      e.y -= e.vy * dt;
      e.life -= 0.007 * dt;
    });
    embers = embers.filter((e) => e.life > 0 && e.y > -4);
    dust.forEach((d) => {
      d.x += d.vx * dt - speed * 0.5 * dt;
      d.y += d.vy * dt;
      d.life -= 0.05 * dt;
    });
    dust = dust.filter((d) => d.life > 0);
  }

  // ---------- desenho ----------
  function blit(sprite, x, y, color, mask) {
    ctx.fillStyle = color;
    for (let r = 0; r < sprite.length; r++) {
      const line = sprite[r];
      let c = 0;
      while (c < line.length) {
        if (line[c] === '#') {
          let e = c;
          while (e < line.length && line[e] === '#') e++;
          ctx.fillRect(x + c * PX, y + r * PX, (e - c) * PX, PX);
          c = e;
        } else c++;
      }
    }
    if (mask) {
      ctx.fillStyle = mask.color;
      mask.holes.forEach(([cx, cy]) => ctx.fillRect(x + cx * PX, y + cy * PX, PX, PX));
    }
  }

  function dinoColor() {
    if (style === 'jurassic') return '#f1e6cf';
    return colors.ink;
  }
  function obstacleColor() {
    if (style === 'jurassic') return '#5a1d10';
    return colors.inkDim;
  }

  function drawDino() {
    const color = dinoColor();
    ctx.save();
    if (style === 'jurassic') {
      ctx.shadowColor = '#ff5a2e';
      ctx.shadowBlur = 10;
    }
    if (dead) {
      blit(DINO_BODY.concat(LEGS_JUMP), DINO_X, dino.y - 48, color, { color: colors.bg, holes: DEAD_HOLES });
    } else if (dino.duck && dino.onGround) {
      const f = Math.floor(dino.runT / 4) % 2 ? DINO_DUCK_A : DINO_DUCK_B;
      blit(f, DINO_X, GROUND_Y - f.length * PX, color);
    } else if (!dino.onGround) {
      blit(DINO_BODY.concat(LEGS_JUMP), DINO_X, dino.y - 48, color);
    } else {
      const legs = Math.floor(dino.runT / 4) % 2 ? LEGS_A : LEGS_B;
      blit(DINO_BODY.concat(legs), DINO_X, GROUND_Y - 48, color);
    }
    ctx.restore();
  }

  function drawCactus(o) {
    const color = obstacleColor();
    ctx.save();
    if (style === 'jurassic') {
      ctx.shadowColor = '#ff7a3a';
      ctx.shadowBlur = 6;
    }
    ctx.fillStyle = color;
    for (let i = 0; i < o.count; i++) {
      const x = o.x + i * (o.unitW + 4);
      const trunk = o.big ? 10 : 7;
      const tx = x + (o.unitW - trunk) / 2;
      if (style === 'jurassic') {
        // espinho de pedra vulcânica: triângulos empilhados
        ctx.beginPath();
        ctx.moveTo(x, o.y + o.h);
        ctx.lineTo(x + o.unitW * 0.5, o.y);
        ctx.lineTo(x + o.unitW, o.y + o.h);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(x - 2, o.y + o.h - 4, o.unitW + 4, 4);
        ctx.fillStyle = '#ff6a2e';
        ctx.globalAlpha = 0.65;
        ctx.fillRect(x + o.unitW * 0.5 - 1, o.y + 6, 2, o.h - 10);
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        continue;
      }
      ctx.fillRect(tx, o.y, trunk, o.h);
      ctx.fillRect(tx + 1, o.y - 2, trunk - 2, 2); // topo arredondado
      // braços
      const armY = o.y + o.h * 0.32;
      ctx.fillRect(tx - 6, armY, 6, 4);
      ctx.fillRect(tx - 6, armY - 8, 4, 12);
      ctx.fillRect(tx + trunk, armY + 8, 6, 4);
      ctx.fillRect(tx + trunk + 2, armY, 4, 12);
    }
    ctx.restore();
  }

  function drawBird(o) {
    const f = Math.floor(o.t / 8) % 2 ? BIRD_UP : BIRD_DOWN;
    ctx.save();
    if (style === 'jurassic') {
      ctx.shadowColor = '#ff7a3a';
      ctx.shadowBlur = 8;
    }
    blit(f, o.x - 4, o.y - 6, style === 'jurassic' ? '#ff6a2e' : obstacleColor());
    ctx.restore();
  }

  function drawSky() {
    if (style === 'jurassic') {
      const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
      g.addColorStop(0, '#12070a');
      g.addColorStop(0.7, '#2e1009');
      g.addColorStop(1, '#5a1c0c');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // vulcões ao fundo (paralaxe lenta) com brilho de lava
      const off = (distance * 0.12) % (W + 120);
      for (let k = 0; k < 2; k++) {
        const bx = ((k * (W / 1.4) - off) % (W + 120)) - 60 + (k === 0 ? 0 : 0);
        const x0 = bx < -120 ? bx + W + 120 : bx;
        ctx.fillStyle = '#1c0b0a';
        ctx.beginPath();
        ctx.moveTo(x0, GROUND_Y);
        ctx.lineTo(x0 + 70, GROUND_Y - 78);
        ctx.lineTo(x0 + 90, GROUND_Y - 74);
        ctx.lineTo(x0 + 170, GROUND_Y);
        ctx.closePath();
        ctx.fill();
        const lava = ctx.createRadialGradient(x0 + 80, GROUND_Y - 76, 2, x0 + 80, GROUND_Y - 76, 38);
        lava.addColorStop(0, 'rgba(255,120,40,0.85)');
        lava.addColorStop(1, 'rgba(255,60,20,0)');
        ctx.fillStyle = lava;
        ctx.fillRect(x0 + 30, GROUND_Y - 120, 100, 80);
      }
      return;
    }
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, H);
  }

  function drawClouds() {
    if (style === 'jurassic') {
      ctx.fillStyle = 'rgba(70,24,16,0.55)';
    } else {
      ctx.fillStyle = colors.line;
    }
    clouds.forEach((c) => {
      const w = 46 * c.s;
      ctx.fillRect(c.x, c.y + 6 * c.s, w, 5 * c.s);
      ctx.fillRect(c.x + 8 * c.s, c.y + 2 * c.s, w * 0.5, 5 * c.s);
      ctx.fillRect(c.x + 16 * c.s, c.y - 2 * c.s, w * 0.25, 5 * c.s);
    });
  }

  function drawStarsAndMoon() {
    if (nightT <= 0.02 || style === 'jurassic') return;
    ctx.save();
    ctx.globalAlpha = nightT * 0.9;
    ctx.fillStyle = colors.ink;
    stars.forEach((s) => {
      const tw = 0.6 + 0.4 * Math.sin(Date.now() / 600 + s.t);
      ctx.globalAlpha = nightT * tw;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    });
    ctx.globalAlpha = nightT;
    ctx.fillStyle = colors.ink;
    ctx.beginPath();
    ctx.arc(W - 90, 44, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colors.bg;
    ctx.beginPath();
    ctx.arc(W - 84, 41, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawGround() {
    const lineColor = style === 'jurassic' ? '#ff6a2e' : colors.inkDim;
    ctx.fillStyle = style === 'jurassic' ? '#1a0a08' : colors.bg;
    if (style === 'jurassic') ctx.fillRect(0, GROUND_Y + 2, W, H - GROUND_Y);
    ctx.fillStyle = lineColor;
    if (style === 'jurassic') {
      ctx.save();
      ctx.shadowColor = '#ff5a2e';
      ctx.shadowBlur = 8;
      ctx.fillRect(0, GROUND_Y + 1, W, 2);
      ctx.restore();
    } else {
      ctx.fillRect(0, GROUND_Y + 1, W, 2);
    }
    // texturinha do chão: tracinhos que passam
    ctx.fillStyle = style === 'jurassic' ? '#7a2a14' : colors.line;
    bumps.forEach((b) => ctx.fillRect(b.x, GROUND_Y + 3 + b.dy, b.w, 2));
    if (style === 'jurassic') {
      // veios de lava pulsando no chão
      ctx.fillStyle = '#ff5a2e';
      ctx.globalAlpha = 0.5 + 0.25 * Math.sin(Date.now() / 300);
      bumps.forEach((b, i) => {
        if (i % 3 === 0) ctx.fillRect(b.x, GROUND_Y + 6 + (i % 4) * 4, b.w + 4, 1);
      });
      ctx.globalAlpha = 1;
    }
  }

  function drawEmbers() {
    if (!embers.length) return;
    ctx.save();
    embers.forEach((e) => {
      ctx.globalAlpha = Math.max(0, e.life);
      ctx.fillStyle = e.life > 0.6 ? '#ffd27a' : '#ff6a2e';
      ctx.fillRect(e.x, e.y, e.s, e.s);
    });
    ctx.restore();
  }

  function drawDust() {
    ctx.fillStyle = style === 'jurassic' ? '#7a2a14' : colors.inkDim;
    dust.forEach((d) => {
      ctx.globalAlpha = Math.max(0, d.life);
      ctx.fillRect(d.x, d.y, 2, 2);
    });
    ctx.globalAlpha = 1;
  }

  function drawHud() {
    // velocidade: tracinhos no canto (mostra o ritmo sem competir com o placar do overlay)
    const bars = Math.round(((speed - SPEED_START) / (SPEED_MAX - SPEED_START)) * 8);
    ctx.fillStyle = colors.inkDim;
    for (let i = 0; i < 8; i++) {
      ctx.globalAlpha = i < bars ? 0.9 : 0.25;
      ctx.fillRect(12 + i * 6, 12, 4, 7);
    }
    ctx.globalAlpha = 1;
    if (milestoneBlinkUntil > Date.now() && Math.floor(Date.now() / 110) % 2 === 0) {
      ctx.fillStyle = colors.warn;
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.floor(score / MILESTONE) * MILESTONE), W - 14, 18);
    }
  }

  function drawOverlayText(lines, y) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, y - 22, W, 44);
    ctx.fillStyle = '#f2f2f2';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(lines[0], W / 2, y - 8);
    ctx.fillText(lines[1], W / 2, y + 9);
    ctx.restore();
  }

  function lightBackground() {
    // luminância do fundo a partir da cor normalizada pelo próprio canvas (#rrggbb)
    ctx.fillStyle = colors.bg;
    const c = String(ctx.fillStyle);
    if (c[0] !== '#' || c.length < 7) return false;
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 150;
  }

  function draw() {
    colors = readThemeColors();
    style = styleOf();
    const now = Date.now();
    ctx.save();
    if (shakeUntil > now) {
      const k = (shakeUntil - now) / 300;
      ctx.translate((Math.random() - 0.5) * 6 * k, (Math.random() - 0.5) * 6 * k);
    }
    drawSky();
    drawStarsAndMoon();
    drawClouds();
    drawGround();
    drawEmbers();
    obstacles.forEach((o) => (o.kind === 'bird' ? drawBird(o) : drawCactus(o)));
    drawDust();
    drawDino();
    ctx.restore();
    // noite: tema claro INVERTE as cores (igual o original do Chrome); tema escuro só escurece
    if (nightT > 0.02 && style !== 'jurassic') {
      if (lightBackground()) {
        ctx.save();
        ctx.globalCompositeOperation = 'difference';
        ctx.globalAlpha = nightT;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      } else {
        ctx.fillStyle = `rgba(0,0,0,${0.32 * nightT})`;
        ctx.fillRect(0, 0, W, H);
      }
    }
    if (style === 'jurassic') {
      // erupção a cada ciclo: clarão avermelhado que pulsa
      const flashK = Math.max(0, Math.sin(distance / 900)) ** 8;
      if (flashK > 0.02) {
        ctx.fillStyle = `rgba(255,70,20,${0.16 * flashK})`;
        ctx.fillRect(0, 0, W, H);
      }
    }
    drawHud();
    if (paused) drawOverlayText(['espaço / ↑ / clique pula · ↓ abaixa', 'pule os cactos e passe por baixo dos pterodátilos'], 56);
  }

  // ---------- laço ----------
  function die() {
    dead = true;
    shakeUntil = Date.now() + 300;
    sfx.gameOver();
    draw();
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    // um instantinho com o dino caído antes de mostrar o fim de jogo
    overTimer = setTimeout(() => {
      onGameOver && onGameOver(score);
    }, GAME_OVER_DELAY_MS);
  }

  function tick(timestamp) {
    if (!running) return;
    const dt = lastTimestamp === null ? 1 : Math.min((timestamp - lastTimestamp) / REF_FRAME_MS, MAX_DT_FRAMES);
    lastTimestamp = timestamp;
    updateDino(dt);
    updateWorld(dt);
    updateObstacles(dt);
    if (collides()) {
      die();
      return;
    }
    draw();
    raf = requestAnimationFrame(tick);
  }

  // ---------- entrada ----------
  function begin() {
    if (!paused) return;
    paused = false;
    raf = requestAnimationFrame(tick);
  }
  const isJump = (k) => k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W';
  const isDuck = (k) => k === 'ArrowDown' || k === 's' || k === 'S';
  function handleKey(e) {
    if (!isJump(e.key) && !isDuck(e.key)) return;
    e.preventDefault();
    begin();
    if (isJump(e.key)) {
      jumpHeld = true;
      jump();
    }
    if (isDuck(e.key)) duckHeld = true;
  }
  function handleKeyUp(e) {
    if (isJump(e.key)) {
      jumpHeld = false;
      // soltou cedo com o dino subindo: corta o pulo (pulinho curto)
      if (dino && !dino.onGround && dino.vy < 0) dino.vy *= JUMP_CUT;
    }
    if (isDuck(e.key)) duckHeld = false;
  }
  function handleClick() {
    begin();
    jump();
  }

  function start() {
    reset();
    paused = true;
    milestoneValue = 0;
    draw();
    onScoreChange && onScoreChange(score);
    running = true;
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    clearTimeout(overTimer);
  }

  return { start, stop, handleKey, handleKeyUp, handleClick, get running() { return running; } };
}
