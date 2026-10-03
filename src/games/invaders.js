// Easter egg — Space Invaders em canvas puro, sem lib externa. Uma
// formação de 55 invasores (3 tipos, 2 quadros de animação cada) marcha
// de um lado pro outro e DESCE a cada vez que bate numa borda; quanto
// menos sobram, mais rápido marcham. Você move o canhão (◄ ► / A D / mouse
// / dedo) e atira (espaço / clique) -- um tiro na tela por vez, como no
// original. Quatro abrigos de pixels que erodem (com seus tiros também) e
// um disco misterioso que cruza o topo valendo 50-300. 3 vidas, vida extra
// a cada 2.000 pontos, ondas cada vez mais rápidas e começando mais baixo.
// Os invasores chegando na linha do canhão = fim de jogo na hora.
//
// Física contínua via requestAnimationFrame com delta-time normalizado
// (ver flappy.js). Os tiros andam em SUB-PASSOS curtos (no máx. ~3px) pra
// nunca atravessar um invasor (16px) ou um pixel de abrigo (2px) quando um
// quadro vier lento. A marcha dos invasores é contada em quadros de
// referência (não em setInterval), então acompanha o dt também.
//
// O visual muda com o tema ativo (ver `styleOf`): os dois temas especiais
// ganham pintura própria (invasão alienígena em lima ácido sobre violeta /
// gibi em quadrinhos com contorno grosso e "POW!"); os demais ficam no
// clássico com celofane colorido, como nos fliperamas de 1978.
import { readThemeColors } from './theme.js';
import { sfx } from './sound.js';

const REF_FRAME_MS = 1000 / 60;
const MAX_DT_FRAMES = 4;
const MAX_STEP_PX = 3;

const COLS = 11;
const ROWS = 5;
const CELL_W = 26;
const CELL_H = 22;
const PX = 2;
const MARCH_DX = 6;
const DROP_DY = 10;
const MARGIN_X = 10;
const FORM_TOP = 74;
const UFO_Y = 40;
const CANNON_Y_FROM_BOTTOM = 34;
const BUNKER_Y_FROM_BOTTOM = 96;
const CANNON_SPEED = 3.4;
const POINTER_SPEED = 7;
const PLAYER_BULLET_SPEED = 8;
const LIVES_START = 3;
const EXTRA_LIFE_EVERY = 2000;
const ROW_SCORE = [30, 20, 20, 10, 10];
const UFO_SCORES = [50, 100, 150, 300];

// ---------------- pixel-art (11/12 colunas × 8 linhas, '#' = cheio) ----------------
const SQUID = [
  ['...##...', '..####..', '.######.', '##.##.##', '########', '..#..#..', '.#.##.#.', '#.#..#.#'],
  ['...##...', '..####..', '.######.', '##.##.##', '########', '.#.##.#.', '#......#', '.#....#.'],
];
const CRAB = [
  ['..#.....#..', '...#...#...', '..#######..', '.##.###.##.', '###########', '#.#######.#', '#.#.....#.#', '...##.##...'],
  ['..#.....#..', '#..#...#..#', '#.#######.#', '###.###.###', '###########', '.#########.', '..#.....#..', '.#.......#.'],
];
const OCTO = [
  ['....####....', '.##########.', '############', '###..##..###', '############', '...##..##...', '..##.##.##..', '##........##'],
  ['....####....', '.##########.', '############', '###..##..###', '############', '..###..###..', '.##..##..##.', '..##....##..'],
];
const TYPES = [SQUID, CRAB, CRAB, OCTO, OCTO]; // por linha da formação
const CANNON = ['......#......', '.....###.....', '.....###.....', '.###########.', '#############', '#############', '#############', '#############'];
const UFO_SPRITE = ['.....######.....', '...##########...', '..############..', '.##.##.##.##.##.', '################', '..###..##..###..', '...#........#...'];
const BOOM = ['....#...#....', '#....#.#....#', '.#..#...#..#.', '..#.......#..', '##.........##', '..#.......#..', '.#..#...#..#.', '#..#..#..#..#'];

