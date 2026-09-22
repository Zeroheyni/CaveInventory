// Easter egg — 2048 clássico em canvas puro (mesmo espírito zero-
// dependência dos outros jogos). Diferente de Cobrinha/Tetris/Flappy,
// não tem "tick" nem queda -- cada seta é uma jogada só (desliza,
// funde, sorteia uma peça nova), então não precisa de setInterval/rAF
// nenhum, só redesenha depois de cada jogada válida.
import { readThemeColors } from './theme.js';
import { sfx } from './sound.js';

const SIZE = 4;
const PAD = 10;
const CELL = 70;
const BOARD_PX = PAD + SIZE * (CELL + PAD);

function emptyBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

// tudo reduzido a "deslizar pra esquerda" (padrão clássico da
// implementação do 2048) -- as outras 3 direções só espelham/
// transpõem o tabuleiro antes e depois de chamar essa mesma função.
function slideLeft(board) {
  let moved = false;
  let scoreGained = 0;
  const newBoard = board.map((row) => {
    const compact = row.filter((v) => v !== 0);
    const merged = [];
    for (let i = 0; i < compact.length; i++) {
      if (i < compact.length - 1 && compact[i] === compact[i + 1]) {
        const val = compact[i] * 2;
        merged.push(val);
        scoreGained += val;
        i++; // a peça seguinte já foi consumida na fusão, não funde de novo
      } else {
        merged.push(compact[i]);
      }
    }
    while (merged.length < SIZE) merged.push(0);
    return merged;
  });
  newBoard.forEach((row, r) => row.forEach((v, c) => { if (v !== board[r][c]) moved = true; }));
  return { board: newBoard, scoreGained, moved };
}
function transpose(board) {
  return board[0].map((_, c) => board.map((row) => row[c]));
}
function reverseRows(board) {
  return board.map((row) => [...row].reverse());
}
function moveLeft(board) { return slideLeft(board); }
function moveRight(board) {
  const r = slideLeft(reverseRows(board));
  return { ...r, board: reverseRows(r.board) };
}
function moveUp(board) {
  const r = slideLeft(transpose(board));
  return { ...r, board: transpose(r.board) };
}
function moveDown(board) {
  const r = slideLeft(reverseRows(transpose(board)));
  return { ...r, board: transpose(reverseRows(r.board)) };
}

function emptyCells(board) {
  const cells = [];
  board.forEach((row, r) => row.forEach((v, c) => { if (v === 0) cells.push({ r, c }); }));
  return cells;
}
function spawnTile(board) {
  const cells = emptyCells(board);
  if (cells.length === 0) return false;
  const { r, c } = cells[Math.floor(Math.random() * cells.length)];
  board[r][c] = Math.random() < 0.9 ? 2 : 4;
  return true;
}
function isGameOver(board) {
  if (emptyCells(board).length > 0) return false;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = board[r][c];
      if (c < SIZE - 1 && board[r][c + 1] === v) return false;
      if (r < SIZE - 1 && board[r + 1][c] === v) return false;
    }
  }
  return true;
}

// cor do bloco por faixa de valor -- a paleta do tema só tem umas 6
// cores nomeadas (não uma rampa contínua como o 2048 original), então
// os tons ciclam de novo nos valores mais altos; a borda extra a
// partir de 128 é o que deixa "ficando sério" visível mesmo quando a
// cor repete.
function tileColor(colors, value) {
  if (value <= 2) return colors.panel;
  if (value <= 4) return colors.line;
  if (value <= 8) return colors.accentFaint;
  if (value <= 16) return colors.accent;
  if (value <= 32) return colors.accentCore;
  if (value <= 64) return colors.warn;
  if (value <= 128) return colors.danger;
  if (value <= 256) return colors.accent;
  if (value <= 512) return colors.accentCore;
  if (value <= 1024) return colors.warn;
  return colors.danger;
}

export function createGame2048(canvas, { onScoreChange, onGameOver }) {
  const ctx = canvas.getContext('2d');
  let board;
  let score;
  let running = false;
  let paused = true; // igual aos outros -- só sai do lugar depois da 1ª tecla
  let colors = readThemeColors();

  function reset() {
    board = emptyBoard();
    score = 0;
    spawnTile(board);
    spawnTile(board);
  }

  function drawRoundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() {
    colors = readThemeColors();
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const x = PAD + c * (CELL + PAD);
        const y = PAD + r * (CELL + PAD);
        const v = board[r][c];
        drawRoundRect(x, y, CELL, CELL, 8);
        ctx.fillStyle = v ? tileColor(colors, v) : colors.panel;
        ctx.fill();
        if (v >= 128) {
          drawRoundRect(x + 1, y + 1, CELL - 2, CELL - 2, 7);
          ctx.lineWidth = 2;
          ctx.strokeStyle = colors.ink;
          ctx.stroke();
        }
        if (v) {
          ctx.fillStyle = colors.ink;
          ctx.font = `bold ${v >= 1000 ? 19 : 23}px 'JetBrains Mono', monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(v), x + CELL / 2, y + CELL / 2 + 1);
        }
      }
    }

    if (paused) drawPausedOverlay();
  }
  function drawPausedOverlay() {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, canvas.height / 2 - 18, canvas.width, 36);
    ctx.fillStyle = colors.ink;
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('aperte uma seta pra começar', canvas.width / 2, canvas.height / 2);
  }

  function applyMove(dir) {
    if (!running) return;
    const fn = { left: moveLeft, right: moveRight, up: moveUp, down: moveDown }[dir];
    const result = fn(board);
    if (!result.moved) return; // jogada inválida (nada deslizou) -- não gasta turno nem sorteia peça
    board = result.board;
    score += result.scoreGained;
    sfx[result.scoreGained > 0 ? 'eat' : 'move']();
    onScoreChange && onScoreChange(score);
    spawnTile(board);
    draw();
    if (isGameOver(board)) {
      running = false;
      sfx.gameOver();
      onGameOver && onGameOver(score);
    }
  }

  function handleKey(e) {
    const map = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      w: 'up', s: 'down', a: 'left', d: 'right',
    };
    const dir = map[e.key];
    if (!dir) return;
    e.preventDefault();
    if (paused) paused = false;
    applyMove(dir);
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
  }

  return { start, stop, handleKey, get running() { return running; } };
}

export const BOARD_PIXEL_SIZE = BOARD_PX;
