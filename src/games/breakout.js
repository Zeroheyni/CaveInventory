// Easter egg — Breakout/Arkanoid em canvas puro, sem lib externa
// (mesmo espírito zero-dependência dos outros 4 jogos escondidos).
// Física contínua via requestAnimationFrame -- igual Flappy Bird, já
// nasce com delta-time normalizado (ver flappy.js: sem isso o jogo
// fica mais rápido ou mais devagar dependendo de quantos quadros por
// segundo o navegador entrega de verdade, que varia por tema).
import { readThemeColors } from './theme.js';
import { sfx } from './sound.js';

const REF_FRAME_MS = 1000 / 60; // constantes abaixo ajustadas "olhando" pra ~60fps
const MAX_DT_FRAMES = 4; // teto contra engasgo da aba (ver flappy.js)

const BRICK_ROWS = 5;
const BRICK_COLS = 7;
const BRICK_GAP = 3;
const BRICK_TOP_MARGIN = 26;
const BRICK_HEIGHT = 12;
const PADDLE_WIDTH = 46;
const PADDLE_HEIGHT = 8;
const PADDLE_BOTTOM_MARGIN = 14;
const PADDLE_SPEED = 4.4; // px por quadro de referência
const BALL_RADIUS = 4.5;
const BALL_SPEED = 3.3; // magnitude fixa -- não acelera com o tempo (mesmo espírito do Tetris: DROP_MS não muda)
const MAX_BOUNCE_ANGLE = 1.05; // rad (~60°) -- o quanto bater na ponta da raquete desvia a bola
const MIN_VERTICAL_RATIO = 0.5; // trava a bola de ficar "deitada" quicando só de lado pra lado sem nunca subir
const LIVES_START = 3;
const RELAUNCH_DELAY_MS = 700; // pausa depois de perder uma vida, antes de relançar sozinho
const COMBO_BONUS_PER_BRICK = 10;
const COMBO_FLASH_MS = 700;

function circleRectCollide(cx, cy, r, rx, ry, rw, rh) {
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < r * r;
}
// decide se a colisão foi mais "de lado" ou "de cima/baixo" comparando
// a sobreposição em X e em Y (a menor é o eixo que a bola acabou de
// atravessar) -- técnica clássica e simples, boa o bastante pra um
// jogo casual.
function resolveBrickBounce(ball, rect) {
  const rectCx = rect.x + rect.w / 2;
  const rectCy = rect.y + rect.h / 2;
  const dx = ball.x - rectCx;
  const dy = ball.y - rectCy;
  const overlapX = rect.w / 2 + ball.r - Math.abs(dx);
  const overlapY = rect.h / 2 + ball.r - Math.abs(dy);
  if (overlapX < overlapY) ball.vx = Math.sign(dx || 1) * Math.abs(ball.vx);
  else ball.vy = Math.sign(dy || 1) * Math.abs(ball.vy);
}
// depois de qualquer desvio (sobretudo o da raquete, que pode dar um
// ângulo bem raso), garante que a bola sempre tem uma boa parte de
// velocidade vertical -- sem isso, um ricochete quase horizontal podia
// ficar preso indo só de parede em parede, sem nunca subir de novo.
function clampMinVerticalSpeed(ball) {
  const speed = Math.hypot(ball.vx, ball.vy);
  const minVy = speed * MIN_VERTICAL_RATIO;
  if (Math.abs(ball.vy) >= minVy) return;
  const sign = ball.vy < 0 ? -1 : 1;
  ball.vy = sign * minVy;
  const remaining = Math.sqrt(Math.max(0, speed * speed - ball.vy * ball.vy));
  ball.vx = Math.sign(ball.vx || 1) * remaining;
}