const BUNKER_COLS = 22;
const BUNKER_ROWS = 16;
const BUNKER_CELL = 2;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function rand(a, b) {
  return a + Math.random() * (b - a);
}
function styleOf() {
  const id = document.documentElement.getAttribute('data-theme');
  if (id === 'invaders-alien') return 'alien';
  if (id === 'invaders-gibi') return 'gibi';
  return 'classic';
}

export function createInvadersGame(canvas, { onScoreChange, onGameOver }) {
  const ctx = canvas.getContext('2d');
  canvas.style.touchAction = 'none';
  const W = canvas.width;
  const H = canvas.height;
  const CANNON_Y = H - CANNON_Y_FROM_BOTTOM;
  const BUNKER_Y = H - BUNKER_Y_FROM_BOTTOM;
  const INVADE_Y = BUNKER_Y + 6; // alien com a base além disso = invadiu

  let aliens; // { row, col, alive }
  let formX, formY, formDir, marchTimer, animFrame, marchNote;
  let pBullet; // null | {x,y}
  let aBullets;
  let ufo; // null | { x, vx, score }
  let ufoTimer;
  let bunkers; // [{ x, cells: Uint8Array }]
  let cannon; // { x, alive, deadT, invuln }
  let particles, popups;
  let score, lives, wave, nextExtra;
  let moveL = false;
  let moveR = false;
  let firing = false;
  let pointerTargetX = null;
  let shootTimer;
  let raf = null;
  let running = false;
  let paused = true;
  let lastTimestamp = null;
  let colors = readThemeColors();
  let style = styleOf();
  let waveTimer = 0;
  let gameOverAt = 0;
  let flashText = '';
  let flashUntil = 0;
  let stars = [];
  let shakeUntil = 0;
  let aliveCount = 0;
  let totalAtStart = ROWS * COLS;

  // ---------- abrigos ----------
  function makeBunker(x) {
    const cells = new Uint8Array(BUNKER_COLS * BUNKER_ROWS);
    for (let y = 0; y < BUNKER_ROWS; y++) {
      for (let c = 0; c < BUNKER_COLS; c++) {
        // cantos de cima chanfrados e um arco na base
        const corner = y < 5 && (c + y < 5 || c - y > BUNKER_COLS - 6);
        const notch = y >= 10 && c >= 6 && c <= 15 && !(y === 10 && (c < 8 || c > 13)) && !(y === 11 && (c < 7 || c > 14));
        cells[y * BUNKER_COLS + c] = corner || notch ? 0 : 1;
      }
    }
    return { x, cells };
  }
  function makeBunkers() {
    const gap = (W - 4 * BUNKER_COLS * BUNKER_CELL) / 5;
    bunkers = [];
    for (let i = 0; i < 4; i++) bunkers.push(makeBunker(gap + i * (BUNKER_COLS * BUNKER_CELL + gap)));
  }
  // apaga as células num raio em volta de um ponto; devolve se tinha algo ali
  function erodeAt(b, px, py, radius) {
    const cx = Math.floor((px - b.x) / BUNKER_CELL);
    const cy = Math.floor((py - BUNKER_Y) / BUNKER_CELL);
    let hit = false;
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let c = cx - radius; c <= cx + radius; c++) {
        if (c < 0 || y < 0 || c >= BUNKER_COLS || y >= BUNKER_ROWS) continue;
        // pontas do quadrado ficam de fora, e um tiquinho de sorte deixa a borda irregular
        const d = Math.hypot(c - cx, y - cy);
        if (d > radius + 0.2 || (d > radius - 0.8 && Math.random() < 0.35)) continue;
        if (b.cells[y * BUNKER_COLS + c]) {
          b.cells[y * BUNKER_COLS + c] = 0;
          hit = true;
        }
      }
    }
    return hit;
  }
  function bunkerCellAt(b, px, py) {
    const cx = Math.floor((px - b.x) / BUNKER_CELL);
    const cy = Math.floor((py - BUNKER_Y) / BUNKER_CELL);
    if (cx < 0 || cy < 0 || cx >= BUNKER_COLS || cy >= BUNKER_ROWS) return false;
    return b.cells[cy * BUNKER_COLS + cx] === 1;
  }
  // tiro (de quem for) contra os abrigos: se bater, corrói e some
  function bulletHitsBunker(px, py, radius) {
    if (py < BUNKER_Y - 2 || py > BUNKER_Y + BUNKER_ROWS * BUNKER_CELL + 2) return false;
    for (const b of bunkers) {
      if (px < b.x - 1 || px > b.x + BUNKER_COLS * BUNKER_CELL + 1) continue;
      if (bunkerCellAt(b, px, py)) {
        erodeAt(b, px, py, radius);
        return true;
      }
    }
    return false;
  }

  // ---------- formação ----------
  function newFormation() {
    aliens = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) aliens.push({ row: r, col: c, alive: true });
    aliveCount = aliens.length;
    totalAtStart = aliens.length;
    formX = (W - COLS * CELL_W) / 2;
    formY = FORM_TOP + Math.min(wave - 1, 5) * 12; // cada onda começa mais perto
    formDir = 1;
    marchTimer = 0;
    animFrame = 0;
    marchNote = 0;
  }
  function alienPos(a) {
    const w = TYPES[a.row][0][0].length * PX;
    return { x: formX + a.col * CELL_W + (CELL_W - w) / 2, y: formY + a.row * CELL_H, w, h: 8 * PX };
  }
  function marchInterval() {
    const frac = aliveCount / totalAtStart;
    const base = 4 + 40 * frac;
    return Math.max(3, base * (1 - Math.min(wave - 1, 7) * 0.05));
  }
  function formBounds() {
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    aliens.forEach((a) => {
      if (!a.alive) return;
      const p = alienPos(a);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x + p.w);
      maxY = Math.max(maxY, p.y + p.h);
    });
    return { minX, maxX, maxY };
  }

  function reset() {
    score = 0;
    lives = LIVES_START;
    wave = 1;
    nextExtra = EXTRA_LIFE_EVERY;
    pBullet = null;
    aBullets = [];
    ufo = null;
    ufoTimer = rand(18, 26) * 60;
    particles = [];
    popups = [];
    cannon = { x: W / 2, alive: true, deadT: 0, invuln: 0 };
    moveL = moveR = firing = false;
    pointerTargetX = null;
    shootTimer = 60;
    lastTimestamp = null;
    waveTimer = 0;
    gameOverAt = 0;
    flashText = '';
    flashUntil = 0;
    shakeUntil = 0;
    stars = [];
    for (let i = 0; i < 60; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, s: Math.random() < 0.2 ? 2 : 1, t: Math.random() * 6 });
    makeBunkers();
    newFormation();
  }

  // ---------- efeitos ----------
  function flash(text, ms = 1400) {
    flashText = text;
    flashUntil = Date.now() + ms;
  }
  function burst(x, y, count, speed = 2) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random());
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, decay: 0.03 + Math.random() * 0.03 });
    }
    if (particles.length > 200) particles.splice(0, particles.length - 200);
  }
  function popup(text, x, y) {
    popups.push({ text, x, y, life: 1 });
  }
  function addScore(points) {
    score += points;
    onScoreChange && onScoreChange(score);
    if (score >= nextExtra) {
      nextExtra += EXTRA_LIFE_EVERY;
      lives += 1;
      sfx.extraLife();
      flash('VIDA EXTRA!');
    }
  }

  // ---------- lógica ----------
  function killAlien(a) {
    a.alive = false;
    aliveCount -= 1;
    const p = alienPos(a);
    const pts = ROW_SCORE[a.row];
    addScore(pts);
    sfx.invaderDie();
    burst(p.x + p.w / 2, p.y + p.h / 2, 10, 2.1);
    popup(style === 'gibi' ? ['POW!', 'BAM!', 'ZAP!'][a.row % 3] : String(pts), p.x + p.w / 2, p.y);
  }

  function marchStep() {
    const b = formBounds();
    if (b.minX === Infinity) return;
    animFrame = 1 - animFrame;
    sfx.march(marchNote++);
    if ((formDir > 0 && b.maxX + MARCH_DX > W - MARGIN_X) || (formDir < 0 && b.minX - MARCH_DX < MARGIN_X)) {
      formY += DROP_DY;
      formDir = -formDir;
    } else {
      formX += MARCH_DX * formDir;
    }
    // invasores raspando nos abrigos destroem o que tocam
    aliens.forEach((a) => {
      if (!a.alive) return;
      const p = alienPos(a);
      if (p.y + p.h < BUNKER_Y) return;
      bunkers.forEach((bk) => {
        if (p.x + p.w < bk.x || p.x > bk.x + BUNKER_COLS * BUNKER_CELL) return;
        const c0 = Math.max(0, Math.floor((p.x - bk.x) / BUNKER_CELL));
        const c1 = Math.min(BUNKER_COLS - 1, Math.floor((p.x + p.w - bk.x) / BUNKER_CELL));
        const r0 = Math.max(0, Math.floor((p.y - BUNKER_Y) / BUNKER_CELL));
        const r1 = Math.min(BUNKER_ROWS - 1, Math.floor((p.y + p.h - BUNKER_Y) / BUNKER_CELL));
        for (let y = r0; y <= r1; y++) for (let c = c0; c <= c1; c++) bk.cells[y * BUNKER_COLS + c] = 0;
      });
    });
  }

  function alienShoot() {
    // sorteia uma coluna viva; atira o invasor mais baixo dela
    const cols = [];
    for (let c = 0; c < COLS; c++) {
      let lowest = null;
      aliens.forEach((a) => {
        if (a.alive && a.col === c && (!lowest || a.row > lowest.row)) lowest = a;
      });
      if (lowest) cols.push(lowest);
    }
    if (!cols.length) return;
    // 1 em 3 vezes mira a coluna do canhão (se tiver invasor lá), o resto é aleatório
    let shooter = cols[Math.floor(Math.random() * cols.length)];
    if (cannon.alive && Math.random() < 0.33) {
      const near = cols.reduce((best, a) => {
        const d = Math.abs(alienPos(a).x + 12 - cannon.x);
        return !best || d < best.d ? { a, d } : best;
      }, null);
      if (near) shooter = near.a;
    }
    const p = alienPos(shooter);
    aBullets.push({ x: p.x + p.w / 2, y: p.y + p.h, vy: 2.5 + Math.min(wave, 8) * 0.14, t: 0 });
  }

  function loseLife() {
    if (!cannon.alive) return;
    cannon.alive = false;
    cannon.deadT = 70;
    lives -= 1;
    aBullets.length = 0; // no lugar (updateAlienBullets está iterando esse mesmo array)
    pBullet = null;
    sfx.shipDie();
    shakeUntil = Date.now() + 360;
    burst(cannon.x, CANNON_Y, 26, 3);
    if (lives <= 0) {
      gameOverAt = Date.now() + 1500;
      flash('FIM DE JOGO', 2000);
    }
  }

  function updateCannon(dt) {
    if (!cannon.alive) {
      cannon.deadT -= dt;
      if (cannon.deadT <= 0 && lives > 0) {
        cannon.alive = true;
        cannon.x = W / 2;
        cannon.invuln = 100;
      }
      return;
    }
    if (cannon.invuln > 0) cannon.invuln -= dt;
    if (moveL || moveR) {
      pointerTargetX = null;
      if (moveL) cannon.x -= CANNON_SPEED * dt;
      if (moveR) cannon.x += CANNON_SPEED * dt;
    } else if (pointerTargetX !== null) {
      const diff = pointerTargetX - cannon.x;
      const m = POINTER_SPEED * dt;
      cannon.x += clamp(diff, -m, m);
    }
    cannon.x = clamp(cannon.x, 16, W - 16);
    if (firing) fire();
  }

  function fire() {
    if (!cannon.alive || pBullet) return;
    pBullet = { x: cannon.x, y: CANNON_Y - 10 };
    sfx.laser();
  }

  function updatePlayerBullet(dt) {
    if (!pBullet) return;
    const steps = Math.max(1, Math.ceil((PLAYER_BULLET_SPEED * dt) / MAX_STEP_PX));
    for (let s = 0; s < steps && pBullet; s++) {
      pBullet.y -= (PLAYER_BULLET_SPEED * dt) / steps;
      const { x, y } = pBullet;
      if (y < 20) {
        burst(x, 20, 4, 1.2);
        pBullet = null;
        break;
      }
      // abrigos
      if (bulletHitsBunker(x, y, 2)) {
        pBullet = null;
        break;
      }
      // disco misterioso
      if (ufo && x > ufo.x - 16 && x < ufo.x + 16 && y > UFO_Y - 6 && y < UFO_Y + 10) {
        addScore(ufo.score);
        popup(style === 'gibi' ? 'BAM!' : String(ufo.score), ufo.x, UFO_Y);
        burst(ufo.x, UFO_Y, 18, 2.6);
        sfx.ufoHit();
        ufo = null;
        ufoTimer = rand(20, 30) * 60;
        pBullet = null;
        break;
      }
      // invasores
      for (const a of aliens) {
        if (!a.alive) continue;
        const p = alienPos(a);
        if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) {
          killAlien(a);
          pBullet = null;
          break;
        }
      }
      // tiro alienígena no caminho: os dois se anulam
      if (pBullet) {
        const idx = aBullets.findIndex((b) => Math.abs(b.x - x) < 3 && Math.abs(b.y - y) < 6);
        if (idx >= 0) {
          aBullets.splice(idx, 1);
          burst(x, y, 6, 1.4);
          pBullet = null;
        }
      }
    }
  }

  function updateAlienBullets(dt) {
    for (let i = aBullets.length - 1; i >= 0; i--) {
      const b = aBullets[i];
      if (!b) continue; // o array pode ter sido esvaziado no meio do laço (canhão atingido)
      b.t += dt;
      const steps = Math.max(1, Math.ceil((b.vy * dt) / MAX_STEP_PX));
      let dead = false;
      for (let s = 0; s < steps && !dead; s++) {
        b.y += (b.vy * dt) / steps;
        if (b.y > H - 8) {
          burst(b.x, H - 8, 4, 1.2);
          dead = true;
          break;
        }
        if (bulletHitsBunker(b.x, b.y + 6, 2)) {
          dead = true;
          break;
        }
        if (cannon.alive && cannon.invuln <= 0 && b.y + 6 >= CANNON_Y && b.y <= CANNON_Y + 8 * PX && Math.abs(b.x - cannon.x) < 13) {
          loseLife();
          dead = true;
          break;
        }
      }
      if (dead) aBullets.splice(i, 1);
    }
  }

  function updateFormation(dt) {
    if (aliveCount <= 0) return;
    marchTimer += dt;
    const iv = marchInterval();
    if (marchTimer >= iv) {
      marchTimer -= iv;
      marchStep();
    }
    // invasão: a base de algum invasor chegou na linha dos abrigos/canhão
    const b = formBounds();
    if (b.maxY >= INVADE_Y && cannon.alive && !gameOverAt) {
      lives = 0;
      cannon.alive = false;
      cannon.deadT = 999;
      sfx.shipDie();
      shakeUntil = Date.now() + 420;
      burst(cannon.x, CANNON_Y, 30, 3.2);
      gameOverAt = Date.now() + 1500;
      flash('INVASÃO!', 2000);
      return;
    }
    // tiros dos invasores
    shootTimer -= dt;
    if (shootTimer <= 0) {
      const maxBullets = 2 + Math.min(wave, 3);
      if (aBullets.length < maxBullets && cannon.alive) alienShoot();
      shootTimer = Math.max(22, 66 - wave * 5 - (1 - aliveCount / totalAtStart) * 22) * rand(0.6, 1.3);
    }
  }

  function updateUfo(dt) {
    if (!ufo) {
      if (aliveCount >= 8 && !waveTimer) ufoTimer -= dt;
      if (ufoTimer <= 0) {
        const fromLeft = Math.random() < 0.5;
        ufo = { x: fromLeft ? -20 : W + 20, vx: (fromLeft ? 1 : -1) * 1.5, score: UFO_SCORES[Math.floor(Math.random() * UFO_SCORES.length)], snd: 0 };
      }
      return;
    }
    ufo.x += ufo.vx * dt;
    ufo.snd -= dt;
    if (ufo.snd <= 0) {
      sfx.ufo(false);
      ufo.snd = 12;
    }
    if (ufo.x < -30 || ufo.x > W + 30) {
      ufo = null;
      ufoTimer = rand(20, 30) * 60;
    }
  }

  function updateParticles(dt) {
    particles.forEach((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= p.decay * dt;
    });
    particles = particles.filter((p) => p.life > 0);
    popups.forEach((p) => {
      p.y -= 0.5 * dt;
      p.life -= 0.02 * dt;
    });
    popups = popups.filter((p) => p.life > 0);
  }

  function updateWave(dt) {
    if (aliveCount <= 0 && !waveTimer && !gameOverAt) {
      waveTimer = 100;
      const bonus = wave * 50;
      addScore(bonus);
      flash(`ONDA ${wave} LIMPA  +${bonus}`);
      aBullets = [];
    }
    if (waveTimer > 0) {
      waveTimer -= dt;
      if (waveTimer <= 0) {
        waveTimer = 0;
        wave += 1;
        makeBunkers();
        newFormation();
        shootTimer = 70;
      }
    }
  }

  // ---------- desenho ----------
  function blit(rows, x, y, color, outline) {
    if (outline) {
      ctx.fillStyle = outline;
      [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([ox, oy]) => paint(rows, x + ox * 1.5, y + oy * 1.5));
    }
    ctx.fillStyle = color;
    paint(rows, x, y);
  }
  function paint(rows, x, y) {
    for (let r = 0; r < rows.length; r++) {
      const line = rows[r];
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
  }

  function palette() {
    if (style === 'alien') {
      return { rows: ['#ff4fd8', '#b6ff3c', '#b6ff3c', '#5ce1ff', '#5ce1ff'], cannon: '#e8ffd0', bunker: '#8a5cff', bullet: '#ff4fd8', ufo: '#ffd93d', outline: null };
    }
    if (style === 'gibi') {
      return { rows: ['#e0402a', '#f2b01e', '#f2b01e', '#2b6fe0', '#2b6fe0'], cannon: '#1f9d55', bunker: '#7a4cc0', bullet: '#111', ufo: '#e0402a', outline: '#111' };
    }
    return { rows: [colors.ink, colors.ink, colors.ink, colors.ink, colors.ink], cannon: colors.accent, bunker: colors.inkDim, bullet: colors.ink, ufo: colors.danger, outline: null };
  }

  function drawBackground() {
    if (style === 'alien') {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, colors.bg);
      g.addColorStop(1, colors.panel);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      const now = Date.now();
      stars.forEach((s) => {
        ctx.globalAlpha = 0.25 + 0.5 * Math.abs(Math.sin(now / 700 + s.t));
        ctx.fillStyle = colors.ink;
        ctx.fillRect(s.x, s.y, s.s, s.s);
      });
      ctx.globalAlpha = 1;
      // planeta no horizonte (brilho verde ácido)
      const pl = ctx.createRadialGradient(W * 0.5, H + 30, 20, W * 0.5, H + 30, 190);
      pl.addColorStop(0, 'rgba(182,255,60,0.22)');
      pl.addColorStop(1, 'rgba(182,255,60,0)');
      ctx.fillStyle = pl;
      ctx.fillRect(0, H - 190, W, 190);
      return;
    }
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, H);
    if (style === 'gibi') {
      // retícula de meio-tom (os pontinhos de impressão de gibi)
      ctx.fillStyle = colors.inkDim;
      ctx.globalAlpha = 0.16;
      for (let y = 6; y < H; y += 12) {
        for (let x = ((y / 12) % 2) * 6 + 3; x < W; x += 12) {
          ctx.beginPath();
          ctx.arc(x, y, 1.6 + (y / H) * 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawAliens(pal) {
    ctx.save();
    if (style === 'alien') {
      ctx.shadowBlur = 8;
    }
    aliens.forEach((a) => {
      if (!a.alive) return;
      const p = alienPos(a);
      const color = pal.rows[a.row];
      if (style === 'alien') ctx.shadowColor = color;
      blit(TYPES[a.row][animFrame], p.x, p.y, color, pal.outline);
    });
    ctx.restore();
  }

  function drawBunkers(pal) {
    ctx.save();
    if (style === 'alien') {
      ctx.shadowColor = pal.bunker;
      ctx.shadowBlur = 6;
    }
    ctx.fillStyle = pal.bunker;
    bunkers.forEach((b) => {
      for (let y = 0; y < BUNKER_ROWS; y++) {
        let c = 0;
        while (c < BUNKER_COLS) {
          if (b.cells[y * BUNKER_COLS + c]) {
            let e = c;
            while (e < BUNKER_COLS && b.cells[y * BUNKER_COLS + e]) e++;
            ctx.fillRect(b.x + c * BUNKER_CELL, BUNKER_Y + y * BUNKER_CELL, (e - c) * BUNKER_CELL, BUNKER_CELL);
            c = e;
          } else c++;
        }
      }
    });
    ctx.restore();
  }

  function drawCannon(pal) {
    if (!cannon.alive) return;
    if (cannon.invuln > 0 && Math.floor(cannon.invuln / 5) % 2 === 0) return;
    ctx.save();
    if (style === 'alien') {
      ctx.shadowColor = pal.cannon;
      ctx.shadowBlur = 8;
    }
    blit(CANNON, cannon.x - (13 * PX) / 2, CANNON_Y, pal.cannon, pal.outline);
    ctx.restore();
  }

  function drawBullets(pal) {
    ctx.save();
    if (pBullet) {
      ctx.fillStyle = style === 'gibi' ? '#111' : style === 'alien' ? '#e8ffd0' : colors.ink;
      if (style === 'alien') {
        ctx.shadowColor = '#b6ff3c';
        ctx.shadowBlur = 8;
      }
      ctx.fillRect(pBullet.x - 1, pBullet.y, 2, 9);
    }
    aBullets.forEach((b) => {
      ctx.fillStyle = pal.bullet;
      if (style === 'alien') {
        ctx.shadowColor = pal.bullet;
        ctx.shadowBlur = 8;
      }
      // zigue-zague de 3 quadros
      const f = Math.floor(b.t / 4) % 3;
      const xs = [0, 2, -2][f];
      ctx.fillRect(b.x - 1 + xs, b.y, 2, 3);
      ctx.fillRect(b.x - 1 - xs, b.y + 3, 2, 3);
      ctx.fillRect(b.x - 1 + xs, b.y + 6, 2, 3);
    });
    ctx.restore();
  }

  function drawUfo(pal) {
    if (!ufo) return;
    ctx.save();
    if (style === 'alien') {
      ctx.shadowColor = pal.ufo;
      ctx.shadowBlur = 10;
    }
    blit(UFO_SPRITE, ufo.x - (16 * PX) / 2, UFO_Y - 7, pal.ufo, pal.outline);
    ctx.restore();
  }

  function drawParticles(pal) {
    particles.forEach((p) => {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = style === 'gibi' ? (Math.random() < 0.5 ? '#e0402a' : '#f2b01e') : style === 'alien' ? '#b6ff3c' : colors.ink;
      ctx.fillRect(p.x - 1, p.y - 1, 2.5, 2.5);
    });
    ctx.globalAlpha = 1;
    // popups: pontos ou onomatopeia de gibi
    popups.forEach((p) => {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (style === 'gibi') {
        ctx.font = 'bold 15px Bangers, Impact, sans-serif';
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#111';
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = '#ffe14d';
        ctx.fillText(p.text, p.x, p.y);
      } else {
        ctx.font = 'bold 10px monospace';
        ctx.fillStyle = style === 'alien' ? '#ffd93d' : colors.warn;
        ctx.fillText(p.text, p.x, p.y);
      }
    });
    ctx.globalAlpha = 1;
  }

  function drawGround() {
    ctx.fillStyle = style === 'gibi' ? '#111' : style === 'alien' ? colors.accent : colors.inkDim;
    if (style === 'alien') {
      ctx.save();
      ctx.shadowColor = colors.accent;
      ctx.shadowBlur = 8;
      ctx.fillRect(0, H - 14, W, 2);
      ctx.restore();
    } else {
      ctx.fillRect(0, H - 14, W, style === 'gibi' ? 3 : 2);
    }
  }

  function drawCellophane() {
    if (style !== 'classic') return;
    // celofane colorido do fliperama: faixa vermelha em cima, verde embaixo
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = colors.danger;
    ctx.fillRect(0, 28, W, 44);
    ctx.fillStyle = colors.accent;
    ctx.fillRect(0, H - 118, W, 118);
    ctx.globalAlpha = 1;
  }

  function drawHud() {
    // vidas = canhõezinhos
    for (let i = 0; i < Math.max(0, lives - 1); i++) {
      ctx.fillStyle = style === 'gibi' ? '#1f9d55' : style === 'alien' ? '#e8ffd0' : colors.accent;
      paint(CANNON, 12 + i * 30, 8);
    }
    ctx.fillStyle = colors.inkDim;
    ctx.font = '10px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillText(`ONDA ${wave}`, W - 12, 14);
  }

  function drawOverlayText(lines, y) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, y - 22, W, 44);
    ctx.fillStyle = '#f4f4f4';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(lines[0], W / 2, y - 8);
    ctx.fillText(lines[1], W / 2, y + 9);
  }

  function drawFlash() {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, H / 2 - 84, W, 26);
    ctx.fillStyle = colors.warn;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 13;
    ctx.font = `bold ${size}px monospace`;
    while (ctx.measureText(flashText).width > W - 10 && size > 8) {
      size -= 1;
      ctx.font = `bold ${size}px monospace`;
    }
    ctx.fillText(flashText, W / 2, H / 2 - 71);
  }

  function draw() {
    colors = readThemeColors();
    style = styleOf();
    const pal = palette();
    const now = Date.now();
    ctx.save();
    if (shakeUntil > now) {
      const k = (shakeUntil - now) / 360;
      ctx.translate((Math.random() - 0.5) * 6 * k, (Math.random() - 0.5) * 6 * k);
    }
    drawBackground();
    drawGround();
    drawBunkers(pal);
    drawAliens(pal);
    drawUfo(pal);
    drawCannon(pal);
    drawBullets(pal);
    drawParticles(pal);
    ctx.restore();
    drawCellophane();
    drawHud();
    if (paused) drawOverlayText(['◄ ► (ou arraste) move · espaço/clique atira', 'não deixe os invasores chegarem embaixo'], H / 2 + 20);
    else if (flashUntil > now) drawFlash();
  }

  // ---------- laço ----------
  function tick(timestamp) {
    if (!running) return;
    const dt = lastTimestamp === null ? 1 : Math.min((timestamp - lastTimestamp) / REF_FRAME_MS, MAX_DT_FRAMES);
    lastTimestamp = timestamp;

    updateCannon(dt);
    updatePlayerBullet(dt);
    updateAlienBullets(dt);
    updateFormation(dt);
    updateUfo(dt);
    updateParticles(dt);
    updateWave(dt);

    if (gameOverAt && Date.now() >= gameOverAt) {
      stop();
      sfx.gameOver();
      draw();
      onGameOver && onGameOver(score);
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
  const isLeft = (k) => k === 'ArrowLeft' || k === 'a' || k === 'A';
  const isRight = (k) => k === 'ArrowRight' || k === 'd' || k === 'D';
  function handleKey(e) {
    const k = e.key;
    if (!isLeft(k) && !isRight(k) && k !== ' ' && k !== 'ArrowUp' && k !== 'w' && k !== 'W') return;
    e.preventDefault();
    begin();
    if (isLeft(k)) moveL = true;
    if (isRight(k)) moveR = true;
    if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') {
      firing = true;
      fire();
    }
  }
  function handleKeyUp(e) {
    const k = e.key;
    if (isLeft(k)) moveL = false;
    if (isRight(k)) moveR = false;
    if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') firing = false;
  }
  // mouse (mexer) ou dedo (arrastar): o canhão persegue o ponteiro; clicar/tocar atira
  function handlePointer(e) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    pointerTargetX = clamp(((e.clientX - rect.left) * W) / rect.width, 0, W);
    if (e.type === 'pointerdown') {
      begin();
      fire();
    } else if (paused && e.pointerType === 'touch') begin();
  }

  function start() {
    reset();
    paused = true;
    draw();
    onScoreChange && onScoreChange(score);
    running = true;
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  return { start, stop, handleKey, handleKeyUp, handlePointer, get running() { return running; } };
}
