// Tabuleiro -- seleção de pin (token): clique no pin e aparece, em volta dele, uma moldura com
//   * 4 alças nos cantos pra REDIMENSIONAR (arrasta pra fora/pra dentro; o pin cresce a partir do centro);
//   * uma alça redonda no alto, numa haste, pra GIRAR (Shift = de 15 em 15°; perto de 0/90/180/270 ela "gruda");
//   * uma barrinha embaixo: ⟲ ⟳ (45°), ⌖ (tirar a rotação), − + (tamanho) e a leitura do ângulo/tamanho.
// Teclado com o pin selecionado: [ ] giram 15° · + − mudam o tamanho · Esc solta.
// Tudo vive numa camada própria do palco (o token tem overflow:hidden e cortaria alças que saem dele) e as alças
// mantêm o mesmo tamanho na tela em qualquer zoom (--inv-zoom). Quem sabe de dados/permissão é o board.js.
const MIN_SIZE = 2;
const MAX_SIZE = 40;
const SNAP_DEG = 15;
const norm = (d) => ((d % 360) + 360) % 360;

// host: {
//   stage(), tokens(), canEdit(token),
//   live(token, { size?, rotation? })     -- aplica na hora (DOM, luz, broadcast)
//   commit(token, { size?, rotation? })   -- grava no banco
// }
export function createTokenSelection(host) {
  let layer = null;
  let selectedId = null;
  let drag = null; // { kind: 'resize'|'rotate', pointerId, token, startSize, startRot }

  const find = (id) => host.tokens().find((t) => t.id === id) || null;

  function html(t) {
    const rot = t.rotation == null ? 0 : t.rotation;
    return `
      <div class="board-sel" style="left:${t.x}%; top:${t.y}%; width:${t.size}%;">
        <div class="board-sel-box" style="transform: rotate(${rot}deg);">
          <span class="board-sel-stem"></span>
          <button type="button" class="board-sel-rot" data-sel="rotate" title="girar (Shift = de 15 em 15°)">⟳</button>
          <button type="button" class="board-sel-h nw" data-sel="resize" data-corner="nw" title="redimensionar"></button>
          <button type="button" class="board-sel-h ne" data-sel="resize" data-corner="ne" title="redimensionar"></button>
          <button type="button" class="board-sel-h sw" data-sel="resize" data-corner="sw" title="redimensionar"></button>
          <button type="button" class="board-sel-h se" data-sel="resize" data-corner="se" title="redimensionar"></button>
        </div>
        <div class="board-sel-bar">
          <button type="button" data-sel-act="ccw" title="girar 45° pra esquerda ( [ = 15° )">⟲</button>
          <button type="button" data-sel-act="cw" title="girar 45° pra direita ( ] = 15° )">⟳</button>
          <button type="button" data-sel-act="reset" title="tirar a rotação">⌖</button>
          <span class="board-sel-sep"></span>
          <button type="button" data-sel-act="smaller" title="menor ( − )">−</button>
          <button type="button" data-sel-act="bigger" title="maior ( + )">+</button>
          <output class="board-sel-read">${t.rotation == null ? '—' : Math.round(rot) + '°'} · ${Math.round(t.size * 10) / 10}%</output>
        </div>
      </div>`;
  }

  function ensureLayer() {
    const stage = host.stage();
    if (!stage) return null;
    if (!layer || !layer.isConnected || layer.parentElement !== stage) {
      layer = stage.querySelector('.board-sel-layer');
      if (!layer) {
        layer = document.createElement('div');
        layer.className = 'board-sel-layer';
        stage.appendChild(layer);
      }
    }
    return layer;
  }

  function render() {
    const l = ensureLayer();
    if (!l) return;
    const t = selectedId ? find(selectedId) : null;
    if (!t || !host.canEdit(t)) {
      selectedId = null;
      l.innerHTML = '';
      return;
    }
    l.innerHTML = html(t);
    wire(l);
  }

  // durante o arrasto só reposiciona/rotaciona o que já existe (refazer o HTML mataria o gesto)
  function refresh() {
    const t = selectedId ? find(selectedId) : null;
    if (!layer || !t) return render();
    const box = layer.querySelector('.board-sel');
    if (!box) return render();
    box.style.left = t.x + '%';
    box.style.top = t.y + '%';
    box.style.width = t.size + '%';
    const inner = layer.querySelector('.board-sel-box');
    if (inner) inner.style.transform = `rotate(${t.rotation == null ? 0 : t.rotation}deg)`;
    const out = layer.querySelector('.board-sel-read');
    if (out) out.textContent = `${t.rotation == null ? '—' : Math.round(t.rotation) + '°'} · ${Math.round(t.size * 10) / 10}%`;
  }

  function centerPx(t) {
    const stage = host.stage();
    const r = stage.getBoundingClientRect();
    return { cx: r.left + (r.width * t.x) / 100, cy: r.top + (r.height * t.y) / 100, w: r.width };
  }

  function onHandleDown(e, kind) {
    const t = find(selectedId);
    if (!t || !host.canEdit(t)) return;
    e.preventDefault();
    e.stopPropagation(); // não deixa virar pan do mapa nem arrasto de token
    drag = { kind, pointerId: e.pointerId, token: t, startSize: t.size, startRot: t.rotation };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) { /* ponteiro já liberado */ }
    layer.classList.add('dragging');
  }
  function onHandleMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const t = drag.token;
    const { cx, cy, w } = centerPx(t);
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    if (drag.kind === 'rotate') {
      let deg = norm((Math.atan2(dy, dx) * 180) / Math.PI + 90); // 0 = ponteiro direto acima
      if (e.shiftKey) deg = norm(Math.round(deg / SNAP_DEG) * SNAP_DEG);
      else {
        for (const m of [0, 90, 180, 270, 360]) if (Math.abs(deg - m) < 4) deg = m % 360; // ímã nos eixos
      }
      host.live(t, { rotation: Math.round(deg * 10) / 10 });
    } else {
      // mede no referencial do pin (desfaz a rotação) -- a alça segue o mouse mesmo com o pin girado
      const a = (-(t.rotation == null ? 0 : t.rotation) * Math.PI) / 180;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      const half = Math.max(Math.abs(lx), Math.abs(ly));
      const size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, ((half * 2) / w) * 100));
      host.live(t, { size: Math.round(size * 10) / 10 });
    }
    refresh();
  }
  async function onHandleUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    if (layer) layer.classList.remove('dragging');
    const t = d.token;
    const fields = {};
    if (d.kind === 'rotate' && t.rotation !== d.startRot) fields.rotation = t.rotation;
    if (d.kind === 'resize' && t.size !== d.startSize) fields.size = t.size;
    if (Object.keys(fields).length) await host.commit(t, fields);
  }

  async function nudge(t, fields) {
    host.live(t, fields);
    refresh();
    await host.commit(t, fields);
  }
  function act(kind) {
    const t = find(selectedId);
    if (!t || !host.canEdit(t)) return;
    const rot = t.rotation == null ? 0 : t.rotation;
    if (kind === 'cw') return nudge(t, { rotation: norm(Math.round(rot / 45) * 45 + 45) });
    if (kind === 'ccw') return nudge(t, { rotation: norm(Math.round(rot / 45) * 45 - 45) });
    if (kind === 'reset') return nudge(t, { rotation: null });
    if (kind === 'bigger') return nudge(t, { size: Math.min(MAX_SIZE, Math.round((t.size + (t.size < 8 ? 0.5 : 1)) * 10) / 10) });
    if (kind === 'smaller') return nudge(t, { size: Math.max(MIN_SIZE, Math.round((t.size - (t.size <= 8 ? 0.5 : 1)) * 10) / 10) });
  }

  function wire(l) {
    l.querySelectorAll('[data-sel]').forEach((h) => {
      h.addEventListener('pointerdown', (e) => onHandleDown(e, h.dataset.sel));
      h.addEventListener('pointermove', onHandleMove);
      h.addEventListener('pointerup', onHandleUp);
      h.addEventListener('pointercancel', onHandleUp);
    });
    l.querySelectorAll('[data-sel-act]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', () => act(b.dataset.selAct));
    });
  }

  return {
    // chamado a cada render do tabuleiro (o palco é recriado)
    mount() {
      layer = null;
      render();
    },
    select(id) {
      if (selectedId === id) return;
      selectedId = id;
      render();
    },
    deselect() {
      if (!selectedId) return;
      selectedId = null;
      drag = null;
      render();
    },
    selectedId: () => selectedId,
    dragging: () => !!drag,
    refresh,
    // teclado; devolve true se tratou a tecla
    onKey(e) {
      if (!selectedId) return false;
      const t = find(selectedId);
      if (!t || !host.canEdit(t)) return false;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
      const rot = t.rotation == null ? 0 : t.rotation;
      if (e.key === 'Escape') {
        this.deselect();
        return true;
      }
      if (e.key === '[' || e.key === ']') {
        nudge(t, { rotation: norm(rot + (e.key === ']' ? SNAP_DEG : -SNAP_DEG)) });
        return true;
      }
      if (e.key === '+' || e.key === '=') {
        act('bigger');
        return true;
      }
      if (e.key === '-' || e.key === '_') {
        act('smaller');
        return true;
      }
      return false;
    },
  };
}
