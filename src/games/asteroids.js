// Easter egg — Asteroids em canvas puro, sem lib externa (mesmo espírito
// zero-dependência dos outros jogos escondidos). Nave com inércia no meio
// de um campo de pedras que se partem em pedaços menores; a tela "dá a
// volta" nas bordas (o que sai por um lado volta pelo outro) -- inclusive
// os tiros. Discos voadores aparecem de vez em quando (o pequeno mira de
// verdade). 3 vidas, vida extra a cada 10.000 pontos, ondas cada vez
// maiores. Sem fim por vitória: o que importa é o recorde.
//
// Física contínua via requestAnimationFrame com delta-time normalizado
// (ver flappy.js: sem isso o jogo roda mais rápido/lento dependendo dos
// quadros por segundo do navegador). Tiros andam em SUB-PASSOS curtos
// (no máx. ~4px) -- com um quadro lento (dtFrames até 4) um tiro andaria
// 28px de uma vez e atravessaria uma pedra pequena (raio 8) sem acertar.
//
// O visual muda com o tema ativo (ver `styleOf`): os dois temas especiais
// do Asteroids ganham pintura própria (radar vetorial de fósforo com rastro
// / carta celeste a nanquim), os demais ficam no clássico com as cores do
// tema.
import { readThemeColors } from './theme.js';
import { sfx } from './sound.js';

const REF_FRAME_MS = 1000 / 60;
const MAX_DT_FRAMES = 4;
const MAX_STEP_PX = 4;

const SHIP_TURN = 0.075; // rad por quadro
const SHIP_THRUST = 0.115;
const SHIP_MAX_SPEED = 6.2;
const SHIP_FRICTION = 0.9925; // por quadro de referência
const SHIP_R = 8;
const BULLET_SPEED = 7.2;
const BULLET_LIFE = 54; // quadros
const MAX_BULLETS = 4;
const FIRE_COOLDOWN = 9;
const RESPAWN_DELAY = 90;
const INVULN_FRAMES = 160;
const HYPERSPACE_COOLDOWN = 70;
const LIVES_START = 3;
const EXTRA_LIFE_EVERY = 10000;
const WAVE_DELAY = 100;

// tamanhos: raio, pontos, filhos
const ROCK = {
  3: { r: 28, score: 20 },
  2: { r: 15, score: 50 },
  1: { r: 8, score: 100 },
};
const UFO_BIG = { r: 14, score: 200, speed: 1.3 };
const UFO_SMALL = { r: 9, score: 1000, speed: 1.9 };
const UFO_BULLET_SPEED = 4.2;
const UFO_BULLET_LIFE = 95;

const TAU = Math.PI * 2;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function rand(a, b) {
  return a + Math.random() * (b - a);
}
// ruído determinístico barato (mesmo número pra mesma semente) -- o
// "tremido de nanquim" do tema carta precisa ser ESTÁVEL entre quadros.
function wobble(seed) {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s) - 0.5;
}
function styleOf() {
  const id = document.documentElement.getAttribute('data-theme');
  if (id === 'asteroids-vetor') return 'vetor';
  if (id === 'asteroids-carta') return 'carta';
  return 'classic';
}