export function createBreakoutGame(canvas, { onScoreChange, onGameOver }) {
  const ctx = canvas.getContext('2d');

  let paddleX, paddleW, paddleY;
  let ball;
  let ballLaunched = false;
  let bricks;
  let score, lives, combo;
  let movingLeft = false;
  let movingRight = false;
  let raf = null;
  let running = false;
  let paused = true; // igual aos outros -- só sai do lugar depois da 1ª tecla
  let lastTimestamp = null;
  let colors = readThemeColors();
  let comboFlashText = '';
  let comboFlashUntil = 0;
  let comboFlashTimer = null;
  let relaunchTimer = null;

  function buildBricks() {
    const brickW = (canvas.width - BRICK_GAP * (BRICK_COLS + 1)) / BRICK_COLS;
    const list = [];
    for (let r = 0; r < BRICK_ROWS; r++) {
      for (let c = 0; c < BRICK_COLS; c++) {
        list.push({
          x: BRICK_GAP + c * (brickW + BRICK_GAP),
          y: BRICK_TOP_MARGIN + r * (BRICK_HEIGHT + BRICK_GAP),
          w: brickW,
          h: BRICK_HEIGHT,
          row: r,
          alive: true,
          score: (BRICK_ROWS - r) * 10, // fileira de cima vale mais -- é a mais difícil de alcançar
        });
      }
    }
    return list;
  }

  function placeBallOnPaddle() {
    ball.x = paddleX + paddleW / 2;
    ball.y = paddleY - ball.r - 1;
    ball.vx = 0;
    ball.vy = 0;
    ballLaunched = false;
  }
  function launchBall() {
    const angle = -Math.PI / 2 + (Math.random() * 0.6 - 0.3); // quase reto pra cima, com uma variação pequena
    ball.vx = BALL_SPEED * Math.cos(angle);
    ball.vy = BALL_SPEED * Math.sin(angle);
    ballLaunched = true;
  }

  function reset() {
    paddleW = PADDLE_WIDTH;
    paddleY = canvas.height - PADDLE_BOTTOM_MARGIN - PADDLE_HEIGHT;
    paddleX = (canvas.width - paddleW) / 2;
    ball = { x: 0, y: 0, vx: 0, vy: 0, r: BALL_RADIUS };
    placeBallOnPaddle();
    bricks = buildBricks();
    score = 0;
    lives = LIVES_START;
    combo = 0;
    movingLeft = false;
    movingRight = false;
    lastTimestamp = null;
    clearTimeout(relaunchTimer);
    clearTimeout(comboFlashTimer);
    comboFlashText = '';
    comboFlashUntil = 0;
  }

  function draw() {
    colors = readThemeColors();
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // tijolos -- cor por fileira ciclando as cores do tema, da mais
    // "chamativa" (fileira de cima, vale mais) pra mais neutra (de
    // baixo, vale menos) -- reforça visualmente o valor de cada uma.
    const rowColors = [colors.danger, colors.warn, colors.accent, colors.accentCore, colors.inkDim];
    bricks.forEach((b) => {
      if (!b.alive) return;
      ctx.fillStyle = rowColors[b.row % rowColors.length];
      ctx.fillRect(b.x, b.y, b.w, b.h);
    });

    // raquete
    ctx.fillStyle = colors.ink;
    ctx.fillRect(paddleX, paddleY, paddleW, PADDLE_HEIGHT);

    // bola
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();

    // vidas -- não tem slot pra isso no placar de fora (só pontos/
    // recorde), então desenha aqui mesmo, cantinho de cima. Bolinha
    // desenhada em vez de um glifo de coração em texto -- '♥' em fonte
    // monospace pequena rendeley meio torto/ilegível dependendo da
    // fonte/navegador; um círculo sólido nunca falha.
    ctx.fillStyle = colors.danger;
    for (let i = 0; i < Math.max(0, lives); i++) {
      ctx.beginPath();
      ctx.arc(8 + i * 12, 10, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    if (paused) drawPausedOverlay();
    else if (comboFlashUntil > Date.now()) drawComboFlash();
  }
  function drawPausedOverlay() {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, canvas.height / 2 - 18, canvas.width, 36);
    ctx.fillStyle = colors.ink;
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('◄ ► pra mover', canvas.width / 2, canvas.height / 2 - 7);
    ctx.fillText('e começar', canvas.width / 2, canvas.height / 2 + 8);
  }
  function drawComboFlash() {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, canvas.height / 2 - 32, canvas.width, 26);
    ctx.fillStyle = colors.warn;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 13;
    ctx.font = `bold ${size}px monospace`;
    while (ctx.measureText(comboFlashText).width > canvas.width - 10 && size > 8) {
      size -= 1;
      ctx.font = `bold ${size}px monospace`;
    }
    ctx.fillText(comboFlashText, canvas.width / 2, canvas.height / 2 - 19);
  }

  function loseLife() {
    combo = 0;
    lives -= 1;
    sfx.lifeLost();
    if (lives <= 0) {
      stop();
      sfx.gameOver();
      onGameOver && onGameOver(score);
      return;
    }
    placeBallOnPaddle();
    clearTimeout(relaunchTimer);
    relaunchTimer = setTimeout(() => {
      if (running) launchBall();
    }, RELAUNCH_DELAY_MS);
  }

  function tick(timestamp) {
    if (!running) return;
    const dtFrames = lastTimestamp === null ? 1 : Math.min((timestamp - lastTimestamp) / REF_FRAME_MS, MAX_DT_FRAMES);
    lastTimestamp = timestamp;

    if (movingLeft) paddleX -= PADDLE_SPEED * dtFrames;
    if (movingRight) paddleX += PADDLE_SPEED * dtFrames;
    paddleX = Math.max(0, Math.min(canvas.width - paddleW, paddleX));

    if (!ballLaunched) {
      placeBallOnPaddle();
    } else {
      ball.x += ball.vx * dtFrames;
      ball.y += ball.vy * dtFrames;

      if (ball.x - ball.r < 0) {
        ball.x = ball.r;
        ball.vx = Math.abs(ball.vx);
        sfx.wallBounce();
      } else if (ball.x + ball.r > canvas.width) {
        ball.x = canvas.width - ball.r;
        ball.vx = -Math.abs(ball.vx);
        sfx.wallBounce();
      }
      if (ball.y - ball.r < 0) {
        ball.y = ball.r;
        ball.vy = Math.abs(ball.vy);
        sfx.wallBounce();
      }

      // raquete -- só considera se a bola tá descendo (evita "grudar"
      // nela batendo de novo antes de se afastar de verdade)
      if (ball.vy > 0 && circleRectCollide(ball.x, ball.y, ball.r, paddleX, paddleY, paddleW, PADDLE_HEIGHT)) {
        const hitPos = Math.max(-1, Math.min(1, (ball.x - (paddleX + paddleW / 2)) / (paddleW / 2)));
        const angle = -Math.PI / 2 + hitPos * MAX_BOUNCE_ANGLE;
        const speed = Math.hypot(ball.vx, ball.vy);
        ball.vx = speed * Math.cos(angle);
        ball.vy = speed * Math.sin(angle);
        clampMinVerticalSpeed(ball);
        ball.y = paddleY - ball.r - 0.5;
        combo = 0; // voltar na raquete reseta a sequência (o combo é POR RODADA da bola no ar)
        sfx.paddleBounce();
      }

      // tijolos -- só um por quadro (evita atravessar dois de uma vez
      // de um jeito estranho quando a bola tá rápida)
      for (const b of bricks) {
        if (!b.alive) continue;
        if (!circleRectCollide(ball.x, ball.y, ball.r, b.x, b.y, b.w, b.h)) continue;
        b.alive = false;
        resolveBrickBounce(ball, b);
        clampMinVerticalSpeed(ball);
        const gained = b.score + combo * COMBO_BONUS_PER_BRICK;
        combo += 1;
        score += gained;
        onScoreChange && onScoreChange(score);
        sfx.brick(combo);
        if (combo >= 2) {
          comboFlashText = `COMBO x${combo}! +${gained}`;
          comboFlashUntil = Date.now() + COMBO_FLASH_MS;
          clearTimeout(comboFlashTimer);
          comboFlashTimer = setTimeout(() => {
            comboFlashUntil = 0;
            draw();
          }, COMBO_FLASH_MS);
        }
        break;
      }

      if (bricks.every((b) => !b.alive)) bricks = buildBricks(); // "fase" nova -- sem fim, o que importa é o recorde de pontos

      if (ball.y - ball.r > canvas.height) {
        loseLife();
      }
    }

    draw();
    raf = requestAnimationFrame(tick);
  }

  function handleKey(e) {
    const isLeft = e.key === 'ArrowLeft' || e.key === 'a';
    const isRight = e.key === 'ArrowRight' || e.key === 'd';
    if (!isLeft && !isRight && e.key !== ' ') return;
    e.preventDefault();
    if (paused) {
      paused = false;
      if (!ballLaunched) launchBall();
      raf = requestAnimationFrame(tick);
    }
    if (isLeft) movingLeft = true;
    if (isRight) movingRight = true;
  }
  function handleKeyUp(e) {
    if (e.key === 'ArrowLeft' || e.key === 'a') movingLeft = false;
    if (e.key === 'ArrowRight' || e.key === 'd') movingRight = false;
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
    clearTimeout(relaunchTimer);
    clearTimeout(comboFlashTimer);
  }

  return { start, stop, handleKey, handleKeyUp, get running() { return running; } };
}
