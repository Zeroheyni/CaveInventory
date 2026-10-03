// Tabuleiro -- iluminação dinâmica. Um <canvas> de ESCURIDÃO por cima do mapa
// (cada luz "apaga" um pedaço) e outro de BRILHO colorido (mix-blend-mode:
// screen). O pedaço de cada luz é o polígono de visibilidade dela contra as
// paredes que bloqueiam luz (boardGeometry.visibilityPolygon) -- por isso a
// luz nunca atravessa parede, e uma porta fechada fecha a luz.
//
// Quem vê o quê: o jogador só vê o iluminado (e os tokens fora da luz somem,
// exceto o dele); o mestre vê tudo com a escuridão bem leve e pode "ver como
// jogador". É efeito visual: a imagem do mapa continua acessível pela URL.
//
// Custo: o polígono de cada luz é cacheado e só recalcula quando a luz, o
// token que a carrega ou as paredes mudam; a animação (tremida, pulso, névoa)
// só mexe no gradiente e só roda enquanto houver algo animado (~30 fps).
import { blockingWalls, visibilityPolygon, pointInPolygon, toWorld } from './boardGeometry.js';

// raios em % da LARGURA do palco; ângulos em graus
export const LIGHT_PRESETS = {
  tocha: { label: 'Tocha', icon: '🔥', radius: 16, dim_radius: 30, color: '#ffb35a', angle: 360, flicker: 0.4, pulse: 0, intensity: 1 },
  lanterna: { label: 'Lanterna', icon: '🔦', radius: 28, dim_radius: 36, color: '#eaf4ff', angle: 70, flicker: 0.04, pulse: 0, intensity: 1 },
  magia: { label: 'Luz mágica', icon: '✨', radius: 18, dim_radius: 28, color: '#7aa8ff', angle: 360, flicker: 0, pulse: 0.35, intensity: 1 },
  visao: { label: 'Visão no escuro', icon: '👁️', radius: 12, dim_radius: 18, color: '#9aa0a6', angle: 360, flicker: 0, pulse: 0, intensity: 0.85 },
  vela: { label: 'Vela', icon: '🕯️', radius: 7, dim_radius: 14, color: '#ffcf7a', angle: 360, flicker: 0.7, pulse: 0, intensity: 0.95 },
  custom: { label: 'Personalizada', icon: '💡', radius: 18, dim_radius: 30, color: '#ffffff', angle: 360, flicker: 0.2, pulse: 0, intensity: 1 },
};
export const LIGHT_KINDS = Object.keys(LIGHT_PRESETS);

const MASTER_DARK_FACTOR = 0.4; // o mestre vê a escuridão a 40% do valor do jogador
const HALO_PCT = 4.5; // a lanterna também ilumina um halo curto em volta de quem carrega
const FRAME_MS = 33;
const MAX_BACKING_W = 1100;

const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// ruído suave em [-1, 1] -- soma de senos com fase própria de cada luz
function flickerNoise(t, phase) {
  return Math.sin(t * 7.1 + phase) * 0.5 + Math.sin(t * 13.7 + phase * 2.3) * 0.3 + Math.sin(t * 23.3 + phase * 3.7) * 0.2;
}
function phaseOf(id) {
  let h = 0;
  for (let i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) % 1000;
  return h / 100;
}

