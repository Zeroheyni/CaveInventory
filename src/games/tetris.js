// Easter egg — Tetris clássico em canvas puro, sem lib externa. Grid
// 10x20 padrão, 7 peças com "7-bag" (cada peça aparece uma vez antes
// de repetir, evita sequência de azar), rotação simples com uma
// tentativa de "kick" lateral se a rotação não couber no lugar.
const COLS = 10;
const ROWS = 20;
const CELL = 18;
const DROP_MS = 550;

const SHAPES = {
  I: { color: '#5ad4ff', matrix: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]] },
  O: { color: '#ffd93d', matrix: [[1, 1], [1, 1]] },
  T: { color: '#b98bff', matrix: [[0, 1, 0], [1, 1, 1], [0, 0, 0]] },
  S: { color: '#4ade80', matrix: [[0, 1, 1], [1, 1, 0], [0, 0, 0]] },
  Z: { color: '#ff5a5a', matrix: [[1, 1, 0], [0, 1, 1], [0, 0, 0]] },
  J: { color: '#4c8bff', matrix: [[1, 0, 0], [1, 1, 1], [0, 0, 0]] },
  L: { color: '#ff8a4c', matrix: [[0, 0, 1], [1, 1, 1], [0, 0, 0]] },
};
const LINE_SCORE = [0, 100, 300, 500, 800];

function rotateMatrix(m) {
  const n = m.length;
  const out = Array.from({ length: n }, () => Array(n).fill(0));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[x][n - 1 - y] = m[y][x];
  return out;
}

export function createTetrisGame(canvas, { onScoreChange, onGameOver }) {
  const ctx = canvas.getContext('2d');
  let board;
  let bag = [];
  let piece;
  let score;
  let timer = null;
  let running = false;

  function nextFromBag() {
    if (bag.length === 0) bag = Object.keys(SHAPES).sort(() => Math.random() - 0.5);
    return bag.pop();
  }

  function spawnPiece() {
    const type = nextFromBag();
    const def = SHAPES[type];
    const matrix = def.matrix.map((row) => row.slice());
    const p = { type, color: def.color, matrix, x: Math.floor((COLS - matrix.length) / 2), y: -1 };
    if (!canPlace(p.matrix, p.x, p.y + 1)) {
      stop();
      onGameOver && onGameOver(score);
      return null;
    }
    return p;
  }

  function canPlace(matrix, px, py) {
    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix[y].length; x++) {
        if (!matrix[y][x]) continue;
        const bx = px + x;
        const by = py + y;
        if (bx < 0 || bx >= COLS || by >= ROWS) return false;
        if (by >= 0 && board[by][bx]) return false;
      }
    }
    return true;
  }

  function lockPiece() {
    piece.matrix.forEach((row, y) =>
      row.forEach((cell, x) => {
        if (!cell) return;
        const by = piece.y + y;
        const bx = piece.x + x;
        if (by >= 0) board[by][bx] = piece.color;
      })
    );
    const cleared = clearLines();
    if (cleared > 0) {
      score += LINE_SCORE[cleared] || 0;
      onScoreChange && onScoreChange(score);
    }
    piece = spawnPiece();
  }

  function clearLines() {
    let cleared = 0;
    board = board.filter((row) => {
      const full = row.every((cell) => cell);
      if (full) cleared++;
      return !full;
    });
    while (board.length < ROWS) board.unshift(Array(COLS).fill(null));
    return cleared;
  }

  function draw() {
    ctx.fillStyle = '#0a1114';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    board.forEach((row, y) =>
      row.forEach((color, x) => {
        if (color) drawCell(x, y, color);
      })
    );
    if (piece) {
      piece.matrix.forEach((row, y) =>
        row.forEach((cell, x) => {
          if (cell && piece.y + y >= 0) drawCell(piece.x + x, piece.y + y, piece.color);
        })
      );
    }
  }
  function drawCell(x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
  }

  function tick() {
    softDrop();
  }
  function softDrop() {
    if (!piece) return;
    if (canPlace(piece.matrix, piece.x, piece.y + 1)) {
      piece.y += 1;
    } else {
      lockPiece();
    }
    draw();
  }
  function hardDrop() {
    if (!piece) return;
    while (canPlace(piece.matrix, piece.x, piece.y + 1)) piece.y += 1;
    lockPiece();
    draw();
  }

  function handleKey(e) {
    if (!piece) return;
    if (e.key === 'ArrowLeft' || e.key === 'a') {
      e.preventDefault();
      if (canPlace(piece.matrix, piece.x - 1, piece.y)) piece.x -= 1;
    } else if (e.key === 'ArrowRight' || e.key === 'd') {
      e.preventDefault();
      if (canPlace(piece.matrix, piece.x + 1, piece.y)) piece.x += 1;
    } else if (e.key === 'ArrowDown' || e.key === 's') {
      e.preventDefault();
      softDrop();
      return;
    } else if (e.key === 'ArrowUp' || e.key === 'w') {
      e.preventDefault();
      const rotated = rotateMatrix(piece.matrix);
      if (canPlace(rotated, piece.x, piece.y)) piece.matrix = rotated;
      else if (canPlace(rotated, piece.x - 1, piece.y)) {
        piece.matrix = rotated;
        piece.x -= 1;
      } else if (canPlace(rotated, piece.x + 1, piece.y)) {
        piece.matrix = rotated;
        piece.x += 1;
      }
    } else if (e.key === ' ') {
      e.preventDefault();
      hardDrop();
      return;
    } else {
      return;
    }
    draw();
  }

  function start() {
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    bag = [];
    score = 0;
    piece = spawnPiece();
    draw();
    onScoreChange && onScoreChange(score);
    running = true;
    timer = setInterval(tick, DROP_MS);
  }
  function stop() {
    running = false;
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, handleKey, get running() { return running; } };
}
