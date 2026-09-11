// Easter egg — Cobrinha clássica em canvas puro, sem lib externa
// (mesmo espírito zero-dependência do resto do projeto). Ver uso em
// src/screens/easterEggGames.js.
const CELL = 18;
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
    ctx.fillStyle = '#0a1114';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#ff5a5a';
    ctx.fillRect(food.x * CELL + 2, food.y * CELL + 2, CELL - 4, CELL - 4);

    snake.forEach((seg, i) => {
      ctx.fillStyle = i === 0 ? '#5ad4ff' : '#2f8fb3';
      ctx.fillRect(seg.x * CELL + 1, seg.y * CELL + 1, CELL - 2, CELL - 2);
    });
  }

  function tick() {
    dir = nextDir;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    const hitWall = head.x < 0 || head.x >= cols || head.y < 0 || head.y >= rows;
    const hitSelf = snake.some((s) => s.x === head.x && s.y === head.y);
    if (hitWall || hitSelf) {
      stop();
      onGameOver && onGameOver(score);
      return;
    }

    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score += 1;
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