// host: {
//   board(), aspect(), walls() (cruas, em %), wallsVersion(), tokens(), lights(),
//   isMaster(), viewAsPlayer(), characterId()
// }
export function createLighting(host) {
  let layer = null;
  let dark = null;
  let glow = null;
  let gray = null;
  let dctx = null;
  let gctx = null;
  let grctx = null;
  let backW = 0;
  let backH = 0;
  let raf = null;
  let dirty = true;
  let lastFrame = 0;
  const polyCache = new Map();
  let lightWallsCache = { version: -1, aspect: 0, list: [] };
  const lastPos = new Map(); // tokenId -> { x, y } pra deduzir pra onde a lanterna aponta
  const facing = new Map(); // tokenId -> ângulo (rad)
  let fogPattern = null;
  let fogTile = null;

  function lightWalls(aspect) {
    const v = host.wallsVersion();
    if (lightWallsCache.version !== v || lightWallsCache.aspect !== aspect) {
      lightWallsCache = { version: v, aspect, list: blockingWalls(host.walls(), 'light', aspect) };
      polyCache.clear();
    }
    return lightWallsCache.list;
  }

  // ---- onde está cada luz (presa a token = posição do token) ----
  function resolved() {
    const tokens = host.tokens();
    const byId = new Map(tokens.map((t) => [t.id, t]));
    const out = [];
    for (const l of host.lights()) {
      if (!l.enabled) continue;
      let x;
      let y;
      let tokenId = null;
      if (l.token_id) {
        const t = byId.get(l.token_id);
        if (!t) continue;
        x = t.x;
        y = t.y;
        tokenId = t.id;
      } else {
        x = l.x;
        y = l.y;
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      out.push({ l, x, y, tokenId });
    }
    return out;
  }

  // pra onde a lanterna aponta: ângulo salvo (direction) ou o último movimento do token
  function facingFor(entry, aspect) {
    if (!entry.tokenId) return entry.l.direction != null ? (entry.l.direction * Math.PI) / 180 : Math.PI / 2;
    const prev = lastPos.get(entry.tokenId);
    if (prev) {
      const dx = ((entry.x - prev.x) / 100) * aspect;
      const dy = (entry.y - prev.y) / 100;
      if (Math.hypot(dx, dy) > 0.0006) facing.set(entry.tokenId, Math.atan2(dy, dx));
    }
    lastPos.set(entry.tokenId, { x: entry.x, y: entry.y });
    if (!facing.has(entry.tokenId)) {
      facing.set(entry.tokenId, entry.l.direction != null ? (entry.l.direction * Math.PI) / 180 : Math.PI / 2);
    }
    return facing.get(entry.tokenId);
  }

  function polygonFor(entry, aspect, key, radiusPct, coneAngle, dir) {
    const list = lightWalls(aspect);
    const ck = `${entry.l.id}:${key}:${entry.x.toFixed(3)},${entry.y.toFixed(3)},${radiusPct.toFixed(3)},${coneAngle.toFixed(3)},${dir.toFixed(3)}`;
    const hit = polyCache.get(ck);
    if (hit) return hit;
    const o = toWorld(entry.x, entry.y, aspect);
    const R = (radiusPct / 100) * aspect;
    const poly = visibilityPolygon(o.x, o.y, R, list, coneAngle < Math.PI * 2 - 1e-6 ? { dir, angle: coneAngle } : {});
    // não deixa o cache crescer sem fim durante um arrasto (uma chave nova por quadro)
    if (polyCache.size > 400) polyCache.clear();
    polyCache.set(ck, poly);
    return poly;
  }

  // ---- canvas ----
  function sizeCanvases() {
    if (!layer) return;
    const stage = host.stage();
    if (!stage) return;
    const cssW = parseFloat(stage.style.width) || stage.clientWidth;
    const cssH = parseFloat(stage.style.height) || stage.clientHeight;
    if (!cssW || !cssH) return;
    const scale = Math.min(1, MAX_BACKING_W / cssW);
    const w = Math.max(2, Math.round(cssW * scale));
    const h = Math.max(2, Math.round(cssH * scale));
    if (w !== backW || h !== backH) {
      backW = w;
      backH = h;
      dark.width = glow.width = gray.width = w;
      dark.height = glow.height = gray.height = h;
      polyCache.clear();
      dirty = true;
    }
  }

  function buildFogTile() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const blobs = 16;
    for (let i = 0; i < blobs; i++) {
      const x = ((i * 97) % 256) + 7;
      const y = ((i * 151) % 256) + 5;
      const r = 40 + ((i * 37) % 55);
      // desenha também deslocado em ±256 pra emendar sem costura
      for (const ox of [-256, 0, 256]) {
        for (const oy of [-256, 0, 256]) {
          const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
          gr.addColorStop(0, 'rgba(190,200,215,0.55)');
          gr.addColorStop(1, 'rgba(190,200,215,0)');
          g.fillStyle = gr;
          g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
        }
      }
    }
    return c;
  }

  function pathPoly(ctx, poly, aspect) {
    ctx.beginPath();
    poly.forEach((p, i) => {
      const px = (p.x / aspect) * backW;
      const py = p.y * backH;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
  }

  function isAnimated(b, entries) {
    if (!b || !b.lighting_enabled) return false;
    if (b.fog_mode === 'neblina') return true;
    return entries.some((e) => e.l.flicker > 0 || e.l.pulse > 0 || e.l.kind === 'magia');
  }

  // faíscas da luz mágica: pontinhos que giram/sobem em volta do centro (já dentro do clip da luz)
  function drawSparkles(ctx, cx, cy, radiusPx, t, ph, bw) {
    const dot = Math.max(1.2, bw / 700);
    for (let i = 0; i < 10; i++) {
      const ang = t * (0.3 + 0.04 * i) + i * 2.4 + ph;
      const frac = (i * 0.37 + t * 0.1 + ph * 0.1) % 1;
      const rad = (0.2 + 0.8 * frac) * radiusPx;
      const tw = 0.5 + 0.5 * Math.sin(t * 3 + i * 1.7);
      ctx.fillStyle = `rgba(235,245,255,${0.85 * tw})`;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad * 0.9, dot * (0.6 + tw), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- desenho ----
  function draw(now) {
    if (!layer || !dctx || !gctx || !grctx) return false;
    const b = host.board();
    const aspect = host.aspect();
    sizeCanvases();
    dctx.globalCompositeOperation = 'source-over';
    dctx.clearRect(0, 0, backW, backH);
    gctx.clearRect(0, 0, backW, backH);
    grctx.clearRect(0, 0, backW, backH);
    if (!b || !b.lighting_enabled) {
      applyTokenVisibility(null, aspect, b);
      layer.style.display = 'none';
      return false;
    }
    layer.style.display = '';
    const asPlayer = !host.isMaster() || host.viewAsPlayer();
    const t = now / 1000;
    const entries = resolved();
    const alpha = Math.max(0, Math.min(1, asPlayer ? b.ambient : b.ambient * MASTER_DARK_FACTOR));
    const [ar, ag, ab] = hexToRgb(b.ambient_color);

    // 1) escuridão (e névoa por cima dela)
    dctx.fillStyle = `rgba(${ar},${ag},${ab},${alpha})`;
    dctx.fillRect(0, 0, backW, backH);
    if (b.fog_mode === 'neblina') {
      if (!fogTile) fogTile = buildFogTile();
      if (!fogPattern) fogPattern = dctx.createPattern(fogTile, 'repeat');
      if (fogPattern && fogPattern.setTransform) {
        const s = backW / 900;
        fogPattern.setTransform(new DOMMatrix().translate((t * 6) % (256 * s), (t * 3) % (256 * s)).scale(s * 1.4));
      }
      dctx.save();
      dctx.globalAlpha = 0.5 * alpha;
      dctx.fillStyle = fogPattern;
      dctx.fillRect(0, 0, backW, backH);
      dctx.restore();
    }

    // 2) cada luz apaga a escuridão no polígono dela e solta um brilho colorido
    const lit = []; // pra decidir quais tokens aparecem
    for (const e of entries) {
      const l = e.l;
      const ph = phaseOf(l.id);
      const f = l.flicker > 0 ? flickerNoise(t, ph) : 0;
      const pulse = l.pulse > 0 ? Math.sin(t * 1.6 + ph) : 0;
      const scale = 1 + l.flicker * 0.1 * f + l.pulse * 0.12 * pulse;
      const inten = Math.max(0, Math.min(1, l.intensity * (1 - l.flicker * 0.1 * ((f + 1) / 2))));
      const dimPct = Math.max(l.dim_radius, l.radius);
      const cone = (l.angle * Math.PI) / 180;
      const isCone = l.angle < 359.5;
      const dir = isCone ? facingFor(e, aspect) : 0;
      // polígono usa o raio MÁXIMO (sem a tremida) -- só o gradiente respira, o cache não invalida
      const poly = polygonFor(e, aspect, 'main', dimPct * 1.12, isCone ? cone : Math.PI * 2, dir);
      const cx = (e.x / 100) * backW;
      const cy = (e.y / 100) * backH;
      const pxPerPct = backW / 100;
      const dimPx = dimPct * pxPerPct * scale;
      const brightPx = Math.min(l.radius, dimPct) * pxPerPct * scale;
      const [lr, lg, lb] = hexToRgb(l.color);

      const isVision = l.kind === 'visao';
      const paint = (polygon, d, br, gain, sparkles = false) => {
        // apaga a escuridão
        dctx.save();
        dctx.globalCompositeOperation = 'destination-out';
        pathPoly(dctx, polygon, aspect);
        dctx.clip();
        const g = dctx.createRadialGradient(cx, cy, 0, cx, cy, d);
        const rb = Math.max(0, Math.min(0.98, br / d));
        g.addColorStop(0, `rgba(0,0,0,${inten * gain})`);
        g.addColorStop(rb, `rgba(0,0,0,${inten * gain})`);
        g.addColorStop(rb + (1 - rb) * 0.5, `rgba(0,0,0,${inten * gain * 0.4})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        dctx.fillStyle = g;
        dctx.fillRect(cx - d, cy - d, d * 2, d * 2);
        dctx.restore();
        if (isVision) {
          // visão no escuro: enxerga sem cor (dessatura por cima do mapa)
          grctx.save();
          pathPoly(grctx, polygon, aspect);
          grctx.clip();
          const gr = grctx.createRadialGradient(cx, cy, 0, cx, cy, d);
          gr.addColorStop(0, `rgba(128,128,128,${0.95 * inten})`);
          gr.addColorStop(Math.max(0.15, rb), `rgba(128,128,128,${0.85 * inten})`);
          gr.addColorStop(1, 'rgba(128,128,128,0)');
          grctx.fillStyle = gr;
          grctx.fillRect(cx - d, cy - d, d * 2, d * 2);
          grctx.restore();
          return;
        }
        // brilho colorido
        gctx.save();
        gctx.globalCompositeOperation = 'lighter';
        pathPoly(gctx, polygon, aspect);
        gctx.clip();
        const gg = gctx.createRadialGradient(cx, cy, 0, cx, cy, d);
        gg.addColorStop(0, `rgba(${lr},${lg},${lb},${0.38 * inten * gain})`);
        gg.addColorStop(Math.max(0.15, rb * 0.8), `rgba(${lr},${lg},${lb},${0.2 * inten * gain})`);
        gg.addColorStop(1, `rgba(${lr},${lg},${lb},0)`);
        gctx.fillStyle = gg;
        gctx.fillRect(cx - d, cy - d, d * 2, d * 2);
        if (sparkles) drawSparkles(gctx, cx, cy, br, t, ph, backW);
        gctx.restore();
      };

      paint(poly, dimPx, brightPx, 1, l.kind === 'magia');
      lit.push({ poly, x: e.x, y: e.y, dimPct: dimPct * scale });
      if (isCone) {
        // halo curto em volta de quem carrega a lanterna (círculo completo)
        const halo = polygonFor(e, aspect, 'halo', HALO_PCT, Math.PI * 2, 0);
        paint(halo, HALO_PCT * pxPerPct, HALO_PCT * pxPerPct * 0.5, 0.85);
        lit.push({ poly: halo, x: e.x, y: e.y, dimPct: HALO_PCT });
      }
    }
    applyTokenVisibility(asPlayer ? lit : null, aspect, b);
    return isAnimated(b, entries);
  }

  // jogador: token fora de qualquer luz some (menos o dele). lit = null = ninguém escondido
  function applyTokenVisibility(lit, aspect, b) {
    if (!layer || !layer.parentElement) return;
    const els = layer.parentElement.querySelectorAll('.board-token');
    const byId = new Map(host.tokens().map((t) => [t.id, t]));
    const mine = host.characterId();
    els.forEach((el) => {
      const t = byId.get(el.dataset.tokenId);
      let unseen = false;
      if (lit && b && b.lighting_enabled && t && !(mine && t.character_id === mine)) {
        const w = toWorld(t.x, t.y, aspect);
        unseen = !lit.some((L) => {
          const o = toWorld(L.x, L.y, aspect);
          // 88% da penumbra: no extremo dela a luz já é praticamente zero, o token ainda ficaria "visível no escuro"
          return Math.hypot(w.x - o.x, w.y - o.y) <= (L.dimPct * 0.88 / 100) * aspect && pointInPolygon(w.x, w.y, L.poly);
        });
      }
      if (unseen) el.dataset.unseen = '1';
      else delete el.dataset.unseen;
    });
  }

  function frame(now) {
    raf = null;
    // tela trocada/removida sem fechar o tabuleiro: o loop se encerra sozinho
    if (!layer || !layer.isConnected) return;
    if (document.hidden && !dirty) return;
    const wait = now - lastFrame < FRAME_MS;
    if (!dirty && wait) {
      raf = requestAnimationFrame(frame);
      return;
    }
    lastFrame = now;
    dirty = false;
    const animated = draw(now);
    if (animated) raf = requestAnimationFrame(frame);
  }
  function schedule() {
    if (raf === null) raf = requestAnimationFrame(frame);
  }

  return {
    // chamado a cada render da tela (o elemento é recriado)
    attach(layerEl) {
      layer = layerEl;
      dark = layer ? layer.querySelector('canvas.board-dark') : null;
      glow = layer ? layer.querySelector('canvas.board-glow') : null;
      gray = layer ? layer.querySelector('canvas.board-gray') : null;
      dctx = dark ? dark.getContext('2d') : null;
      gctx = glow ? glow.getContext('2d') : null;
      grctx = gray ? gray.getContext('2d') : null;
      backW = 0;
      backH = 0;
      fogPattern = null;
      polyCache.clear();
      dirty = true;
      if (layer) {
        // desenha já (no mesmo tick do innerHTML) pra não piscar sem escuridão
        draw(performance.now());
        schedule();
      }
    },
    // algo mudou (token andou, parede, luz, ajuste): redesenha no próximo quadro
    update() {
      dirty = true;
      schedule();
    },
    resize() {
      sizeCanvases();
      dirty = true;
      schedule();
    },
    stop() {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      layer = null;
    },
    // pra onde a lanterna do token aponta agora (rad) -- o board.js grava ao soltar o token
    getFacing(tokenId) {
      return facing.has(tokenId) ? facing.get(tokenId) : null;
    },
    invalidate() {
      polyCache.clear();
      dirty = true;
      schedule();
    },
  };
}
