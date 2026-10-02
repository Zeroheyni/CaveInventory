// Easter egg — Pong em canvas puro, sem lib externa (mesmo espírito
// zero-dependência dos outros 5 jogos escondidos). Você (esquerda)
// contra uma "IA" que fica cada vez mais rápida/precisa a cada ponto
// que você faz. 3 vidas: bola passou de você, perde uma; passou da IA,
// você ganha o ponto, sobe de nível e a IA melhora. Sem fim por vitória
// -- o que importa é o recorde de pontos (igual Breakout).
//
// Física contínua via requestAnimationFrame, já com delta-time
// normalizado desde o início (ver flappy.js: sem isso o jogo fica mais
// rápido/lento dependendo dos quadros por segundo reais do navegador).
// A bola anda em SUB-PASSOS curtos (no máx. ~3px cada) -- com a bola a
// 8px/quadro e um quadro lento (dtFrames até 4) ela andaria 30px de uma
// vez e podia atravessar uma raquete de 7px de largura sem nunca
// colidir ("tunneling").
//
// O visual da quadra muda com o tema ativo (ver `courtStyleOf`): os
// dois temas especiais do Pong ganham quadra própria (mesa de ping-pong
// à noite / folha de caderno rabiscada), os demais temas ficam no Pong
// clássico (linha tracejada no meio, bola quadradinha).
import { readThemeColors } from './theme.js';
import { sfx } from './sound.js';

const REF_FRAME_MS = 1000 / 60; // constantes abaixo ajustadas "olhando" pra ~60fps
const MAX_DT_FRAMES = 4; // teto contra engasgo da aba (ver flappy.js)
const MAX_STEP_PX = 3; // maior deslocamento da bola por sub-passo

const PADDLE_W = 7;
const PADDLE_H = 52;
const PADDLE_MARGIN = 14;
const PLAYER_SPEED = 5.4; // px por quadro de referência (teclado)
const POINTER_SPEED = 10; // teto de velocidade seguindo o mouse/dedo -- rápido, mas não teletransporta
const BALL_R = 4;
const BALL_SPEED_START = 3.5;
const BALL_SPEED_STEP = 0.22; // cada rebatida (sua ou da IA) acelera um pouco
const BALL_SPEED_MAX = 8.6;
const MAX_BOUNCE_ANGLE = 1.0; // rad (~57°) -- o quanto bater na ponta da raquete desvia a bola
const MIN_HORIZONTAL_RATIO = 0.45; // bola nunca fica "quase vertical" (nunca chegaria no outro lado)
const LIVES_START = 3;
const SERVE_DELAY_MS = 900;

// IA -- melhora a cada nível (cada ponto que você faz), mas com teto
// abaixo da velocidade vertical que uma rebatida de ponta consegue dar
// (~8.6 * sin(1.0) ≈ 7.2px/quadro): dá sempre pra vencer um ponto com
// ângulo bem fechado. `err` é um desvio aleatório da mira (fração da
// altura da raquete), sorteado de novo a cada saque e a cada rebatida
// dela -- é o que faz a IA "errar" de vez em quando mesmo no nível alto.
const AI_BASE_SPEED = 2.1;
const AI_SPEED_PER_LEVEL = 0.34;
const AI_SPEED_MAX = 5.6;
const AI_ERR_BASE = 0.46;
const AI_ERR_PER_LEVEL = 0.04;
const AI_ERR_MIN = 0.1;
// no nível 1 a IA só começa a reagir depois que a bola passou do meio
// da quadra; nos níveis altos ela já reage quase desde a sua raquete.
const AI_REACT_BASE = 0.58;
const AI_REACT_PER_LEVEL = 0.05;
const AI_REACT_MIN = 0.14;

const RETURN_SCORE = 10;
const RALLY_BONUS = 2; // cada rebatida seguida no mesmo ponto vale +2 a mais que a anterior
const POINT_SCORE_BASE = 100;
const POINT_SCORE_PER_LEVEL = 25;
const STREAK_BONUS = 50; // pontos seguidos sem perder vida
const FLASH_MS = 800;
const SHAKE_MS = 260;
const TRAIL_MS = 170;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// qual "quadra" desenhar -- lê o tema ativo em vez de receber por
// parâmetro, mesmo jeito de readThemeColors (o tema pode mudar enquanto
// o overlay está aberto e o próximo quadro já reflete).
function courtStyleOf() {
  const id = document.documentElement.getAttribute('data-theme');
  if (id === 'pong-mesa') return 'mesa';
  if (id === 'pong-caderno') return 'caderno';
  return 'classic';
}

