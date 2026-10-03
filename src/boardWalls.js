// Tabuleiro -- paredes: desenho da camada (SVG em % do palco) e editor do
// mestre (linha/poligonal, retângulo, apagar, editar vértice, portas).
//
// O editor NÃO conhece banco nem DOM da tela: quem usa (board.js) passa um
// `host` com os dados vivos e as ações de gravar. Isso deixa o editor
// testável com um host falso.
//
// Coordenadas: tudo em % do palco (0-100 nos dois eixos), igual aos tokens.
// Como o palco não é quadrado, ângulos e distâncias "de verdade" (Shift =
// 45°) são calculados no espaço do mundo (altura 1, largura = aspect).
import { snapPoint, distPointSeg } from './boardGeometry.js';
import { WALL_KIND_DEFAULTS } from './board.js';

export const WALL_KIND_LABELS = { parede: 'Parede', janela: 'Janela', porta: 'Porta', invisivel: 'Invisível' };
const MIN_LEN_PCT = 0.25; // segmento menor que isso é clique perdido
const SNAP_PX = 12; // raio do ímã das pontas, em pixels de tela
const HIT_PX = 9; // tolerância pra clicar numa parede/vértice, em pixels de tela

// ------------------------------------------------------------------
// camada estática: o que aparece no tabuleiro
// ------------------------------------------------------------------

const fmt = (n) => (Math.round(n * 1000) / 1000).toString();

// opts: { selectedId, editing (mostra vértices), doorButtons (mestre pode abrir/fechar) }
export function wallsLayerHtml(walls, { selectedId = null, editing = false, doorButtons = false } = {}) {
  const lines = walls
    .map((w) => {
      const cls = ['bw', 'bw-' + w.kind];
      if (w.kind === 'porta' && w.door_open) cls.push('open');
      if (w.id === selectedId) cls.push('sel');
      if (!w.blocks_move && !w.blocks_light) cls.push('inert');
      return `<line class="${cls.join(' ')}" x1="${fmt(w.x1)}" y1="${fmt(w.y1)}" x2="${fmt(w.x2)}" y2="${fmt(w.y2)}"/>`;
    })
    .join('');
  let html = `<svg class="board-walls-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>`;
  if (doorButtons) {
    html += walls
      .filter((w) => w.kind === 'porta')
      .map((w) => {
        const mx = (w.x1 + w.x2) / 2;
        const my = (w.y1 + w.y2) / 2;
        return `<button type="button" class="board-door-btn ${w.door_open ? 'open' : ''}" data-door-toggle="${w.id}"
          style="left:${fmt(mx)}%; top:${fmt(my)}%;" title="${w.door_open ? 'fechar porta' : 'abrir porta'}">${w.door_open ? '🔓' : '🔒'}</button>`;
      })
      .join('');
  }
  if (editing) {
    const seen = new Set();
    walls.forEach((w) => {
      [[w.x1, w.y1], [w.x2, w.y2]].forEach(([x, y]) => {
        const key = fmt(x) + ',' + fmt(y);
        if (seen.has(key)) return;
        seen.add(key);
        html += `<i class="board-wall-handle" style="left:${fmt(x)}%; top:${fmt(y)}%;"></i>`;
      });
    });
  }
  return html;
}

