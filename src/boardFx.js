// Tabuleiro -- efeitos temporários que TODO MUNDO vê na hora: ping (📍) e desenhos (livre / seta / círculo) que somem
// sozinhos depois de alguns segundos. É Broadcast efêmero (nada vai pro banco), no mesmo canal do tabuleiro.
//
// Como usar na tela: um clique com a ferramenta 📍 faz o ping; Alt+clique faz o ping sem trocar de ferramenta; com ✏ ➚ ◯
// arrasta-se pra desenhar. Coordenadas em % do palco (igual tokens), então valem em qualquer zoom/tela. O tamanho dos
// traços/ping é constante NA TELA (compensa o zoom do palco com --inv-zoom).
const PING_MS = 3200;
const DRAW_HOLD_MS = 4500; // quanto o desenho fica 100% visível
const DRAW_FADE_MS = 1500; // e depois some devagar
const SWATCHES = ['#ff5a5a', '#ffcf7a', '#4ade80', '#5ad4ff', '#b98bff', '#ffffff'];
const TOOLS = [
  { key: 'ping', icon: '📍', label: 'Ping — clique para chamar a atenção de todos (Alt+clique também)' },
  { key: 'free', icon: '✏️', label: 'Desenho livre (some sozinho)' },
  { key: 'arrow', icon: '➚', label: 'Seta (arraste)' },
  { key: 'circle', icon: '◯', label: 'Círculo (arraste do centro pra fora)' },
];
const HEX = /^#[0-9a-fA-F]{6}$/;
const clampPct = (v) => Math.max(0, Math.min(100, Number.isFinite(+v) ? +v : 0));
const round2 = (v) => Math.round(v * 100) / 100;

const easeOutBack = (x) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

