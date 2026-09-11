// Easter egg — Cobrinha clássica em canvas puro, sem lib externa
// (mesmo espírito zero-dependência do resto do projeto). Ver uso em
// src/screens/easterEggGames.js.
import { readThemeColors } from './theme.js';
import { sfx } from './sound.js';

const CELL = 20;
const TICK_MS = 130;

// devolve { start(), stop(), handleKey(e) } -- onScoreChange(score) a
// cada comida, onGameOver(score) quando bate na parede ou no próprio
// corpo. canvas.width/height já vêm setados pelo chamador (múltiplos
// exatos de CELL).
export function createSnakeGame(canvas, { onScoreChange, onGameOver }) {
  const ctx = canvas.getContext('2d');
  const cols = Math.floor(canvas.width / CELL);
  const rows = Math.floor(canvas.height / CELL);

  let snake;
  let dir;
  let nextDir;
  let food;
  let score;
  let timer = null;
  let running = false;
  let colors = readThemeColors();

  function randomFood() {
    let cell;
    do {
      cell = { x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) };
    } while (snake.some((s) => s.x === cell.x && s.y === cell.y));
    return cell;
  }

  function reset() {
    snake = [
      { x: Math.floor(cols / 2), y: Math.floor(rows / 2) },
      { x: Math.floor(cols / 2) - 1, y: Math.floor(rows / 2) },
      { x: Math.floor(cols / 2) - 2, y: Math.floor(rows / 2) },
    ];
    dir = { x: 1, y: 0 };
    nextDir = dir;
    score = 0;
    food = randomFood();
  }

  function draw() {
    colors = readThemeColors();
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // grade de cada célula que a cobra pode andar -- pedido explícito
    // pra deixar visível onde cada "passo" cabe, não só a borda de
    // fora.
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x++) {
      ctx.beginPath();
      ctx.moveTo(x * CELL + 0.5, 0);
      ctx.lineTo(x * CELL + 0.5, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= rows; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * CELL + 0.5);
      ctx.lineTo(canvas.width, y * CELL + 0.5);
      ctx.stroke();
    }

    ctx.fillStyle = colors.danger;
    ctx.fillRect(food.x * CELL + 3, food.y * CELL + 3, CELL - 6, CELL - 6);

    snake.forEach((seg, i) => {
      ctx.fillStyle = i === 0 ? colors.accent : colors.accentCore;
      ctx.fillRect(seg.x * CELL + 2, seg.y * CELL + 2, CELL - 4, CELL - 4);
    });
  }

  function tick() {
    dir = nextDir;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    const hitWall = head.x < 0 || head.x >= cols || head.y < 0 || head.y >= rows;
    const hitSelf = snake.some((s) => s.x === head.x && s.y === head.y);
    if (hitWall || hitSelf) {
      stop();
      sfx.gameOver();
      onGameOver && onGameOver(score);
      return;
    }

    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score += 1;
      sfx.eat();
      onScoreChange && onScoreChange(score);
      food = randomFood();
    } else {
      snake.pop();
    }
    draw();
  }

  function handleKey(e) {
    const map = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      w: { x: 0, y: -1 },
      s: { x: 0, y: 1 },
      a: { x: -1, y: 0 },
      d: { x: 1, y: 0 },
    };
    const next = map[e.key];
    if (!next) return;
    e.preventDefault();
    // trava virar 180° em cima da própria direção atual (não da
    // `nextDir` pendente, pra dois toques rápidos não matarem a cobra
    // virando nela mesma antes do próximo tick processar o primeiro)
    if (next.x === -dir.x && next.y === -dir.y) return;
    nextDir = next;
  }

  function start() {
    reset();
    draw();
    onScoreChange && onScoreChange(score);
    running = true;
    timer = setInterval(tick, TICK_MS);
  }
  function stop() {
    running = false;
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, handleKey, get running() { return running; } };
}
