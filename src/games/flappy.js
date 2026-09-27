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
// as constantes acima foram ajustadas "olhando" pra ~60 quadros por
// segundo -- REF_FRAME_MS é 1 quadro nessa taxa de referência.
const REF_FRAME_MS = 1000 / 60;
// teto no "pulo" de tempo entre um quadro e outro -- sem isso, se a
// aba ficasse presa/trocada de foco por um instante, o próximo quadro
// vinha com um dt gigante e o passaro "teleportava" (atravessava cano
// que nem bala, ou simplesmente sumia da tela).
const MAX_DT_FRAMES = 4;

export function createFlappyGame(canvas, { onScoreChange, onGameOver }) {
  const ctx = canvas.getContext('2d');
  const birdX = Math.round(canvas.width * BIRD_X_RATIO);

  let birdY;
  let velocity;
  let pipes;
  let score;
  let raf = null;
  let running = false;
  // Diferente de Cobrinha/Tetris (setInterval, ritmo fixo em
  // milissegundos reais), o Flappy usa requestAnimationFrame direto --
  // e cada tick() assumia "1 quadro = 1 unidade de tempo fixa", sem
  // olhar quanto tempo realmente passou entre um quadro e outro. Isso
  // deixava o jogo mais rápido ou mais lento dependendo de quantos
  // quadros por segundo o navegador realmente entregava (variava por
  // tema: os temas com uma animação de fundo contínua mantêm o
  // navegador compondo a tela sem parar, enquanto um tema parado podia
  // ser "otimizado"/desacelerado pelo navegador -- só o Flappy sofria,
  // porque só ele não tem um ritmo fixo em milissegundos). Fix: guarda
  // o instante do quadro anterior e escala gravidade/velocidade/
  // velocidade dos canos pelo tempo de verdade que passou, sempre na
  // MESMA velocidade real (em segundos), não importa o tema nem o
  // monitor.
  let lastTimestamp = null;
  let paused = true; // começa parado até o 1º flap -- senão o pássaro já cai sozinho e nem dá tempo de reagir
  let colors = readThemeColors();

  function reset() {
    birdY = canvas.height / 2;
    velocity = 0;
    pipes = [{ x: canvas.width + 40, gapY: randomGapY() }];
    score = 0;
    lastTimestamp = null;
  }

  function randomGapY() {
    const margin = 60;
    return margin + Math.random() * (canvas.height - PIPE_GAP - margin * 2);
  }

  function flap() {
    if (!running) return;
    velocity = FLAP_VELOCITY;
    sfx.flap();
    if (paused) {
      paused = false;
      raf = requestAnimationFrame(tick);
    }
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

    if (paused) drawPausedOverlay();
  }
  function drawPausedOverlay() {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, canvas.height / 2 - 18, canvas.width, 36);
    ctx.fillStyle = colors.ink;
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('espaço/clique pra começar', canvas.width / 2, canvas.height / 2);
  }

  function tick(timestamp) {
    if (!running) return;
    // 1ª chamada da sessão (logo após o 1º flap): sem quadro anterior
    // pra comparar, assume um quadro de referência normal (dt=1).
    const dtFrames = lastTimestamp === null ? 1 : Math.min((timestamp - lastTimestamp) / REF_FRAME_MS, MAX_DT_FRAMES);
    lastTimestamp = timestamp;

    velocity += GRAVITY * dtFrames;
    birdY += velocity * dtFrames;

    pipes.forEach((p) => (p.x -= PIPE_SPEED * dtFrames));
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

  return { start, stop, handleKey, handleClick, get running() { return running; } };
}