export function createAsteroidsGame(canvas, { onScoreChange, onGameOver }) {
  const ctx = canvas.getContext('2d');
  canvas.style.touchAction = 'none';
  const W = canvas.width;
  const H = canvas.height;

  let ship; // { x, y, vx, vy, a, alive, invuln, respawnIn, fireCd, hyperCd }
  let rocks, bullets, ufoBullets, particles, debris;
  let ufo; // null | { x, y, vx, vy, small, shootCd, wobbleT }
  let ufoTimer;
  let score, lives, wave, nextExtra;
  let turnL = false;
  let turnR = false;
  let thrust = false;
  let firing = false;
  let raf = null;
  let running = false;
  let paused = true;
  let lastTimestamp = null;
  let colors = readThemeColors();
  let style = styleOf();
  let flashText = '';
  let flashUntil = 0;
  let waveTimer = 0; // > 0 = contando pro próximo bloco de pedras
  let gameOverAt = 0;
  let thrustSoundCd = 0;
  let ufoSoundCd = 0;
  let stars = [];
  let shakeUntil = 0;

  // torus: menor diferença em cada eixo, sabendo que a tela dá a volta
  function wrapD(a, b, size) {
    let d = Math.abs(a - b);
    if (d > size / 2) d = size - d;
    return d;
  }
  function torusDist(x1, y1, x2, y2) {
    return Math.hypot(wrapD(x1, x2, W), wrapD(y1, y2, H));
  }
  function wrapPos(o) {
    if (o.x < 0) o.x += W;
    else if (o.x >= W) o.x -= W;
    if (o.y < 0) o.y += H;
    else if (o.y >= H) o.y -= H;
  }

  // ---------- criação ----------
  function makeRock(size, x, y, speedMul = 1) {
    const sides = 9 + Math.floor(Math.random() * 4);
    const verts = [];
    for (let i = 0; i < sides; i++) verts.push(0.74 + Math.random() * 0.46);
    const ang = Math.random() * TAU;
    const spd = rand(0.55, 1.15) * (1 + (3 - size) * 0.42) * speedMul * (1 + Math.min(wave - 1, 8) * 0.06);
    return { size, x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, a: Math.random() * TAU, spin: rand(-0.025, 0.025), verts, r: ROCK[size].r };
  }
  function spawnWave() {
    const count = Math.min(3 + wave, 10);
    for (let i = 0; i < count; i++) {
      // nasce numa borda, longe da nave
      let x, y;
      let tries = 0;
      do {
        if (Math.random() < 0.5) {
          x = Math.random() < 0.5 ? 0 : W;
          y = Math.random() * H;
        } else {
          x = Math.random() * W;
          y = Math.random() < 0.5 ? 0 : H;
        }
        tries++;
      } while (ship.alive && torusDist(x, y, ship.x, ship.y) < 120 && tries < 20);
      rocks.push(makeRock(3, x, y));
    }
    flash(`ONDA ${wave}`);
  }
  function resetShip() {
    ship = { x: W / 2, y: H / 2, vx: 0, vy: 0, a: -Math.PI / 2, alive: true, invuln: INVULN_FRAMES, respawnIn: 0, fireCd: 0, hyperCd: 0 };
  }
  function makeStars() {
    stars = [];
    for (let i = 0; i < 46; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, s: 0.5 + Math.random() * 1.4 });
  }

  function reset() {
    rocks = [];
    bullets = [];
    ufoBullets = [];
    particles = [];
    debris = [];
    ufo = null;
    ufoTimer = rand(18, 30) * 60;
    score = 0;
    lives = LIVES_START;
    wave = 1;
    nextExtra = EXTRA_LIFE_EVERY;
    turnL = turnR = thrust = firing = false;
    lastTimestamp = null;
    flashText = '';
    flashUntil = 0;
    waveTimer = 0;
    gameOverAt = 0;
    shakeUntil = 0;
    makeStars();
    resetShip();
    spawnWave();
  }

  // ---------- efeitos ----------
  function flash(text, ms = 1400) {
    flashText = text;
    flashUntil = Date.now() + ms;
  }
  function burst(x, y, count, speed = 2.2, life = 1) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.35 + Math.random() * 0.9);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, decay: 0.022 + Math.random() * 0.02 });
    }
    if (particles.length > 160) particles.splice(0, particles.length - 160);
  }
  // pedaços de linha girando -- explosão da nave e dos discos
  function breakApart(x, y, pieces, len, spread) {
    for (let i = 0; i < pieces; i++) {
      const a = Math.random() * TAU;
      const s = spread * (0.4 + Math.random());
      debris.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, a: Math.random() * TAU, spin: rand(-0.2, 0.2), len: len * (0.5 + Math.random()), life: 1 });
    }
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
  function fireBullet() {
    if (!ship.alive || ship.fireCd > 0 || bullets.length >= MAX_BULLETS) return;
    ship.fireCd = FIRE_COOLDOWN;
    bullets.push({ x: ship.x + Math.cos(ship.a) * 12, y: ship.y + Math.sin(ship.a) * 12, vx: Math.cos(ship.a) * BULLET_SPEED + ship.vx * 0.4, vy: Math.sin(ship.a) * BULLET_SPEED + ship.vy * 0.4, life: BULLET_LIFE });
    sfx.laser();
  }

  function hyperspace() {
    if (!ship.alive || ship.hyperCd > 0) return;
    ship.hyperCd = HYPERSPACE_COOLDOWN;
    ship.x = rand(30, W - 30);
    ship.y = rand(30, H - 30);
    ship.vx = ship.vy = 0;
    sfx.hyper();
    // arriscado: 1 chance em 8 de reaparecer "dentro" de algo e explodir
    if (Math.random() < 0.125) killShip();
  }

  function killShip() {
    if (!ship.alive) return;
    ship.alive = false;
    lives -= 1;
    sfx.shipDie();
    shakeUntil = Date.now() + 320;
    breakApart(ship.x, ship.y, 5, 12, 2.4);
    burst(ship.x, ship.y, 22, 3.1);
    if (lives <= 0) {
      gameOverAt = Date.now() + 1500;
      flash('FIM DE JOGO', 2000);
    } else {
      ship.respawnIn = RESPAWN_DELAY;
    }
  }

  function destroyRock(i, fromShip = true) {
    const rock = rocks[i];
    rocks.splice(i, 1);
    if (fromShip) addScore(ROCK[rock.size].score);
    sfx.boom(rock.size);
    burst(rock.x, rock.y, 6 + rock.size * 3, 1.5 + rock.size * 0.35);
    if (rock.size > 1) {
      // dois filhos saem em direções divergentes, um pouco mais rápidos
      const base = Math.atan2(rock.vy, rock.vx);
      [-1, 1].forEach((side) => {
        const child = makeRock(rock.size - 1, rock.x, rock.y);
        const ang = base + side * rand(0.4, 1.0);
        const spd = Math.hypot(rock.vx, rock.vy) * 1.15 + 0.25;
        child.vx = Math.cos(ang) * spd;
        child.vy = Math.sin(ang) * spd;
        rocks.push(child);
      });
    }
  }

  function spawnUfo() {
    // a partir de 3.000 pontos os discos pequenos (que MIRAM) começam a
    // aparecer, e ficam mais frequentes conforme o placar sobe
    const smallChance = score < 3000 ? 0 : Math.min(0.75, 0.25 + (score - 3000) / 24000);
    const small = Math.random() < smallChance;
    const def = small ? UFO_SMALL : UFO_BIG;
    const fromLeft = Math.random() < 0.5;
    ufo = { x: fromLeft ? -def.r : W + def.r, y: rand(40, H - 40), vx: (fromLeft ? 1 : -1) * def.speed, vy: 0, small, r: def.r, shootCd: rand(40, 80), wobbleT: Math.random() * 100, dirT: rand(60, 120) };
    ufoSoundCd = 0;
  }

  function ufoShoot() {
    let ang;
    if (ufo.small && ship.alive) {
      // pontaria: erra menos conforme o placar sobe, mas nunca é perfeita
      const err = clamp(0.5 - score / 60000, 0.12, 0.5);
      ang = Math.atan2(ship.y - ufo.y, ship.x - ufo.x) + rand(-err, err);
    } else {
      ang = Math.random() * TAU;
    }
    ufoBullets.push({ x: ufo.x, y: ufo.y, vx: Math.cos(ang) * UFO_BULLET_SPEED, vy: Math.sin(ang) * UFO_BULLET_SPEED, life: UFO_BULLET_LIFE });
    sfx.laser(true);
  }

  function updateShip(dt) {
    if (ship.fireCd > 0) ship.fireCd -= dt;
    if (ship.hyperCd > 0) ship.hyperCd -= dt;
    if (!ship.alive) {
      if (lives > 0) {
        ship.respawnIn -= dt;
        // só renasce quando o centro está livre (senão renasceria em cima de uma pedra)
        if (ship.respawnIn <= 0 && !rocks.some((r) => torusDist(r.x, r.y, W / 2, H / 2) < r.r + 70)) resetShip();
      }
      return;
    }
    if (turnL) ship.a -= SHIP_TURN * dt;
    if (turnR) ship.a += SHIP_TURN * dt;
    if (thrust) {
      ship.vx += Math.cos(ship.a) * SHIP_THRUST * dt;
      ship.vy += Math.sin(ship.a) * SHIP_THRUST * dt;
      thrustSoundCd -= dt;
      if (thrustSoundCd <= 0) {
        sfx.thrust();
        thrustSoundCd = 7;
      }
    }
    const f = Math.pow(SHIP_FRICTION, dt);
    ship.vx *= f;
    ship.vy *= f;
    const sp = Math.hypot(ship.vx, ship.vy);
    if (sp > SHIP_MAX_SPEED) {
      ship.vx = (ship.vx / sp) * SHIP_MAX_SPEED;
      ship.vy = (ship.vy / sp) * SHIP_MAX_SPEED;
    }
    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;
    wrapPos(ship);
    if (ship.invuln > 0) ship.invuln -= dt;
    if (firing) fireBullet();
  }

  function updateRocks(dt) {
    rocks.forEach((r) => {
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.a += r.spin * dt;
      wrapPos(r);
    });
  }

  function updateBullets(dt) {
    // tiros da nave: sub-passos + colisão com pedras/disco
    for (let bi = bullets.length - 1; bi >= 0; bi--) {
      const b = bullets[bi];
      const total = Math.hypot(b.vx, b.vy) * dt;
      const steps = Math.max(1, Math.ceil(total / MAX_STEP_PX));
      let dead = false;
      for (let s = 0; s < steps && !dead; s++) {
        b.x += (b.vx * dt) / steps;
        b.y += (b.vy * dt) / steps;
        wrapPos(b);
        for (let i = rocks.length - 1; i >= 0; i--) {
          if (torusDist(b.x, b.y, rocks[i].x, rocks[i].y) < rocks[i].r) {
            destroyRock(i);
            dead = true;
            break;
          }
        }
        if (!dead && ufo && torusDist(b.x, b.y, ufo.x, ufo.y) < ufo.r + 2) {
          killUfo(true);
          dead = true;
        }
      }
      b.life -= dt;
      if (dead || b.life <= 0) bullets.splice(bi, 1);
    }
    // tiros do disco
    for (let bi = ufoBullets.length - 1; bi >= 0; bi--) {
      const b = ufoBullets[bi];
      const total = Math.hypot(b.vx, b.vy) * dt;
      const steps = Math.max(1, Math.ceil(total / MAX_STEP_PX));
      let dead = false;
      for (let s = 0; s < steps && !dead; s++) {
        b.x += (b.vx * dt) / steps;
        b.y += (b.vy * dt) / steps;
        wrapPos(b);
        if (ship.alive && ship.invuln <= 0 && torusDist(b.x, b.y, ship.x, ship.y) < SHIP_R) {
          killShip();
          dead = true;
        }
        if (!dead) {
          for (let i = rocks.length - 1; i >= 0; i--) {
            if (torusDist(b.x, b.y, rocks[i].x, rocks[i].y) < rocks[i].r) {
              destroyRock(i, false); // pedra destruída por tiro do disco não dá ponto
              dead = true;
              break;
            }
          }
        }
      }
      b.life -= dt;
      if (dead || b.life <= 0) ufoBullets.splice(bi, 1);
    }
  }

  function killUfo(byPlayer) {
    if (!ufo) return;
    if (byPlayer) addScore(ufo.small ? UFO_SMALL.score : UFO_BIG.score);
    sfx.ufoHit();
    breakApart(ufo.x, ufo.y, 4, 10, 2);
    burst(ufo.x, ufo.y, 16, 2.6);
    ufo = null;
    ufoTimer = rand(18, 32) * 60;
  }

  function updateUfo(dt) {
    if (!ufo) {
      // o disco só aparece com pedras na tela (e não logo no começo da onda)
      if (rocks.length > 0 && waveTimer <= 0) ufoTimer -= dt;
      if (ufoTimer <= 0) spawnUfo();
      return;
    }
    ufoSoundCd -= dt;
    if (ufoSoundCd <= 0) {
      sfx.ufo(ufo.small);
      ufoSoundCd = ufo.small ? 8 : 14;
    }
    ufo.wobbleT += dt;
    ufo.dirT -= dt;
    if (ufo.dirT <= 0) {
      // de vez em quando muda o rumo vertical (sobe/desce/reto)
      ufo.vy = [-1, 0, 1][Math.floor(Math.random() * 3)] * (ufo.small ? 1.1 : 0.8);
      ufo.dirT = rand(50, 110);
    }
    ufo.x += ufo.vx * dt;
    ufo.y += ufo.vy * dt;
    if (ufo.y < 20 || ufo.y > H - 20) ufo.vy = -ufo.vy;
    ufo.y = clamp(ufo.y, 14, H - 14);
    ufo.shootCd -= dt;
    if (ufo.shootCd <= 0) {
      ufoShoot();
      ufo.shootCd = ufo.small ? rand(45, 75) : rand(70, 120);
    }
    if (ufo.x < -ufo.r - 20 || ufo.x > W + ufo.r + 20) {
      ufo = null;
      ufoTimer = rand(18, 32) * 60;
      return;
    }
    // colide com a nave
    if (ufo && ship.alive && ship.invuln <= 0 && torusDist(ufo.x, ufo.y, ship.x, ship.y) < ufo.r + SHIP_R) {
      killShip();
      killUfo(false);
    }
  }

  function checkShipRocks() {
    if (!ship.alive || ship.invuln > 0) return;
    for (let i = rocks.length - 1; i >= 0; i--) {
      if (torusDist(rocks[i].x, rocks[i].y, ship.x, ship.y) < rocks[i].r + SHIP_R - 2) {
        destroyRock(i);
        killShip();
        return;
      }
    }
  }

  function updateParticles(dt) {
    particles.forEach((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= p.decay * dt;
    });
    particles = particles.filter((p) => p.life > 0);
    debris.forEach((d) => {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.a += d.spin * dt;
      d.life -= 0.012 * dt;
    });
    debris = debris.filter((d) => d.life > 0);
  }

  function updateWave(dt) {
    if (rocks.length === 0 && !ufo) {
      if (waveTimer <= 0) {
        waveTimer = WAVE_DELAY;
        const bonus = wave * 100;
        if (wave >= 1) addScore(bonus);
        flash(`ONDA ${wave} LIMPA  +${bonus}`);
      }
    }
    if (waveTimer > 0) {
      waveTimer -= dt;
      if (waveTimer <= 0) {
        wave += 1;
        spawnWave();
      }
    }
  }

  // ---------- desenho ----------
  function shipPoints(s) {
    const c = Math.cos(s.a);
    const n = Math.sin(s.a);
    const pt = (fx, fy) => [s.x + c * fx - n * fy, s.y + n * fx + c * fy];
    return { nose: pt(12, 0), left: pt(-9, -7.5), notch: pt(-5, 0), right: pt(-9, 7.5), flame: pt(-11 - Math.random() * 6, 0), flameL: pt(-6, -3), flameR: pt(-6, 3) };
  }

  function strokeRock(r, jitterSeed) {
    const n = r.verts.length;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = r.a + (i / n) * TAU;
      const j = jitterSeed ? wobble(jitterSeed + i * 3.1) * 1.8 : 0;
      const rad = r.r * r.verts[i] + j;
      const x = r.x + Math.cos(a) * rad;
      const y = r.y + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  // objetos perto da borda são desenhados também do outro lado, pra "dar
  // a volta" visualmente em vez de sumir pela metade
  function drawWrapped(x, y, r, drawFn) {
    const xs = [0];
    const ys = [0];
    if (x < r) xs.push(W);
    if (x > W - r) xs.push(-W);
    if (y < r) ys.push(H);
    if (y > H - r) ys.push(-H);
    xs.forEach((ox) => ys.forEach((oy) => {
      if (ox === 0 && oy === 0) {
        drawFn(0, 0);
        return;
      }
      ctx.save();
      ctx.translate(ox, oy);
      drawFn(ox, oy);
      ctx.restore();
    }));
  }

  function drawBackground(first) {
    if (style === 'vetor') {
      // monitor vetorial: não apaga o quadro anterior de uma vez, só
      // escurece -- o fósforo deixa rastro (primeiro quadro apaga tudo)
      ctx.globalAlpha = first ? 1 : 0.34;
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      return;
    }
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, H);
    if (style === 'carta') {
      // carta celeste: pontilhado de coordenadas + estrelas de 4 pontas
      ctx.fillStyle = colors.line;
      ctx.globalAlpha = 0.7;
      for (let x = 20; x < W; x += 40) for (let y = 20; y < H; y += 40) ctx.fillRect(x, y, 1.5, 1.5);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.inkDim;
      ctx.lineWidth = 1;
      stars.forEach((s, i) => {
        if (i % 3 === 0) {
          const r = 2.5 + s.s * 1.6;
          ctx.beginPath();
          ctx.moveTo(s.x - r, s.y);
          ctx.lineTo(s.x + r, s.y);
          ctx.moveTo(s.x, s.y - r);
          ctx.lineTo(s.x, s.y + r);
          ctx.stroke();
        } else {
          ctx.fillStyle = colors.inkDim;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.s * 0.8, 0, TAU);
          ctx.fill();
        }
      });
      // um par de "constelações" ligadas por traço fino
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      for (let i = 0; i < 9; i++) {
        const s = stars[i * 3];
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    ctx.fillStyle = colors.inkDim;
    stars.forEach((s) => {
      ctx.globalAlpha = 0.25 + s.s * 0.25;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    });
    ctx.globalAlpha = 1;
  }

  function lineColor(kind) {
    if (style === 'carta') return kind === 'ship' ? colors.danger : colors.ink;
    if (style === 'vetor') return kind === 'ufo' ? colors.accent : colors.ink;
    return kind === 'ship' ? colors.accent : kind === 'ufo' ? colors.danger : colors.inkDim;
  }

  function glowOn(color, blur) {
    if (style === 'carta') return;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
  }

  function drawRock(r) {
    drawWrapped(r.x, r.y, r.r, () => {
      ctx.save();
      const color = lineColor('rock');
      glowOn(color, style === 'vetor' ? 7 : 3);
      if (style === 'carta') {
        // nanquim: sombra rala dentro, contorno dobrado e levemente torto,
        // dois riscos de hachura
        strokeRock(r, 0);
        ctx.fillStyle = colors.panel;
        ctx.globalAlpha = 0.7;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.lineWidth = 1;
        strokeRock(r, r.x * 0.01 + r.y * 0.013 + 7);
        ctx.stroke();
        if (r.size >= 2) {
          ctx.beginPath();
          const k = r.r * 0.45;
          ctx.moveTo(r.x - k, r.y + k * 0.3);
          ctx.lineTo(r.x + k * 0.2, r.y - k);
          ctx.moveTo(r.x - k * 0.2, r.y + k * 0.7);
          ctx.lineTo(r.x + k * 0.7, r.y - k * 0.3);
          ctx.stroke();
        }
      } else {
        strokeRock(r, 0);
        ctx.strokeStyle = color;
        ctx.lineWidth = style === 'vetor' ? 1.8 : 1.6;
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  function drawShip() {
    if (!ship.alive) return;
    if (ship.invuln > 0 && Math.floor(ship.invuln / 6) % 2 === 0) return; // pisca enquanto protegida
    const p = shipPoints(ship);
    drawWrapped(ship.x, ship.y, 14, () => {
      ctx.save();
      const color = lineColor('ship');
      glowOn(color, style === 'vetor' ? 9 : 5);
      ctx.strokeStyle = color;
      ctx.lineWidth = style === 'vetor' ? 2 : 1.8;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(p.nose[0], p.nose[1]);
      ctx.lineTo(p.left[0], p.left[1]);
      ctx.lineTo(p.notch[0], p.notch[1]);
      ctx.lineTo(p.right[0], p.right[1]);
      ctx.closePath();
      ctx.stroke();
      if (style === 'carta') {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.18;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (thrust) {
        ctx.strokeStyle = style === 'carta' ? colors.warn : colors.warn;
        ctx.beginPath();
        ctx.moveTo(p.flameL[0], p.flameL[1]);
        ctx.lineTo(p.flame[0], p.flame[1]);
        ctx.lineTo(p.flameR[0], p.flameR[1]);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  function drawUfo() {
    if (!ufo) return;
    ctx.save();
    const color = lineColor('ufo');
    glowOn(color, 8);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.7;
    const r = ufo.r;
    ctx.beginPath();
    // casco
    ctx.moveTo(ufo.x - r, ufo.y);
    ctx.lineTo(ufo.x - r * 0.45, ufo.y + r * 0.45);
    ctx.lineTo(ufo.x + r * 0.45, ufo.y + r * 0.45);
    ctx.lineTo(ufo.x + r, ufo.y);
    ctx.lineTo(ufo.x + r * 0.5, ufo.y - r * 0.28);
    ctx.lineTo(ufo.x - r * 0.5, ufo.y - r * 0.28);
    ctx.closePath();
    ctx.moveTo(ufo.x - r, ufo.y);
    ctx.lineTo(ufo.x + r, ufo.y);
    // cúpula
    ctx.moveTo(ufo.x - r * 0.4, ufo.y - r * 0.28);
    ctx.lineTo(ufo.x - r * 0.22, ufo.y - r * 0.72);
    ctx.lineTo(ufo.x + r * 0.22, ufo.y - r * 0.72);
    ctx.lineTo(ufo.x + r * 0.4, ufo.y - r * 0.28);
    ctx.stroke();
    ctx.restore();
  }

  function drawBullets() {
    ctx.save();
    bullets.forEach((b) => {
      ctx.fillStyle = style === 'carta' ? colors.ink : colors.ink;
      glowOn(colors.ink, 6);
      ctx.beginPath();
      ctx.arc(b.x, b.y, style === 'carta' ? 2.2 : 1.9, 0, TAU);
      ctx.fill();
    });
    ufoBullets.forEach((b) => {
      ctx.fillStyle = lineColor('ufo');
      glowOn(lineColor('ufo'), 6);
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2.2, 0, TAU);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    particles.forEach((p) => {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = style === 'carta' ? colors.ink : colors.ink;
      ctx.fillRect(p.x - 0.8, p.y - 0.8, 1.6, 1.6);
    });
    ctx.globalAlpha = 1;
    ctx.strokeStyle = lineColor('ship');
    ctx.lineWidth = 1.6;
    debris.forEach((d) => {
      ctx.globalAlpha = Math.max(0, d.life);
      ctx.beginPath();
      ctx.moveTo(d.x - Math.cos(d.a) * d.len * 0.5, d.y - Math.sin(d.a) * d.len * 0.5);
      ctx.lineTo(d.x + Math.cos(d.a) * d.len * 0.5, d.y + Math.sin(d.a) * d.len * 0.5);
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawHud() {
    // vidas = naves pequenas desenhadas (glifo de nave em fonte monospace renderiza torto)
    ctx.save();
    ctx.strokeStyle = lineColor('ship');
    ctx.lineWidth = 1.5;
    for (let i = 0; i < Math.max(0, lives); i++) {
      const x = 16 + i * 17;
      const y = 17;
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x - 6, y + 6);
      ctx.lineTo(x, y + 3);
      ctx.lineTo(x + 6, y + 6);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.fillStyle = colors.inkDim;
    ctx.font = '10px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillText(`ONDA ${wave}`, W - 12, 14);
    ctx.restore();
  }

  function drawScanlines() {
    if (style !== 'vetor') return;
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  }

  function drawOverlayText(lines, y) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, y - 24, W, 48);
    ctx.fillStyle = style === 'carta' ? '#f6ecd6' : colors.ink;
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(lines[0], W / 2, y - 9);
    ctx.fillText(lines[1], W / 2, y + 9);
    ctx.restore();
  }

  function drawFlash() {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, H / 2 - 58, W, 26);
    ctx.fillStyle = colors.warn;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 13;
    ctx.font = `bold ${size}px monospace`;
    while (ctx.measureText(flashText).width > W - 10 && size > 8) {
      size -= 1;
      ctx.font = `bold ${size}px monospace`;
    }
    ctx.fillText(flashText, W / 2, H / 2 - 45);
    ctx.restore();
  }

  let firstDraw = true;
  function draw() {
    colors = readThemeColors();
    style = styleOf();
    const now = Date.now();
    ctx.save();
    if (shakeUntil > now) {
      const k = (shakeUntil - now) / 320;
      ctx.translate((Math.random() - 0.5) * 5 * k, (Math.random() - 0.5) * 5 * k);
    }
    drawBackground(firstDraw);
    firstDraw = false;
    rocks.forEach(drawRock);
    drawUfo();
    drawBullets();
    drawShip();
    drawParticles();
    ctx.restore();
    drawScanlines();
    drawHud();
    if (paused) drawOverlayText(['↑ acelera · ◄ ► gira', 'espaço atira · H hiperespaço'], H / 2 + 70);
    else if (flashUntil > now) drawFlash();
  }

  // ---------- laço ----------
  function tick(timestamp) {
    if (!running) return;
    const dt = lastTimestamp === null ? 1 : Math.min((timestamp - lastTimestamp) / REF_FRAME_MS, MAX_DT_FRAMES);
    lastTimestamp = timestamp;

    updateShip(dt);
    updateRocks(dt);
    updateBullets(dt);
    updateUfo(dt);
    checkShipRocks();
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
    firstDraw = true;
    raf = requestAnimationFrame(tick);
  }
  const isLeft = (k) => k === 'ArrowLeft' || k === 'a' || k === 'A';
  const isRight = (k) => k === 'ArrowRight' || k === 'd' || k === 'D';
  const isUp = (k) => k === 'ArrowUp' || k === 'w' || k === 'W';
  function handleKey(e) {
    const k = e.key;
    const hyper = k === 'h' || k === 'H' || k === 'Shift' || k === 'ArrowDown' || k === 's' || k === 'S';
    if (!isLeft(k) && !isRight(k) && !isUp(k) && k !== ' ' && !hyper) return;
    e.preventDefault();
    begin();
    if (isLeft(k)) turnL = true;
    if (isRight(k)) turnR = true;
    if (isUp(k)) thrust = true;
    if (k === ' ') {
      firing = true;
      fireBullet();
    }
    if (hyper && !e.repeat) hyperspace();
  }
  function handleKeyUp(e) {
    const k = e.key;
    if (isLeft(k)) turnL = false;
    if (isRight(k)) turnR = false;
    if (isUp(k)) thrust = false;
    if (k === ' ') firing = false;
  }

  function start() {
    reset();
    paused = true;
    firstDraw = true;
    draw();
    onScoreChange && onScoreChange(score);
    running = true;
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  return { start, stop, handleKey, handleKeyUp, get running() { return running; } };
}
