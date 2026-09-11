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
// "lock delay" -- tempo extra depois que a peça encosta em algo antes
// de travar de vez (igual Tetris de verdade), pra dar aquele último
// segundo de ajuste fino. Qualquer movimento/giro válido reinicia essa
// contagem; só o tempo parado sem mexer é que trava.
const LOCK_DELAY_MS = 500;
// DAS/ARR -- "delayed auto shift"/"auto repeat rate": segurar
// esquerda/direita move uma vez na hora, espera DAS_MS, e a partir
// daí repete a cada ARR_MS enquanto a tecla continuar pressionada.
// Sem isso, mover ficava travado no ritmo de key-repeat do sistema
// operacional (inconsistente entre SOs, geralmente lento demais pra
// Tetris). ARR do soft drop é o mesmo espírito, só que bem mais
// rápido, pra descer rapidinho segurando pra baixo.
const DAS_MS = 130;
const ARR_MS = 35;
const SOFT_DROP_MS = 35;
// quanto tempo a linha completa pisca antes de sumir de vez -- dá o
// "feedback" de que a linha realmente foi contada, em vez de só
// desaparecer sem aviso.
const LINE_FLASH_MS = 160;

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
  let lockTimer = null; // contagem do "lock delay" -- null enquanto a peça não encostou em nada
  let running = false;
  let paused = true; // começa parada até a 1ª tecla -- senão a peça já cai sozinha e nem dá tempo de reagir
  let colors = readThemeColors();
  let flashingRows = []; // linhas completas piscando antes de sumir de vez

  let heldDir = null; // 'left' | 'right' | null -- lado que está sendo segurado (DAS/ARR)
  let dasTimeout = null;
  let arrInterval = null;
  let softDropHeld = false;
  let softDropInterval = null;

  function clearLockTimer() {
    if (lockTimer) clearTimeout(lockTimer);
    lockTimer = null;
  }
  function stopHorizontalHold() {
    heldDir = null;
    if (dasTimeout) clearTimeout(dasTimeout);
    if (arrInterval) clearInterval(arrInterval);
    dasTimeout = null;
    arrInterval = null;
  }
  function stopSoftDropHold() {
    softDropHeld = false;
    if (softDropInterval) clearInterval(softDropInterval);
    softDropInterval = null;
  }

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

    const fullRows = [];
    board.forEach((row, i) => {
      if (row.every((cell) => cell)) fullRows.push(i);
    });

    if (fullRows.length === 0) {
      sfx.drop();
      canHold = true;
      piece = spawnPiece();
      return;
    }

    // pisca a linha completa por um instante antes de sumir de vez --
    // sem "piece" nenhuma cai durante esse tempinho (spawnPiece só
    // acontece depois que o board já reflete as linhas removidas).
    flashingRows = fullRows;
    piece = null;
    sfx.lineClear(fullRows.length);
    draw();
    setTimeout(() => {
      flashingRows = [];
      board = board.filter((_, i) => !fullRows.includes(i));
      while (board.length < ROWS) board.unshift(Array(COLS).fill(null));
      score += LINE_SCORE[fullRows.length] || 0;
      onScoreChange && onScoreChange(score);
      canHold = true;
      piece = spawnPiece();
      draw();
    }, LINE_FLASH_MS);
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

    board.forEach((row, y) => {
      if (flashingRows.includes(y)) {
        ctx.fillStyle = colors.ink;
        ctx.fillRect(0, y * CELL, canvas.width, CELL);
        return;
      }
      row.forEach((color, x) => {
        if (color) drawCell(x, y, color);
      });
    });

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

    if (paused) drawPausedOverlay();
  }
  function drawCell(x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
  }
  function drawPausedOverlay() {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, canvas.height / 2 - 18, canvas.width, 36);
    ctx.fillStyle = colors.ink;
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('aperte uma tecla', canvas.width / 2, canvas.height / 2 - 7);
    ctx.fillText('pra começar', canvas.width / 2, canvas.height / 2 + 8);
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
      clearLockTimer(); // saiu do "pouso" -- qualquer trava pendente não vale mais
    } else if (!lockTimer) {
      // encostou em algo pela primeira vez -- só trava de vez depois
      // do lock delay, não na hora (dá tempo de ajustar no último
      // segundo, igual Tetris de verdade).
      lockTimer = setTimeout(() => {
        lockTimer = null;
        lockPiece();
        draw();
      }, LOCK_DELAY_MS);
    }
    draw();
  }
  function hardDrop() {
    if (!piece) return;
    clearLockTimer();
    while (canPlace(piece.matrix, piece.x, piece.y + 1)) piece.y += 1;
    lockPiece();
    draw();
  }

  function moveHorizontal(dx) {
    if (!piece) return;
    if (canPlace(piece.matrix, piece.x + dx, piece.y)) {
      piece.x += dx;
      refreshLockDelay();
      draw();
    }
  }
  // começa a segurar um lado -- move uma vez na hora, e só depois do
  // DAS liga o auto-repeat (ARR). Chamado de novo enquanto já segura o
  // MESMO lado não faz nada (o "repeat" do teclado do sistema fica de
  // fora -- handleKey já ignora e.repeat pra essas teclas).
  function startHorizontalHold(dir) {
    if (heldDir === dir) return;
    stopHorizontalHold();
    heldDir = dir;
    const dx = dir === 'left' ? -1 : 1;
    moveHorizontal(dx);
    dasTimeout = setTimeout(() => {
      arrInterval = setInterval(() => moveHorizontal(dx), ARR_MS);
    }, DAS_MS);
  }
  function startSoftDropHold() {
    if (softDropHeld) return;
    softDropHeld = true;
    softDrop();
    softDropInterval = setInterval(softDrop, SOFT_DROP_MS);
  }
  // reinicia (ou cancela) o lock delay depois de um movimento/giro --
  // se a peça ainda está pousada em algo, ganha mais tempo; se saiu do
  // pouso (ex: girou por baixo de um saliente), cancela a trava.
  function refreshLockDelay() {
    if (!piece) return;
    clearLockTimer();
    if (!canPlace(piece.matrix, piece.x, piece.y + 1)) {
      lockTimer = setTimeout(() => {
        lockTimer = null;
        lockPiece();
        draw();
      }, LOCK_DELAY_MS);
    }
  }
  function holdSwap() {
    if (!piece || !canHold) return;
    clearLockTimer();
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

  const CONTROL_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's', 'x', 'X', 'z', 'Z', ' ', 'c', 'C'];

  function handleKey(e) {
    if (!piece || !CONTROL_KEYS.includes(e.key)) return;
    e.preventDefault();
    if (paused) {
      paused = false;
      timer = setInterval(tick, DROP_MS);
    }
    // ignora o key-repeat automático do sistema operacional -- mover/
    // segurar pra baixo já tem o próprio ritmo (DAS/ARR/soft drop
    // acima), e girar/derrubar/guardar são ações de toque único, não
    // devem repetir sozinhas só porque a tecla ficou pressionada.
    if (e.repeat) return;
    if (e.key === 'ArrowLeft' || e.key === 'a') {
      startHorizontalHold('left');
    } else if (e.key === 'ArrowRight' || e.key === 'd') {
      startHorizontalHold('right');
    } else if (e.key === 'ArrowDown' || e.key === 's') {
      startSoftDropHold();
    } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'x' || e.key === 'X') {
      // seta pra cima/W e X giram no sentido horário
      tryRotate(1);
      refreshLockDelay();
      draw();
    } else if (e.key === 'z' || e.key === 'Z') {
      // Z gira no sentido anti-horário
      tryRotate(-1);
      refreshLockDelay();
      draw();
    } else if (e.key === ' ') {
      hardDrop();
    } else if (e.key === 'c' || e.key === 'C') {
      holdSwap();
    }
  }

  // solta a tecla -- desliga o auto-repeat de mover/soft-drop
  // correspondente, se for o que estava segurado.
  function handleKeyUp(e) {
    if ((e.key === 'ArrowLeft' || e.key === 'a') && heldDir === 'left') {
      stopHorizontalHold();
    } else if ((e.key === 'ArrowRight' || e.key === 'd') && heldDir === 'right') {
      stopHorizontalHold();
    } else if (e.key === 'ArrowDown' || e.key === 's') {
      stopSoftDropHold();
    }
  }

  function start() {
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    bag = [];
    score = 0;
    heldType = null;
    canHold = true;
    paused = true;
    flashingRows = [];
    clearLockTimer();
    stopHorizontalHold();
    stopSoftDropHold();
    colors = readThemeColors();
    nextType = nextFromBag();
    piece = spawnPiece();
    drawPreview(holdCanvas, heldType);
    draw();
    onScoreChange && onScoreChange(score);
    running = true;
  }
  function stop() {
    running = false;
    if (timer) clearInterval(timer);
    timer = null;
    clearLockTimer();
    stopHorizontalHold();
    stopSoftDropHold();
  }

  return { start, stop, handleKey, handleKeyUp, get running() { return running; } };
}
