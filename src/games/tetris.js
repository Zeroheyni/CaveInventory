// Easter egg — Tetris clássico em canvas puro, sem lib externa. Grid
// 10x20 padrão, 7 peças com "7-bag" (cada peça aparece uma vez antes
// de repetir), rotação simples com uma tentativa de "kick" lateral se
// a rotação não couber, peça guardada (tecla C), preview da próxima
// peça/peça guardada e "peça fantasma" mostrando onde vai cair.
import { readThemeColors } from './theme.js';
import { sfx } from './sound.js';

const COLS = 10;
const ROWS = 20;
const CELL = 20;
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

function rotateCW(m) {
  const n = m.length;
  const out = Array.from({ length: n }, () => Array(n).fill(0));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[x][n - 1 - y] = m[y][x];
  return out;
}
// anti-horário é só o horário aplicado 3x -- mais simples e menos
// sujeito a erro de índice do que rederivar a fórmula na mão.
function rotateCCW(m) {
  return rotateCW(rotateCW(rotateCW(m)));
}

// canvas principal é o tabuleiro; nextCanvas/holdCanvas (opcionais) são
// os quadradinhos de preview da próxima peça e da peça guardada.
export function createTetrisGame(canvas, { nextCanvas, holdCanvas, onScoreChange, onGameOver }) {
  const ctx = canvas.getContext('2d');
  let board;
  let bag = [];
  let piece;
  let nextType;
  let heldType = null;
  let canHold = true;
  let score;
  let timer = null;
  let running = false;
  let colors = readThemeColors();

  function nextFromBag() {
    if (bag.length === 0) bag = Object.keys(SHAPES).sort(() => Math.random() - 0.5);
    return bag.pop();
  }

  function buildPiece(type) {
    const def = SHAPES[type];
    const matrix = def.matrix.map((row) => row.slice());
    return { type, color: def.color, matrix, x: Math.floor((COLS - matrix.length) / 2), y: -1 };
  }

  // `forceType` é usado pela troca com a peça guardada -- nesse caso
  // não mexe no saco/`nextType`, só materializa o tipo que já estava
  // guardado.
  function spawnPiece(forceType) {
    const type = forceType || nextType;
    if (!forceType) nextType = nextFromBag();
    const p = buildPiece(type);
    if (!canPlace(p.matrix, p.x, p.y + 1)) {
      stop();
      sfx.gameOver();
      onGameOver && onGameOver(score);
      return null;
    }
    drawPreview(nextCanvas, nextType);
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

  function ghostY() {
    let gy = piece.y;
    while (canPlace(piece.matrix, piece.x, gy + 1)) gy++;
    return gy;
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
      sfx.lineClear(cleared);
      onScoreChange && onScoreChange(score);
    } else {
      sfx.drop();
    }
    canHold = true;
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

  function drawGrid() {
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * CELL + 0.5, 0);
      ctx.lineTo(x * CELL + 0.5, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * CELL + 0.5);
      ctx.lineTo(canvas.width, y * CELL + 0.5);
      ctx.stroke();
    }
  }

  function draw() {
    colors = readThemeColors();
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawGrid();

    board.forEach((row, y) =>
      row.forEach((color, x) => {
        if (color) drawCell(x, y, color);
      })
    );

    if (piece) {
      // peça fantasma -- prévia translúcida de onde a peça cai se
      // continuar descendo reto a partir da posição atual.
      const gy = ghostY();
      ctx.globalAlpha = 0.22;
      piece.matrix.forEach((row, y) =>
        row.forEach((cell, x) => {
          if (cell && gy + y >= 0) drawCell(piece.x + x, gy + y, piece.color);
        })
      );
      ctx.globalAlpha = 1;

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

  // desenha o mini-preview de próxima peça/peça guardada num canvas à
  // parte (pode não existir -- os dois são opcionais).
  function drawPreview(previewCanvas, type) {
    if (!previewCanvas) return;
    const pctx = previewCanvas.getContext('2d');
    pctx.fillStyle = colors.bg;
    pctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    if (!type) return;
    const def = SHAPES[type];
    const n = def.matrix.length;
    const cell = Math.floor(previewCanvas.width / 4);
    const offsetX = Math.floor((previewCanvas.width - n * cell) / 2);
    const offsetY = Math.floor((previewCanvas.height - n * cell) / 2);
    def.matrix.forEach((row, y) =>
      row.forEach((v, x) => {
        if (!v) return;
        pctx.fillStyle = def.color;
        pctx.fillRect(offsetX + x * cell + 1, offsetY + y * cell + 1, cell - 2, cell - 2);
      })
    );
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
  function holdSwap() {
    if (!piece || !canHold) return;
    const currentType = piece.type;
    if (heldType === null) {
      heldType = currentType;
      piece = spawnPiece();
    } else {
      const swapType = heldType;
      heldType = currentType;
      piece = spawnPiece(swapType);
    }
    if (!piece) return; // spawnPiece já tratou o fim de jogo
    canHold = false;
    sfx.hold();
    drawPreview(holdCanvas, heldType);
    draw();
  }

  // tenta girar pro lado pedido (1 = horário, -1 = anti-horário) --
  // se não couber na posição atual, tenta um "kick" de 1 célula pra
  // esquerda ou direita antes de desistir do giro.
  function tryRotate(dir) {
    const rotated = (dir === 1 ? rotateCW : rotateCCW)(piece.matrix);
    if (canPlace(rotated, piece.x, piece.y)) {
      piece.matrix = rotated;
      sfx.rotate();
    } else if (canPlace(rotated, piece.x - 1, piece.y)) {
      piece.matrix = rotated;
      piece.x -= 1;
      sfx.rotate();
    } else if (canPlace(rotated, piece.x + 1, piece.y)) {
      piece.matrix = rotated;
      piece.x += 1;
      sfx.rotate();
    }
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
    } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'x' || e.key === 'X') {
      // seta pra cima/W e X giram no sentido horário
      e.preventDefault();
      tryRotate(1);
    } else if (e.key === 'z' || e.key === 'Z') {
      // Z gira no sentido anti-horário
      e.preventDefault();
      tryRotate(-1);
    } else if (e.key === ' ') {
      e.preventDefault();
      hardDrop();
      return;
    } else if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      holdSwap();
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
    heldType = null;
    canHold = true;
    colors = readThemeColors();
    nextType = nextFromBag();
    piece = spawnPiece();
    drawPreview(holdCanvas, heldType);
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