// host: { userId, name(), defaultColor(), send(payload), onToolChange?(tool) }
export function createBoardFx(host) {
  let stage = null;
  let canvas = null;
  let ctx = null;
  let capture = null;
  let bar = null;
  let tool = null;
  let color = null;
  let raf = null;
  let draft = null; // desenho em andamento (só local, até soltar)
  let draftPointer = null;
  const effects = []; // { fx, t0, ... } recebidos + os meus
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const myColor = () => color || host.defaultColor() || '#5ad4ff';
  const invZoom = () => (stage && parseFloat(stage.style.getPropertyValue('--inv-zoom'))) || 1;

  // ---- entrada de dados (de fora: validada, o canal aceita qualquer coisa) ----
  function sanitize(p) {
    if (!p || typeof p !== 'object') return null;
    const base = { fx: p.fx, uid: String(p.uid || '').slice(0, 64), color: HEX.test(p.color) ? p.color : '#5ad4ff', name: String(p.name || '').slice(0, 24) };
    if (p.fx === 'ping') return { ...base, x: clampPct(p.x), y: clampPct(p.y) };
    if (p.fx === 'free') {
      if (!Array.isArray(p.pts)) return null;
      const pts = p.pts.slice(0, 160).map((q) => [clampPct(q && q[0]), clampPct(q && q[1])]);
      return pts.length >= 2 ? { ...base, pts } : null;
    }
    if (p.fx === 'arrow') return { ...base, x1: clampPct(p.x1), y1: clampPct(p.y1), x2: clampPct(p.x2), y2: clampPct(p.y2) };
    if (p.fx === 'circle') return { ...base, x: clampPct(p.x), y: clampPct(p.y), r: Math.max(0.3, clampPct(p.r)) };
    return null;
  }
  function add(e) {
    effects.push({ ...e, t0: performance.now() });
    // some uma pilha: nunca guarda mais de 60 efeitos vivos
    while (effects.length > 60) effects.shift();
    schedule();
  }
  function receive(payload) {
    const e = sanitize(payload);
    if (e) add(e);
  }

  // ---- geometria ----
  function pctAt(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: clampPct(((clientX - r.left) / r.width) * 100), y: clampPct(((clientY - r.top) / r.height) * 100) };
  }

  // ---- canvas ----
  function size() {
    if (!stage || !canvas) return false;
    const cssW = parseFloat(stage.style.width) || stage.clientWidth;
    const cssH = parseFloat(stage.style.height) || stage.clientHeight;
    if (!cssW || !cssH) return false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const scale = Math.min(dpr, 2200 / cssW);
    const w = Math.round(cssW * scale);
    const h = Math.round(cssH * scale);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    canvas._s = scale; // px do canvas por px css
    canvas._cssW = cssW;
    canvas._cssH = cssH;
    return true;
  }

  function lifeAlpha(age, hold, fade) {
    if (age <= hold) return 1;
    return Math.max(0, 1 - (age - hold) / fade);
  }

  function drawPing(e, age, k) {
    const px = (e.x / 100) * canvas._cssW;
    const py = (e.y / 100) * canvas._cssH;
    const fade = lifeAlpha(age, PING_MS - 700, 700);
    ctx.save();
    ctx.translate(px, py);
    // 3 ondas
    for (let i = 0; i < 3; i++) {
      const a = age - i * 330;
      if (a < 0) continue;
      const f = Math.min(1, (a % 1400) / 1400);
      if (age > 330 * i + 2800) continue;
      const R = (14 + 46 * f) * k;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.strokeStyle = e.color;
      ctx.globalAlpha = (1 - f) * 0.85 * fade;
      ctx.lineWidth = 3 * k;
      ctx.stroke();
    }
    // marcador: gota com ponto, "pula" ao aparecer
    const pop = reduceMotion() ? 1 : Math.max(0, easeOutBack(Math.min(1, age / 380)));
    const bob = reduceMotion() ? 0 : Math.sin(age / 260) * 2.2 * k;
    ctx.globalAlpha = fade;
    ctx.translate(0, -16 * k * pop + bob);
    ctx.scale(pop, pop);
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 14 * k;
    ctx.beginPath();
    ctx.moveTo(0, 16 * k);
    ctx.bezierCurveTo(-13 * k, 2 * k, -11 * k, -13 * k, 0, -13 * k);
    ctx.bezierCurveTo(11 * k, -13 * k, 13 * k, 2 * k, 0, 16 * k);
    ctx.closePath();
    ctx.fillStyle = e.color;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2 * k;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -3 * k, 4.2 * k, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fill();
    // nome de quem chamou
    if (e.name) {
      ctx.font = `600 ${12 * k}px "JetBrains Mono", monospace`;
      const tw = ctx.measureText(e.name).width;
      const bw = tw + 14 * k;
      const bh = 19 * k;
      const bx = -bw / 2;
      const by = -13 * k - bh - 6 * k;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, bh / 2);
      else ctx.rect(bx, by, bw, bh);
      ctx.fillStyle = 'rgba(8,12,16,0.82)';
      ctx.fill();
      ctx.lineWidth = 1.3 * k;
      ctx.strokeStyle = e.color;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(e.name, 0, by + bh / 2 + 0.5 * k);
    }
    ctx.restore();
  }

  function strokeStyle(e, alpha, k, width) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = e.color;
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 12 * k;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width * k;
  }

  function drawFree(e, alpha, k) {
    const pts = e.pts.map((q) => [(q[0] / 100) * canvas._cssW, (q[1] / 100) * canvas._cssH]);
    if (pts.length < 2) return;
    ctx.save();
    strokeStyle(e, alpha, k, 4.2);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = alpha * 0.55;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.4 * k;
    ctx.stroke();
    ctx.restore();
  }

  function drawArrow(e, alpha, k) {
    const x1 = (e.x1 / 100) * canvas._cssW;
    const y1 = (e.y1 / 100) * canvas._cssH;
    const x2 = (e.x2 / 100) * canvas._cssW;
    const y2 = (e.y2 / 100) * canvas._cssH;
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 3) return;
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const head = Math.min(len * 0.6, 18 * k);
    ctx.save();
    strokeStyle(e, alpha, k, 4.4);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2 - Math.cos(ang) * head * 0.7, y2 - Math.sin(ang) * head * 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - Math.cos(ang - 0.42) * head, y2 - Math.sin(ang - 0.42) * head);
    ctx.lineTo(x2 - Math.cos(ang + 0.42) * head, y2 - Math.sin(ang + 0.42) * head);
    ctx.closePath();
    ctx.fillStyle = e.color;
    ctx.fill();
    ctx.restore();
  }

  function drawCircle(e, alpha, k) {
    const cx = (e.x / 100) * canvas._cssW;
    const cy = (e.y / 100) * canvas._cssH;
    const r = (e.r / 100) * canvas._cssW;
    ctx.save();
    ctx.globalAlpha = alpha * 0.14;
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    strokeStyle(e, alpha, k, 3.8);
    ctx.setLineDash([10 * k, 7 * k]);
    ctx.stroke();
    ctx.restore();
  }

  function paintOne(e, now, k) {
    const age = now - e.t0;
    if (e.fx === 'ping') {
      if (age < PING_MS) drawPing(e, age, k);
      return age < PING_MS;
    }
    const a = lifeAlpha(age, DRAW_HOLD_MS, DRAW_FADE_MS);
    if (a <= 0) return false;
    if (e.fx === 'free') drawFree(e, a, k);
    else if (e.fx === 'arrow') drawArrow(e, a, k);
    else if (e.fx === 'circle') drawCircle(e, a, k);
    return true;
  }

  function frame(now) {
    raf = null;
    if (!canvas || !canvas.isConnected || !size()) return;
    ctx.setTransform(canvas._s, 0, 0, canvas._s, 0, 0);
    ctx.clearRect(0, 0, canvas._cssW, canvas._cssH);
    const k = invZoom();
    for (let i = effects.length - 1; i >= 0; i--) {
      if (!paintOne(effects[i], now, k)) effects.splice(i, 1);
    }
    if (draft) paintOne({ ...draft, t0: now }, now, k); // rascunho: sempre 100%
    if (effects.length || draft) raf = requestAnimationFrame(frame);
  }
  function schedule() {
    if (raf === null && canvas) raf = requestAnimationFrame(frame);
  }

  // ---- ações locais (desenham aqui E mandam pros outros) ----
  function emit(e) {
    const payload = { ...e, uid: host.userId, color: e.color || myColor(), name: host.name() };
    add({ ...payload });
    host.send(payload);
  }
  function pingAtClient(clientX, clientY) {
    if (!stage) return;
    const p = pctAt(clientX, clientY);
    if (p) emit({ fx: 'ping', x: round2(p.x), y: round2(p.y) });
  }

  function simplify(pts) {
    // no máximo ~120 pontos: pega de N em N
    if (pts.length <= 120) return pts;
    const step = Math.ceil(pts.length / 120);
    const out = pts.filter((_, i) => i % step === 0);
    if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
    return out;
  }

  function onDown(e) {
    if (!tool || !stage) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return; // botão do meio continua arrastando o mapa
    if (draftPointer !== null) {
      // segundo dedo: era uma pinça, descarta o rascunho
      draft = null;
      draftPointer = null;
      schedule();
      return;
    }
    const p = pctAt(e.clientX, e.clientY);
    if (!p) return;
    if (tool === 'ping') {
      emit({ fx: 'ping', x: round2(p.x), y: round2(p.y) });
      return;
    }
    e.preventDefault();
    try {
      capture.setPointerCapture(e.pointerId);
    } catch (_) { /* ponteiro já liberado */ }
    draftPointer = e.pointerId;
    const c = myColor();
    if (tool === 'free') draft = { fx: 'free', color: c, pts: [[p.x, p.y], [p.x, p.y]] };
    else if (tool === 'arrow') draft = { fx: 'arrow', color: c, x1: p.x, y1: p.y, x2: p.x, y2: p.y, _o: p };
    else if (tool === 'circle') draft = { fx: 'circle', color: c, x: p.x, y: p.y, r: 0.3, _o: p };
    schedule();
  }
  function onMove(e) {
    if (!draft || e.pointerId !== draftPointer) return;
    const p = pctAt(e.clientX, e.clientY);
    if (!p) return;
    if (draft.fx === 'free') {
      const last = draft.pts[draft.pts.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) > 0.25) draft.pts.push([p.x, p.y]);
    } else if (draft.fx === 'arrow') {
      draft.x2 = p.x;
      draft.y2 = p.y;
    } else if (draft.fx === 'circle') {
      const r = canvas && canvas._cssW ? canvas._cssW : 1;
      const dx = ((p.x - draft._o.x) / 100) * r;
      const dy = ((p.y - draft._o.y) / 100) * (canvas._cssH || r);
      draft.r = Math.max(0.3, (Math.hypot(dx, dy) / r) * 100);
    }
    schedule();
  }
  function onUp(e) {
    if (!draft || e.pointerId !== draftPointer) return;
    const d = draft;
    draft = null;
    draftPointer = null;
    if (d.fx === 'free') {
      if (d.pts.length >= 2) emit({ fx: 'free', color: d.color, pts: simplify(d.pts).map((q) => [round2(q[0]), round2(q[1])]) });
    } else if (d.fx === 'arrow') {
      if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 0.8) emit({ fx: 'arrow', color: d.color, x1: round2(d.x1), y1: round2(d.y1), x2: round2(d.x2), y2: round2(d.y2) });
    } else if (d.fx === 'circle') {
      if (d.r > 0.6) emit({ fx: 'circle', color: d.color, x: round2(d.x), y: round2(d.y), r: round2(d.r) });
    }
    schedule();
  }

  // ---- barra de ferramentas ----
  function barHtml() {
    const active = (k) => (tool === k ? 'on' : '');
    return `
      <div class="board-fx-tools">
        ${TOOLS.map((t) => `<button type="button" class="board-fx-btn ${active(t.key)}" data-fx-tool="${t.key}" title="${t.label}">${t.icon}</button>`).join('')}
      </div>
      <div class="board-fx-colors ${tool && tool !== 'ping' ? 'show' : ''}">
        ${SWATCHES.map((c) => `<button type="button" class="board-fx-sw ${myColor().toLowerCase() === c ? 'on' : ''}" data-fx-color="${c}" style="--c:${c}" title="cor"></button>`).join('')}
      </div>`;
  }
  function renderBar() {
    if (!bar) return;
    bar.innerHTML = barHtml();
    bar.querySelectorAll('[data-fx-tool]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', () => setTool(tool === b.dataset.fxTool ? null : b.dataset.fxTool));
    });
    bar.querySelectorAll('[data-fx-color]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', () => {
        color = b.dataset.fxColor;
        renderBar();
      });
    });
  }

  function setTool(next, { silent = false } = {}) {
    tool = next || null;
    draft = null;
    draftPointer = null;
    if (capture) {
      capture.style.display = tool ? 'block' : 'none';
      capture.dataset.tool = tool || '';
    }
    renderBar();
    if (!silent && host.onToolChange) host.onToolChange(tool);
    schedule();
  }

  // chamado a cada render do tabuleiro (o palco é recriado do zero)
  function mount({ stageEl, barEl }) {
    draft = null; // o palco foi recriado: um traço em andamento perdeu o ponteiro
    draftPointer = null;
    stage = stageEl;
    bar = barEl;
    canvas = stage ? stage.querySelector('canvas.board-fx-canvas') : null;
    capture = stage ? stage.querySelector('.board-fx-capture') : null;
    ctx = canvas ? canvas.getContext('2d') : null;
    if (capture) {
      capture.addEventListener('pointerdown', onDown);
      capture.addEventListener('pointermove', onMove);
      capture.addEventListener('pointerup', onUp);
      capture.addEventListener('pointercancel', onUp);
      capture.style.display = tool ? 'block' : 'none';
      capture.dataset.tool = tool || '';
    }
    renderBar();
    schedule();
  }

  return {
    mount,
    receive,
    setTool,
    getTool: () => tool,
    pingAtClient,
    clearAll() {
      effects.length = 0;
      draft = null;
      draftPointer = null;
      schedule();
    },
    resize() {
      schedule();
    },
    stop() {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      effects.length = 0;
      draft = null;
      draftPointer = null;
      stage = canvas = capture = bar = ctx = null;
    },
  };
}

// HTML estático das camadas (o board.js coloca dentro do palco / da área)
export const FX_STAGE_HTML = '<canvas class="board-fx-canvas"></canvas><div class="board-fx-capture" style="display:none;"></div>';
export const FX_BAR_HTML = '<div class="board-fx-bar" id="board-fx-bar"></div>';