// ------------------------------------------------------------------
// editor
// ------------------------------------------------------------------
// host: {
//   stage(): elemento do palco (tem o transform de zoom/pan)
//   aspect(): largura/altura do palco
//   walls(): array vivo de paredes { id, x1,y1,x2,y2, kind, blocks_move, blocks_light, door_open }
//   tool(): { mode: 'line'|'rect'|'erase'|'edit', kind } | null
//   grid(): passo da grade em % (0 = sem)
//   add(rows): Promise<rows com id>       -- grava e já põe em walls()
//   remove(ids): Promise
//   update(updates): Promise              -- updates: [{ id, fields }], já aplica em walls()
//   select(id|null)
//   selected(): id|null
//   redraw(): redesenha a camada estática
//   changed(): avisa o painel (undo/redo habilitado etc)
// }
export function createWallEditor(host) {
  let el = null; // elemento que captura o ponteiro (cobre o palco inteiro)
  let previewSvg = null;
  let snapDot = null;
  let chain = null; // poligonal em andamento: { last: {x,y} }
  let lastClick = { t: 0, x: 0, y: 0 };
  let gesture = null; // arrasto em andamento (rect | erase | edit)
  let hover = null; // último ponto (já encaixado) sob o cursor
  const undoStack = [];
  const redoStack = [];

  const clamp = (v) => Math.max(0, Math.min(100, v));

  // ---- conversões ----
  function rect() {
    return host.stage().getBoundingClientRect();
  }
  function toPct(e) {
    const r = rect();
    return { x: clamp(((e.clientX - r.left) / r.width) * 100), y: clamp(((e.clientY - r.top) / r.height) * 100) };
  }
  function toPx(p) {
    const r = rect();
    return { x: r.left + (p.x / 100) * r.width, y: r.top + (p.y / 100) * r.height };
  }

  // ponto da tela -> % do palco, com encaixe (pontas vizinhas > grade) e Shift = ângulo de 45°
  function snapped(e, from = null, exclude = null) {
    let p = toPct(e);
    if (e.altKey) return { ...p, snapped: null };
    const r = rect();
    if (e.shiftKey && from) {
      const asp = host.aspect();
      const dx = ((p.x - from.x) / 100) * asp;
      const dy = (p.y - from.y) / 100;
      const len = Math.hypot(dx, dy);
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      p = { x: clamp(from.x + ((Math.cos(ang) * len) / asp) * 100), y: clamp(from.y + Math.sin(ang) * len * 100) };
    }
    const list = exclude ? host.walls().filter((w) => !exclude.has(w.id)) : host.walls();
    const thr = (SNAP_PX / r.width) * 100;
    const s = snapPoint(p, list, thr, host.grid(), []);
    return { x: clamp(s.x), y: clamp(s.y), snapped: s.snapped };
  }

  // ---- hit tests em pixels de tela ----
  function nearestWall(e, maxPx = HIT_PX) {
    let best = null;
    let bestD = maxPx;
    for (const w of host.walls()) {
      const a = toPx({ x: w.x1, y: w.y1 });
      const b = toPx({ x: w.x2, y: w.y2 });
      const d = distPointSeg(e.clientX, e.clientY, a.x, a.y, b.x, b.y).d;
      if (d <= bestD) {
        bestD = d;
        best = w;
      }
    }
    return best;
  }
  function nearestVertex(e, maxPx = HIT_PX + 2) {
    let best = null;
    let bestD = maxPx;
    for (const w of host.walls()) {
      [[w.x1, w.y1], [w.x2, w.y2]].forEach(([x, y]) => {
        const p = toPx({ x, y });
        const d = Math.hypot(p.x - e.clientX, p.y - e.clientY);
        if (d <= bestD) {
          bestD = d;
          best = { x, y };
        }
      });
    }
    return best;
  }

  // ---- pré-visualização (SVG em % por cima do palco, só traços) ----
  function ensurePreview() {
    if (!el) return;
    if (!previewSvg || !previewSvg.isConnected) {
      el.innerHTML = '';
      previewSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      previewSvg.setAttribute('class', 'board-walls-preview');
      previewSvg.setAttribute('viewBox', '0 0 100 100');
      previewSvg.setAttribute('preserveAspectRatio', 'none');
      el.appendChild(previewSvg);
      snapDot = document.createElement('i');
      snapDot.className = 'board-wall-snapdot';
      snapDot.style.display = 'none';
      el.appendChild(snapDot);
    }
  }
  function drawPreview(lines = [], tone = 'draw') {
    ensurePreview();
    if (!previewSvg) return;
    previewSvg.innerHTML = lines
      .map((l) => `<line class="bp bp-${tone}" x1="${fmt(l.x1)}" y1="${fmt(l.y1)}" x2="${fmt(l.x2)}" y2="${fmt(l.y2)}"/>`)
      .join('');
  }
  function showSnapDot(p) {
    ensurePreview();
    if (!snapDot) return;
    if (!p) {
      snapDot.style.display = 'none';
      return;
    }
    snapDot.style.display = '';
    snapDot.style.left = fmt(p.x) + '%';
    snapDot.style.top = fmt(p.y) + '%';
    snapDot.classList.toggle('on-point', p.snapped === 'ponta');
  }

  // ---- histórico (por sessão da tela, não vai pro banco) ----
  function pushHistory(entry) {
    undoStack.push(entry);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    host.changed();
  }
  async function undo() {
    const e = undoStack.pop();
    if (!e) return;
    await e.undo();
    redoStack.push(e);
    host.select(null);
    host.redraw();
    host.changed();
  }
  async function redo() {
    const e = redoStack.pop();
    if (!e) return;
    await e.redo();
    undoStack.push(e);
    host.select(null);
    host.redraw();
    host.changed();
  }

  // grava paredes novas e registra no histórico (undo apaga; redo recria -- ids novos)
  async function addWalls(rows) {
    if (!rows.length) return;
    let created = await host.add(rows);
    const strip = (r) => ({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, kind: r.kind, blocks_move: r.blocks_move, blocks_light: r.blocks_light, door_open: r.door_open });
    pushHistory({
      undo: () => host.remove(created.map((c) => c.id)),
      redo: async () => {
        created = await host.add(created.map(strip));
      },
    });
  }
  async function removeWalls(ids) {
    if (!ids.length) return;
    const snapshot = host.walls().filter((w) => ids.includes(w.id));
    const strip = (r) => ({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, kind: r.kind, blocks_move: r.blocks_move, blocks_light: r.blocks_light, door_open: r.door_open });
    await host.remove(ids);
    let current = ids;
    pushHistory({
      undo: async () => {
        const back = await host.add(snapshot.map(strip));
        current = back.map((b) => b.id);
      },
      redo: () => host.remove(current),
    });
  }
  // fields antes/depois por parede
  async function updateWalls(changes) {
    // changes: [{ id, before, after }]
    if (!changes.length) return;
    await host.update(changes.map((c) => ({ id: c.id, fields: c.after })));
    pushHistory({
      undo: () => host.update(changes.map((c) => ({ id: c.id, fields: c.before }))),
      redo: () => host.update(changes.map((c) => ({ id: c.id, fields: c.after }))),
    });
  }

  // ---- ferramentas ----
  function rectLines(a, b) {
    return [
      { x1: a.x, y1: a.y, x2: b.x, y2: a.y },
      { x1: b.x, y1: a.y, x2: b.x, y2: b.y },
      { x1: b.x, y1: b.y, x2: a.x, y2: b.y },
      { x1: a.x, y1: b.y, x2: a.x, y2: a.y },
    ];
  }

  function finishChain() {
    chain = null;
    drawPreview([]);
    showSnapDot(hover);
  }

  function onPointerDown(e) {
    const tool = host.tool();
    if (!tool) return;
    if (e.button === 2) {
      // botão direito termina a poligonal
      e.preventDefault();
      if (chain) finishChain();
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch (_) {
      // sem captura, segue
    }

    if (tool.mode === 'line') {
      const p = snapped(e, chain ? chain.last : null);
      const now = Date.now();
      const isDouble = now - lastClick.t < 320 && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 6;
      lastClick = { t: now, x: e.clientX, y: e.clientY };
      if (!chain) {
        chain = { last: p };
        return;
      }
      if (isDouble) {
        finishChain();
        return;
      }
      if (Math.hypot(p.x - chain.last.x, p.y - chain.last.y) < MIN_LEN_PCT) return;
      const seg = { x1: chain.last.x, y1: chain.last.y, x2: p.x, y2: p.y, kind: tool.kind };
      chain.last = p;
      addWalls([seg]).catch(() => {});
      return;
    }

    if (tool.mode === 'rect') {
      const p = snapped(e);
      gesture = { type: 'rect', start: p, cur: p };
      drawPreview(rectLines(p, p));
      return;
    }

    if (tool.mode === 'erase') {
      gesture = { type: 'erase', ids: new Set() };
      collectErase(e);
      return;
    }

    if (tool.mode === 'edit') {
      const v = nearestVertex(e);
      if (v) {
        // arrasta TODAS as pontas que estão nesse vértice (cantos compartilhados andam juntos)
        const members = [];
        host.walls().forEach((w) => {
          if (Math.hypot(w.x1 - v.x, w.y1 - v.y) < 0.02) members.push({ id: w.id, end: 1, before: { x1: w.x1, y1: w.y1 } });
          if (Math.hypot(w.x2 - v.x, w.y2 - v.y) < 0.02) members.push({ id: w.id, end: 2, before: { x2: w.x2, y2: w.y2 } });
        });
        gesture = { type: 'vertex', members, ids: new Set(members.map((m) => m.id)), moved: false };
        return;
      }
      const w = nearestWall(e);
      host.select(w ? w.id : null);
      host.redraw();
      host.changed();
    }
  }

  function collectErase(e) {
    const w = nearestWall(e);
    if (w && !gesture.ids.has(w.id)) {
      gesture.ids.add(w.id);
      const lines = host.walls().filter((x) => gesture.ids.has(x.id));
      drawPreview(lines, 'erase');
    }
  }

  function onPointerMove(e) {
    const tool = host.tool();
    if (!tool) return;
    if (!gesture) {
      // sem arrasto: só mostra onde vai encaixar / a poligonal em andamento
      if (tool.mode === 'line' || tool.mode === 'rect') {
        hover = snapped(e, chain ? chain.last : null);
        showSnapDot(hover);
        if (chain) drawPreview([{ x1: chain.last.x, y1: chain.last.y, x2: hover.x, y2: hover.y }]);
      } else {
        showSnapDot(null);
      }
      return;
    }
    if (gesture.type === 'rect') {
      gesture.cur = snapped(e);
      drawPreview(rectLines(gesture.start, gesture.cur));
      showSnapDot(gesture.cur);
    } else if (gesture.type === 'erase') {
      collectErase(e);
    } else if (gesture.type === 'vertex') {
      const p = snapped(e, null, gesture.ids);
      gesture.moved = true;
      const map = new Map(host.walls().map((w) => [w.id, w]));
      gesture.members.forEach((m) => {
        const w = map.get(m.id);
        if (!w) return;
        if (m.end === 1) {
          w.x1 = p.x;
          w.y1 = p.y;
        } else {
          w.x2 = p.x;
          w.y2 = p.y;
        }
      });
      showSnapDot(p);
      host.redraw();
    }
  }

  async function onPointerUp(e) {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch (_) {
      // já liberado
    }
    drawPreview([]);
    showSnapDot(null);
    const tool = host.tool();
    try {
      if (g.type === 'rect') {
        const { start, cur } = g;
        if (Math.abs(cur.x - start.x) < MIN_LEN_PCT || Math.abs(cur.y - start.y) < MIN_LEN_PCT) return;
        await addWalls(rectLines(start, cur).map((l) => ({ ...l, kind: tool ? tool.kind : 'parede' })));
      } else if (g.type === 'erase') {
        await removeWalls(Array.from(g.ids));
      } else if (g.type === 'vertex') {
        if (!g.moved) return;
        const map = new Map(host.walls().map((w) => [w.id, w]));
        const changes = [];
        g.members.forEach((m) => {
          const w = map.get(m.id);
          if (!w) return;
          const after = m.end === 1 ? { x1: w.x1, y1: w.y1 } : { x2: w.x2, y2: w.y2 };
          changes.push({ id: m.id, before: m.before, after });
        });
        // junta as duas pontas da mesma parede num registro só
        const merged = new Map();
        changes.forEach((c) => {
          const cur = merged.get(c.id) || { id: c.id, before: {}, after: {} };
          Object.assign(cur.before, c.before);
          Object.assign(cur.after, c.after);
          merged.set(c.id, cur);
        });
        await updateWalls(Array.from(merged.values()));
      }
    } catch (_) {
      // erro de gravação já é mostrado por quem implementa o host
    }
  }

  function onKeyDown(e) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!host.tool()) return;
    if (e.key === 'Escape') {
      if (chain) finishChain();
      else host.select(null), host.redraw(), host.changed();
    } else if (e.key === 'Enter') {
      if (chain) finishChain();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && host.selected()) {
      e.preventDefault();
      removeWalls([host.selected()]).then(() => {
        host.select(null);
        host.redraw();
      });
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    }
  }

  function onContextMenu(e) {
    e.preventDefault();
    if (chain) finishChain();
  }

  return {
    // chamado a cada render da tela (o elemento é recriado)
    attach(captureEl) {
      detach();
      el = captureEl;
      previewSvg = null;
      snapDot = null;
      if (!el) return;
      ensurePreview();
      el.addEventListener('pointerdown', onPointerDown);
      el.addEventListener('pointermove', onPointerMove);
      el.addEventListener('pointerup', onPointerUp);
      el.addEventListener('pointercancel', onPointerUp);
      el.addEventListener('contextmenu', onContextMenu);
      document.addEventListener('keydown', onKeyDown);
      if (chain) drawPreview([]);
    },
    detach,
    // troca de ferramenta: abandona o que estava em andamento
    reset() {
      chain = null;
      gesture = null;
      hover = null;
      if (previewSvg) drawPreview([]);
      showSnapDot(null);
    },
    undo,
    redo,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    clearHistory() {
      undoStack.length = 0;
      redoStack.length = 0;
    },
    // operações em lote vindas do painel (histórico incluso)
    removeWalls,
    updateWalls,
    addWalls,
    defaults: (kind) => ({ ...WALL_KIND_DEFAULTS[kind] }),
  };

  function detach() {
    if (el) {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('contextmenu', onContextMenu);
    }
    document.removeEventListener('keydown', onKeyDown);
    el = null;
  }
}
