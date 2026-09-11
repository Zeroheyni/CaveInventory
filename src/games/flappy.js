// Easter egg — Flappy Bird em canvas puro. Loop via
// requestAnimationFrame (os outros dois jogos são baseados em grade/
// tick fixo -- esse precisa de movimento suave). Espaço/seta pra cima/
// clique no canvas faz o pássaro bater asa.
import { readThemeColors } from './theme.js';
import { sfx } from './sound.js';

const GRAVITY = 0.35;
const FLAP_VELOCITY = -6.6;
const PIPE_SPEED = 2.6;
const PIPE_GAP = 130;
const PIPE_WIDTH = 48;
const PIPE_SPACING = 210; // distância horizontal entre um cano e o próximo
const BIRD_RADIUS = 11;
const BIRD_X_RATIO = 0.28;

export function createFlappyGame(canvas, { onScoreChange, onGameOver }) {
  const ctx = canvas.getContext('2d');
  const birdX = Math.round(canvas.width * BIRD_X_RATIO);

  let birdY;
  let velocity;
  let pipes;
  let score;
  let raf = null;
  let running = false;
  let colors = readThemeColors();

  function reset() {
    birdY = canvas.height / 2;
    velocity = 0;
    pipes = [{ x: canvas.width + 40, gapY: randomGapY() }];
    score = 0;
  }

  function randomGapY() {
    const margin = 60;
    return margin + Math.random() * (canvas.height - PIPE_GAP - margin * 2);
  }

  function flap() {
    if (!running) return;
    velocity = FLAP_VELOCITY;
    sfx.flap();
  }

  function draw() {
    colors = readThemeColors();
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // canos
    pipes.forEach((p) => {
      ctx.fillStyle = colors.accentCore;
      ctx.fillRect(p.x, 0, PIPE_WIDTH, p.gapY);
      ctx.fillRect(p.x, p.gapY + PIPE_GAP, PIPE_WIDTH, canvas.height - (p.gapY + PIPE_GAP));
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x + 1, 0, PIPE_WIDTH - 2, p.gapY);
      ctx.strokeRect(p.x + 1, p.gapY + PIPE_GAP, PIPE_WIDTH - 2, canvas.height - (p.gapY + PIPE_GAP));
    });

    // pássaro
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(birdX, birdY, BIRD_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function tick() {
    if (!running) return;
    velocity += GRAVITY;
    birdY += velocity;

    pipes.forEach((p) => (p.x -= PIPE_SPEED));
    if (pipes[pipes.length - 1].x < canvas.width - PIPE_SPACING) {
      pipes.push({ x: canvas.width, gapY: randomGapY() });
    }
    pipes = pipes.filter((p) => p.x + PIPE_WIDTH > -5);

    pipes.forEach((p) => {
      if (!p.scored && p.x + PIPE_WIDTH < birdX) {
        p.scored = true;
        score += 1;
        sfx.score();
        onScoreChange && onScoreChange(score);
      }
    });

    const hitBounds = birdY - BIRD_RADIUS < 0 || birdY + BIRD_RADIUS > canvas.height;
    const hitPipe = pipes.some((p) => {
      const withinX = birdX + BIRD_RADIUS > p.x && birdX - BIRD_RADIUS < p.x + PIPE_WIDTH;
      if (!withinX) return false;
      return birdY - BIRD_RADIUS < p.gapY || birdY + BIRD_RADIUS > p.gapY + PIPE_GAP;
    });

    if (hitBounds || hitPipe) {
      stop();
      sfx.gameOver();
      onGameOver && onGameOver(score);
      return;
    }

    draw();
    raf = requestAnimationFrame(tick);
  }

  function handleKey(e) {
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w') {
      e.preventDefault();
      flap();
    }
  }
  function handleClick() {
    flap();
  }

  function start() {
    reset();
    draw();
    onScoreChange && onScoreChange(score);
    running = true;
    raf = requestAnimationFrame(tick);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  return { start, stop, handleKey, handleClick, get running() { return running; } };
}