// ruído determinístico barato (mesmo número pra mesma posição) -- o
// "tremido de lápis" do tema caderno precisa ser ESTÁVEL entre quadros,
// senão a quadra inteira ficaria tremendo.
function wobble(seed) {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s) - 0.5;
}

export function createPongGame(canvas, { onScoreChange, onGameOver }) {
  const ctx = canvas.getContext('2d');
  canvas.style.touchAction = 'none'; // dedo arrastando na tela não pode rolar a página

  const W = canvas.width;
  const H = canvas.height;

  let player; // { y }
  let ai; // { y, err }
  let ball; // { x, y, vx, vy, r }
  let ballLive = false; // false = bola parada no centro esperando o saque
  let score, lives, level, rally, streak;
  let movingUp = false;
  let movingDown = false;
  let pointerTargetY = null; // null = teclado no comando
  let raf = null;
  let running = false;
  let paused = true; // começa parado até o 1º comando
  let lastTimestamp = null;
  let colors = readThemeColors();
  let courtStyle = courtStyleOf();
  let flashText = '';
  let flashUntil = 0;
  let flashTimer = null;
  let serveTimer = null;
  let shakeUntil = 0;
  let playerFlashUntil = 0;
  let aiFlashUntil = 0;
  let particles = [];
  let trail = [];

  function aiSpeed() {
    return Math.min(AI_BASE_SPEED + (level - 1) * AI_SPEED_PER_LEVEL, AI_SPEED_MAX);
  }
  function aiErrMag() {
    return Math.max(AI_ERR_MIN, AI_ERR_BASE - (level - 1) * AI_ERR_PER_LEVEL);
  }
  function aiReactX() {
    return Math.max(AI_REACT_MIN, AI_REACT_BASE - (level - 1) * AI_REACT_PER_LEVEL) * W;
  }
  // `err` desloca onde na raquete da IA a bola vai bater: hitPos =
  // -2*err (ver moveAi: o centro da raquete mira em ball.y + err*altura).
  // Parte aleatória (a IA "erra a mira") + parte INTENCIONAL (`bias`):
  // ela escolhe bater de um jeito que manda a bola pro lado oposto de
  // onde o jogador está, e quanto mais alto o nível / mais longo o rally,
  // mais forte esse desvio -- sem isso, quem rebate sempre no centro da
  // raquete devolvia bola reta pra IA, que devolvia reta de volta, e o
  // rally nunca acabava (e o bônus por rebatida seguida só crescia).
  // Limitado a ±0.44 (a raquete tem meia altura = 0.5): acima disso a
  // mira cairia FORA da raquete e a IA deixaria a bola passar de graça.
  function rollAiErr() {
    const playerCenter = player.y + PADDLE_H / 2;
    const away = playerCenter < H / 2 ? 1 : -1; // +1 = quer mandar a bola pra baixo
    const bias = Math.min(0.34, (level - 1) * 0.03 + Math.max(0, rally - 6) * 0.02);
    const raw = (Math.random() * 2 - 1) * aiErrMag() - away * bias;
    ai.err = clamp(raw, -0.44, 0.44);
  }

  function playerX() {
    return PADDLE_MARGIN;
  }
  function aiX() {
    return W - PADDLE_MARGIN - PADDLE_W;
  }

  function placeBallCenter() {
    ball.x = W / 2;
    ball.y = H / 2;
    ball.vx = 0;
    ball.vy = 0;
    ballLive = false;
    trail = [];
  }
  // dir: -1 = saque em direção ao jogador, +1 = em direção à IA
  function launchBall(dir) {
    const speed = BALL_SPEED_START + Math.min((level - 1) * 0.12, 1.2);
    const angle = Math.random() * 0.8 - 0.4;
    ball.vx = dir * speed * Math.cos(angle);
    ball.vy = speed * Math.sin(angle);
    ballLive = true;
    rollAiErr();
  }
  function scheduleServe(dir) {
    placeBallCenter();
    clearTimeout(serveTimer);
    serveTimer = setTimeout(() => {
      if (running && !paused) launchBall(dir);
      else pendingServeDir = dir; // jogo ainda parado -- saca assim que começar
    }, SERVE_DELAY_MS);
  }
  let pendingServeDir = null;

  function reset() {
    player = { y: (H - PADDLE_H) / 2 };
    ai = { y: (H - PADDLE_H) / 2, err: 0 };
    ball = { x: W / 2, y: H / 2, vx: 0, vy: 0, r: BALL_R };
    ballLive = false;
    score = 0;
    lives = LIVES_START;
    level = 1;
    rally = 0;
    streak = 0;
    movingUp = false;
    movingDown = false;
    pointerTargetY = null;
    lastTimestamp = null;
    flashText = '';
    flashUntil = 0;
    shakeUntil = 0;
    playerFlashUntil = 0;
    aiFlashUntil = 0;
    particles = [];
    trail = [];
    pendingServeDir = null;
    clearTimeout(serveTimer);
    clearTimeout(flashTimer);
  }

  // ---------- efeitos ----------
  function spawnParticles(x, y, count, dirX) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.8 + Math.random() * 2.4;
      particles.push({ x, y, vx: Math.cos(a) * s + dirX * 1.2, vy: Math.sin(a) * s, life: 1, decay: 0.035 + Math.random() * 0.03 });
    }
    if (particles.length > 90) particles.splice(0, particles.length - 90);
  }
  function flash(text) {
    flashText = text;
    flashUntil = Date.now() + FLASH_MS;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashUntil = 0;
      if (running) draw();
    }, FLASH_MS);
  }

  // ---------- desenho ----------
  function drawCourt() {
    if (courtStyle === 'mesa') {
      // mesa de ping-pong vista de cima: tampo com uma lâmpada pendurada
      // acima (brilho quente no topo), borda branca, rede no meio e a
      // linha central fininha que divide a mesa no comprimento.
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, colors.panel);
      g.addColorStop(1, colors.bg);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      const lamp = ctx.createRadialGradient(W / 2, -20, 10, W / 2, -20, H * 1.05);
      lamp.addColorStop(0, 'rgba(255,230,170,0.22)');
      lamp.addColorStop(1, 'rgba(255,230,170,0)');
      ctx.fillStyle = lamp;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.strokeRect(5, 5, W - 10, H - 10);
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(6, H / 2);
      ctx.lineTo(W - 6, H / 2);
      ctx.stroke();
      // rede
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(W / 2, 5);
      ctx.lineTo(W / 2, H - 5);
      ctx.stroke();
      ctx.fillStyle = colors.ink;
      ctx.fillRect(W / 2 - 3, 1, 6, 6);
      ctx.fillRect(W / 2 - 3, H - 7, 6, 6);
      return;
    }
    if (courtStyle === 'caderno') {
      // folha de caderno: pautas azuladas, margem vermelha e a linha do
      // meio riscada a lápis (traços de tamanho irregular, mas sempre os
      // mesmos -- ver wobble()).
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = colors.line;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      for (let y = 22; y < H; y += 18) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(W, y + 0.5);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.danger;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(34.5, 0);
      ctx.lineTo(34.5, H);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.inkDim;
      ctx.lineWidth = 2;
      let y = 6;
      let i = 0;
      while (y < H - 4) {
        const dash = 9 + wobble(i) * 6;
        const gap = 8 + wobble(i + 50) * 4;
        const x = W / 2 + wobble(i + 100) * 2.2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + wobble(i + 150) * 1.6, y + dash);
        ctx.stroke();
        y += dash + gap;
        i++;
      }
      return;
    }
    // clássico
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = colors.line;
    for (let y = 6; y < H; y += 16) ctx.fillRect(W / 2 - 1, y, 2, 9);
  }

  function drawPaddle(x, y, isPlayer, flashActive) {
    // na mesa de ping-pong a bola já é a laranja do tema -- raquete do
    // jogador em vermelho (borracha de raquete de verdade) pra não
    // confundir uma com a outra.
    const base = courtStyle === 'mesa' ? (isPlayer ? colors.danger : colors.inkDim) : isPlayer ? colors.accent : colors.inkDim;
    if (courtStyle === 'caderno') {
      // retângulo "desenhado": preenchimento fraco + contorno de caneta
      // dobrado, levemente torto.
      ctx.fillStyle = base;
      ctx.globalAlpha = flashActive ? 0.55 : 0.28;
      ctx.fillRect(x, y, PADDLE_W, PADDLE_H);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1.6;
      ctx.strokeRect(x + 0.5, y + 0.5, PADDLE_W, PADDLE_H);
      ctx.strokeRect(x - 0.4, y + 1.2, PADDLE_W + 0.8, PADDLE_H - 1.6);
      return;
    }
    ctx.save();
    ctx.shadowColor = base;
    ctx.shadowBlur = flashActive ? 18 : 8;
    ctx.fillStyle = flashActive ? colors.ink : base;
    if (courtStyle === 'mesa' && ctx.roundRect) {
      // raquete de ping-pong: pá com borracha na cor do jogador
      // (roundRect não existe em navegador antigo -- cai no retângulo)
      ctx.beginPath();
      ctx.roundRect(x, y, PADDLE_W, PADDLE_H, 3);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, PADDLE_W, PADDLE_H);
    }
    ctx.restore();
  }

  function drawBall() {
    const now = Date.now();
    // rastro
    if (courtStyle !== 'caderno') {
      trail.forEach((p) => {
        const age = (now - p.t) / TRAIL_MS;
        if (age >= 1) return;
        ctx.globalAlpha = (1 - age) * 0.4;
        ctx.fillStyle = colors.accent;
        const r = ball.r * (1 - age * 0.55);
        ctx.beginPath();
        if (courtStyle === 'mesa') ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        else ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }
    // parada esperando o saque: pulsa pra chamar atenção
    const pulse = !ballLive ? 1 + Math.sin(now / 120) * 0.25 : 1;
    const r = ball.r * pulse;
    ctx.save();
    if (courtStyle === 'caderno') {
      // bolinha rabiscada: dois círculos tortos + miolo de marca-texto
      ctx.fillStyle = colors.warn;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, r + 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, r + 0.6, 0.2, Math.PI * 2 + 0.1);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ball.x + 0.5, ball.y - 0.4, r - 0.4, 1.1, Math.PI * 2 + 0.7);
      ctx.stroke();
    } else if (courtStyle === 'mesa') {
      ctx.shadowColor = colors.accent;
      ctx.shadowBlur = 12;
      ctx.fillStyle = colors.accent;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.arc(ball.x - r * 0.3, ball.y - r * 0.35, r * 0.32, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.shadowColor = colors.ink;
      ctx.shadowBlur = 10;
      ctx.fillStyle = colors.ink;
      ctx.fillRect(ball.x - r, ball.y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  function drawParticles() {
    particles.forEach((p) => {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = colors.accent;
      ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    });
    ctx.globalAlpha = 1;
  }

  function drawHud() {
    // vidas -- bolinhas desenhadas (mesmo motivo do Breakout: glifo de
    // coração em fonte monospace pequena renderiza torto)
    ctx.fillStyle = colors.danger;
    for (let i = 0; i < Math.max(0, lives); i++) {
      ctx.beginPath();
      ctx.arc(14 + i * 12, 12, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = colors.inkDim;
    ctx.font = '10px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(`NÍVEL ${level}`, W / 2, 12);
    ctx.textAlign = 'right';
    ctx.fillText(rally > 1 ? `rally ${rally}` : '', W - 12, 12);
  }

  function drawOverlayText(lines, y) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, y - 18, W, 36);
    ctx.fillStyle = colors.ink;
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(lines[0], W / 2, y - 7);
    ctx.fillText(lines[1], W / 2, y + 8);
  }

  function drawFlash() {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, H / 2 - 52, W, 26);
    ctx.fillStyle = colors.warn;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 13;
    ctx.font = `bold ${size}px monospace`;
    while (ctx.measureText(flashText).width > W - 10 && size > 8) {
      size -= 1;
      ctx.font = `bold ${size}px monospace`;
    }
    ctx.fillText(flashText, W / 2, H / 2 - 39);
  }

  function draw() {
    colors = readThemeColors();
    courtStyle = courtStyleOf();
    const now = Date.now();
    ctx.save();
    if (shakeUntil > now) {
      const k = (shakeUntil - now) / SHAKE_MS;
      ctx.translate((Math.random() - 0.5) * 6 * k, (Math.random() - 0.5) * 6 * k);
    }
    drawCourt();
    drawPaddle(playerX(), player.y, true, playerFlashUntil > now);
    drawPaddle(aiX(), ai.y, false, aiFlashUntil > now);
    drawParticles();
    drawBall();
    ctx.restore();
    drawHud();
    if (paused) drawOverlayText(['↑ ↓ (ou arraste)', 'pra mover e começar'], H / 2 + 28);
    else if (flashUntil > now) drawFlash();
  }

  // ---------- lógica ----------
  function loseLife() {
    lives -= 1;
    streak = 0;
    rally = 0;
    sfx.lifeLost();
    shakeUntil = Date.now() + SHAKE_MS;
    spawnParticles(0, ball.y, 14, 1);
    if (lives <= 0) {
      stop();
      sfx.gameOver();
      draw();
      onGameOver && onGameOver(score);
      return;
    }
    flash(`VIDA PERDIDA (${lives} ${lives === 1 ? 'restante' : 'restantes'})`);
    scheduleServe(-1);
  }

  function winPoint() {
    const gained = POINT_SCORE_BASE + (level - 1) * POINT_SCORE_PER_LEVEL + streak * STREAK_BONUS;
    streak += 1;
    level += 1;
    rally = 0;
    score += gained;
    onScoreChange && onScoreChange(score);
    sfx.pointWon();
    spawnParticles(W, ball.y, 16, -1);
    flash(streak >= 2 ? `PONTO! +${gained}  (x${streak} seguidos)` : `PONTO! +${gained}`);
    scheduleServe(-1);
  }

  function paddleHit(isPlayer) {
    const paddleY = isPlayer ? player.y : ai.y;
    const hitPos = clamp((ball.y - (paddleY + PADDLE_H / 2)) / (PADDLE_H / 2), -1, 1);
    const prev = Math.hypot(ball.vx, ball.vy);
    const speed = Math.min(prev + BALL_SPEED_STEP, BALL_SPEED_MAX);
    const angle = hitPos * MAX_BOUNCE_ANGLE;
    const dir = isPlayer ? 1 : -1;
    ball.vx = dir * speed * Math.cos(angle);
    ball.vy = speed * Math.sin(angle);
    // garante a fração horizontal mínima (cos(MAX_BOUNCE_ANGLE) já passa
    // do mínimo, mas fica de cinto de segurança se alguém mexer nas constantes)
    const minVx = speed * MIN_HORIZONTAL_RATIO;
    if (Math.abs(ball.vx) < minVx) {
      ball.vx = dir * minVx;
      ball.vy = Math.sign(ball.vy || 1) * Math.sqrt(Math.max(0, speed * speed - minVx * minVx));
    }
    ball.x = isPlayer ? playerX() + PADDLE_W + ball.r + 0.01 : aiX() - ball.r - 0.01;
    spawnParticles(ball.x, ball.y, 7, dir);
    if (isPlayer) {
      rally += 1;
      const gained = RETURN_SCORE + (rally - 1) * RALLY_BONUS;
      score += gained;
      onScoreChange && onScoreChange(score);
      playerFlashUntil = Date.now() + 130;
      sfx.paddleHit(rally);
      if (rally >= 4) flash(`RALLY x${rally}!`);
    } else {
      aiFlashUntil = Date.now() + 130;
      sfx.paddleHit(1);
      rollAiErr();
    }
  }

  // um sub-passo da bola (dx/dy já pequenos) -- devolve false se a
  // partida acabou ou o ponto foi decidido (quem chamou pára de andar)
  function stepBall(dx, dy) {
    ball.x += dx;
    ball.y += dy;

    if (ball.y - ball.r < 0) {
      ball.y = ball.r;
      ball.vy = Math.abs(ball.vy);
      sfx.wallBounce();
      spawnParticles(ball.x, 0, 3, 0);
    } else if (ball.y + ball.r > H) {
      ball.y = H - ball.r;
      ball.vy = -Math.abs(ball.vy);
      sfx.wallBounce();
      spawnParticles(ball.x, H, 3, 0);
    }

    // raquete do jogador -- bola indo pra esquerda, borda esquerda da
    // bola cruzou a frente da raquete, centro ainda não passou da traseira
    const px = playerX();
    if (
      ball.vx < 0 &&
      ball.x - ball.r <= px + PADDLE_W &&
      ball.x >= px &&
      ball.y + ball.r >= player.y &&
      ball.y - ball.r <= player.y + PADDLE_H
    ) {
      paddleHit(true);
      return true;
    }
    const ax = aiX();
    if (
      ball.vx > 0 &&
      ball.x + ball.r >= ax &&
      ball.x <= ax + PADDLE_W &&
      ball.y + ball.r >= ai.y &&
      ball.y - ball.r <= ai.y + PADDLE_H
    ) {
      paddleHit(false);
      return true;
    }

    if (ball.x + ball.r < 0) {
      loseLife();
      return false;
    }
    if (ball.x - ball.r > W) {
      winPoint();
      return false;
    }
    return true;
  }

  function moveBall(dtFrames) {
    const total = Math.max(Math.abs(ball.vx), Math.abs(ball.vy)) * dtFrames;
    const steps = Math.max(1, Math.ceil(total / MAX_STEP_PX));
    for (let i = 0; i < steps; i++) {
      if (!ballLive) return;
      if (!stepBall((ball.vx * dtFrames) / steps, (ball.vy * dtFrames) / steps)) return;
    }
  }

  function movePlayer(dtFrames) {
    if (movingUp || movingDown) {
      pointerTargetY = null; // teclado assumiu o comando
      if (movingUp) player.y -= PLAYER_SPEED * dtFrames;
      if (movingDown) player.y += PLAYER_SPEED * dtFrames;
    } else if (pointerTargetY !== null) {
      const diff = pointerTargetY - PADDLE_H / 2 - player.y;
      const maxMove = POINTER_SPEED * dtFrames;
      player.y += clamp(diff, -maxMove, maxMove);
    }
    player.y = clamp(player.y, 0, H - PADDLE_H);
  }

  function moveAi(dtFrames) {
    const center = ai.y + PADDLE_H / 2;
    let target = H / 2; // sem bola vindo, volta devagar pro meio
    if (ballLive && ball.vx > 0 && ball.x >= aiReactX()) target = ball.y + ai.err * PADDLE_H;
    const diff = target - center;
    if (Math.abs(diff) > 1.5) {
      const maxMove = (ballLive && ball.vx > 0 ? aiSpeed() : aiSpeed() * 0.45) * dtFrames;
      ai.y += clamp(diff, -maxMove, maxMove);
    }
    ai.y = clamp(ai.y, 0, H - PADDLE_H);
  }

  function updateParticles(dtFrames) {
    particles.forEach((p) => {
      p.x += p.vx * dtFrames;
      p.y += p.vy * dtFrames;
      p.life -= p.decay * dtFrames;
    });
    particles = particles.filter((p) => p.life > 0);
  }

  function tick(timestamp) {
    if (!running) return;
    const dtFrames = lastTimestamp === null ? 1 : Math.min((timestamp - lastTimestamp) / REF_FRAME_MS, MAX_DT_FRAMES);
    lastTimestamp = timestamp;

    movePlayer(dtFrames);
    moveAi(dtFrames);
    if (ballLive) {
      moveBall(dtFrames);
      if (ballLive) {
        trail.push({ x: ball.x, y: ball.y, t: Date.now() });
        const cutoff = Date.now() - TRAIL_MS;
        while (trail.length && trail[0].t < cutoff) trail.shift();
      }
    }
    updateParticles(dtFrames);

    if (!running) return; // loseLife() pode ter encerrado a partida acima
    draw();
    raf = requestAnimationFrame(tick);
  }

  // ---------- entrada ----------
  function begin() {
    if (!paused) return;
    paused = false;
    if (pendingServeDir !== null) {
      launchBall(pendingServeDir);
      pendingServeDir = null;
    }
    raf = requestAnimationFrame(tick);
  }

  function handleKey(e) {
    const up = e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W';
    const down = e.key === 'ArrowDown' || e.key === 's' || e.key === 'S';
    if (!up && !down && e.key !== ' ') return;
    e.preventDefault();
    begin();
    if (up) movingUp = true;
    if (down) movingDown = true;
  }
  function handleKeyUp(e) {
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') movingUp = false;
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') movingDown = false;
  }
  // mouse (só mover) ou dedo (arrastar) -- o paddle persegue a altura do
  // ponteiro com velocidade limitada (POINTER_SPEED). Aceita pointerdown
  // também, pra um toque simples já começar a partida.
  function handlePointer(e) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.height) return;
    pointerTargetY = clamp(((e.clientY - rect.top) * H) / rect.height, 0, H);
    if (e.type === 'pointerdown') begin();
    else if (paused && e.pointerType === 'touch') begin();
  }

  function start() {
    reset();
    paused = true;
    scheduleServe(-1);
    draw();
    onScoreChange && onScoreChange(score);
    running = true;
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    clearTimeout(serveTimer);
    clearTimeout(flashTimer);
  }

  return { start, stop, handleKey, handleKeyUp, handlePointer, get running() { return running; } };
}
