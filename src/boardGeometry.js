// Tabuleiro -- geometria pura (sem DOM, testável em Node) das paredes:
// colisão de token ("parar e deslizar") e polígono de visibilidade da luz.
//
// ESPAÇO DO MUNDO: o banco guarda x/y em % do palco (0-100 nos dois eixos),
// mas o palco não é quadrado -- pra distâncias fazerem sentido (um círculo
// continuar círculo) tudo aqui roda num espaço com ALTURA = 1 e LARGURA =
// `aspect` (largura/altura da imagem): u = x/100 * aspect, v = y/100. Raio
// de token (size em % da largura) vira size/100 * aspect / 2.
//
// Uma "parede" aqui é só { x1, y1, x2, y2 } já em unidades do mundo; quem
// chama filtra por tipo/porta com `blockingWalls` e converte com `toWorld`.

export const SKIN = 1e-5; // folguinha entre o token e a parede depois de um contato
const EPS = 1e-9;

export function toWorld(xPct, yPct, aspect) {
  return { x: (xPct / 100) * aspect, y: yPct / 100 };
}
export function toPct(x, y, aspect) {
  return { x: (x / aspect) * 100, y: y * 100 };
}

// parede do banco (em %) -> segmento do mundo
export function wallToWorld(w, aspect) {
  return { x1: (w.x1 / 100) * aspect, y1: w.y1 / 100, x2: (w.x2 / 100) * aspect, y2: w.y2 / 100, id: w.id };
}

// só as paredes que contam pra `purpose` ('move' | 'light'): respeita as flags
// e a porta aberta (porta aberta não bloqueia nada).
export function blockingWalls(walls, purpose, aspect) {
  const out = [];
  for (const w of walls) {
    if (w.kind === 'porta' && w.door_open) continue;
    if (purpose === 'move' ? !w.blocks_move : !w.blocks_light) continue;
    out.push(wallToWorld(w, aspect));
  }
  return out;
}

export function distPointSeg(px, py, x1, y1, x2, y2) {
  const sx = x2 - x1;
  const sy = y2 - y1;
  const len2 = sx * sx + sy * sy;
  let t = len2 < EPS ? 0 : ((px - x1) * sx + (py - y1) * sy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + sx * t;
  const cy = y1 + sy * t;
  return { d: Math.hypot(px - cx, py - cy), cx, cy, t };
}

// interseção própria de dois segmentos (inclui encostar na ponta)
export function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-14) return false;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

// distância ao longo do raio (dx,dy unitário) até o segmento; Infinity se não bate
export function raySegment(ox, oy, dx, dy, x1, y1, x2, y2) {
  const sx = x2 - x1;
  const sy = y2 - y1;
  const den = dx * sy - dy * sx;
  if (Math.abs(den) < 1e-12) return Infinity;
  const t = ((x1 - ox) * sy - (y1 - oy) * sx) / den;
  const u = ((x1 - ox) * dy - (y1 - oy) * dx) / den;
  if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9) return t;
  return Infinity;
}

// ------------------------------------------------------------------
// colisão: círculo (raio r) andando de `from` até `to`
// ------------------------------------------------------------------

// primeiro contato do círculo em movimento com UMA parede: { t, nx, ny } ou null
function sweepCircleSegment(fx, fy, dx, dy, r, w) {
  // já encostado (ou sobreposto por folga numérica, ex.: canto entre duas
  // paredes): bloqueia só o que ainda empurra PRA DENTRO, na direção da
  // normal de saída -- o resto desliza
  const near = distPointSeg(fx, fy, w.x1, w.y1, w.x2, w.y2);
  if (near.d < r + 1e-9) {
    const ln = near.d || 1;
    const nx = near.d > 1e-12 ? (fx - near.cx) / ln : 0;
    const ny = near.d > 1e-12 ? (fy - near.cy) / ln : 0;
    if (near.d > 1e-12 && dx * nx + dy * ny < -1e-12) return { t: 0, nx, ny };
    return null;
  }
  let best = null;
  const consider = (t, nx, ny) => {
    if (t < -1e-9 || t > 1 + 1e-9) return;
    if (!best || t < best.t) best = { t: Math.max(0, t), nx, ny };
  };
  // contato com as pontas (círculo contra ponto)
  for (const [px, py] of [[w.x1, w.y1], [w.x2, w.y2]]) {
    const mx = fx - px;
    const my = fy - py;
    const a = dx * dx + dy * dy;
    if (a < EPS) continue;
    const b = mx * dx + my * dy;
    const c = mx * mx + my * my - r * r;
    if (c < -1e-9) continue; // já dentro: tratado fora (parede ignorada)
    if (b >= 0) continue; // afastando
    const disc = b * b - a * c;
    if (disc < 0) continue;
    const t = (-b - Math.sqrt(disc)) / a;
    const cx = fx + dx * t;
    const cy = fy + dy * t;
    const ln = Math.hypot(cx - px, cy - py) || 1;
    consider(t, (cx - px) / ln, (cy - py) / ln);
  }
  // contato com a face (reta deslocada de r)
  const sx = w.x2 - w.x1;
  const sy = w.y2 - w.y1;
  const len = Math.hypot(sx, sy);
  if (len > EPS) {
    const nx = -sy / len;
    const ny = sx / len;
    const s0 = (fx - w.x1) * nx + (fy - w.y1) * ny;
    const ds = dx * nx + dy * ny;
    const side = s0 >= 0 ? 1 : -1;
    if (Math.abs(ds) > EPS && ds * side < 0 && Math.abs(s0) >= r - 1e-9) {
      const t = (side * r - s0) / ds;
      if (t >= -1e-9 && t <= 1 + 1e-9) {
        const cx = fx + dx * t;
        const cy = fy + dy * t;
        const along = ((cx - w.x1) * sx + (cy - w.y1) * sy) / (len * len);
        if (along >= 0 && along <= 1) consider(t, nx * side, ny * side);
      }
    }
  }
  return best;
}

// distância do centro à parede mais próxima da lista (pra detectar quem já está "dentro")
function penetrating(x, y, r, w) {
  return distPointSeg(x, y, w.x1, w.y1, w.x2, w.y2).d < r - 1e-7;
}

// Anda de `from` até `to` sem atravessar nenhuma parede: no primeiro contato
// para encostado e DESLIZA pelo que sobrou do movimento (até `iterations`
// vezes, pra contornar cantos). Testa o TRAJETO inteiro (varredura), não só o
// ponto final -- um arrasto rápido nunca "pula" uma parede. Parede em que o
// token já está enfiado (ex.: mestre desenhou por cima dele) é ignorada pra ele
// poder sair. Devolve { x, y, hit }.
export function resolveMove(from, to, r, walls, iterations = 6, trace = null) {
  let fx = from.x;
  let fy = from.y;
  let dx = to.x - fx;
  let dy = to.y - fy;
  let hit = false;
  const active = walls.filter((w) => !penetrating(from.x, from.y, r, w));
  if (trace) trace.push({ x: fx, y: fy });
  for (let it = 0; it < iterations; it++) {
    if (dx * dx + dy * dy < 1e-14) break;
    let first = null;
    for (const w of active) {
      const h = sweepCircleSegment(fx, fy, dx, dy, r, w);
      if (h && (!first || h.t < first.t)) first = h;
    }
    if (!first) {
      fx += dx;
      fy += dy;
      dx = 0;
      dy = 0;
      if (trace) trace.push({ x: fx, y: fy });
      break;
    }
    hit = true;
    fx += dx * first.t + first.nx * SKIN;
    fy += dy * first.t + first.ny * SKIN;
    if (trace) trace.push({ x: fx, y: fy });
    const remX = dx * (1 - first.t);
    const remY = dy * (1 - first.t);
    const dot = remX * first.nx + remY * first.ny;
    dx = remX - dot * first.nx;
    dy = remY - dot * first.ny;
  }
  // se sobrou movimento (acabaram as iterações) não anda mais -- melhor ficar
  // parado do que arriscar atravessar
  // rede de segurança numérica: nunca devolver uma posição dentro de parede
  for (const w of active) {
    if (penetrating(fx, fy, r, w)) return { x: from.x, y: from.y, hit: true };
  }
  return { x: fx, y: fy, hit };
}

// ------------------------------------------------------------------
// luz: polígono de visibilidade (varredura angular)
// ------------------------------------------------------------------

const normAngle = (a) => {
  const t = Math.PI * 2;
  return ((a % t) + t) % t;
};

// opts: { dir (rad), angle (rad, abertura total do cone; >= 2π = círculo) }
// devolve pontos {x,y} do mundo em ordem anti-horária. Pro cone o primeiro
// ponto é a origem.
export function visibilityPolygon(ox, oy, R, walls, opts = {}) {
  const cone = opts.angle !== undefined && opts.angle < Math.PI * 2 - 1e-6;
  const half = cone ? opts.angle / 2 : Math.PI;
  const dir = cone ? normAngle(opts.dir || 0) : 0;
  // só segmentos que chegam perto do raio + a moldura quadrada que fecha o polígono
  const segs = [];
  for (const w of walls) {
    const minX = Math.min(w.x1, w.x2);
    const maxX = Math.max(w.x1, w.x2);
    const minY = Math.min(w.y1, w.y2);
    const maxY = Math.max(w.y1, w.y2);
    if (maxX < ox - R || minX > ox + R || maxY < oy - R || minY > oy + R) continue;
    segs.push(w);
  }
  const L = ox - R;
  const Rt = ox + R;
  const T = oy - R;
  const B = oy + R;
  segs.push({ x1: L, y1: T, x2: Rt, y2: T }, { x1: Rt, y1: T, x2: Rt, y2: B }, { x1: Rt, y1: B, x2: L, y2: B }, { x1: L, y1: B, x2: L, y2: T });

  const angles = [];
  const addAngle = (a) => {
    angles.push(normAngle(a - 1e-4), normAngle(a), normAngle(a + 1e-4));
  };
  for (const s of segs) {
    addAngle(Math.atan2(s.y1 - oy, s.x1 - ox));
    addAngle(Math.atan2(s.y2 - oy, s.x2 - ox));
  }
  // paredes que se cruzam (T, X, cantos): o "mais perto" troca no ponto de
  // cruzamento, que não é ponta de nenhuma -- sem esses ângulos o polígono
  // cortaria o canto
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = segmentIntersection(segs[i], segs[j]);
      if (p) addAngle(Math.atan2(p.y - oy, p.x - ox));
    }
  }
  if (cone) {
    angles.push(normAngle(dir - half), normAngle(dir + half), dir);
  }
  const inCone = (a) => {
    if (!cone) return true;
    let d = Math.abs(normAngle(a) - dir);
    if (d > Math.PI) d = Math.PI * 2 - d;
    return d <= half + 1e-9;
  };
  // pro cone, ordena a partir da borda esquerda do leque pra manter a ordem contínua
  const start = cone ? normAngle(dir - half) : 0;
  const rel = (a) => normAngle(a - start);
  const picked = angles.filter(inCone).sort((p, q) => rel(p) - rel(q));
  const pts = cone ? [{ x: ox, y: oy }] : [];
  let lastA = null;
  for (const a of picked) {
    if (lastA !== null && Math.abs(a - lastA) < 1e-12) continue;
    lastA = a;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    let best = Infinity;
    for (const s of segs) {
      const t = raySegment(ox, oy, cx, cy, s.x1, s.y1, s.x2, s.y2);
      if (t < best) best = t;
    }
    if (!Number.isFinite(best)) best = R;
    pts.push({ x: ox + cx * best, y: oy + cy * best });
  }
  return pts;
}

function segmentIntersection(a, b) {
  const rx = a.x2 - a.x1;
  const ry = a.y2 - a.y1;
  const sx = b.x2 - b.x1;
  const sy = b.y2 - b.y1;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-14) return null;
  const t = ((b.x1 - a.x1) * sy - (b.y1 - a.y1) * sx) / den;
  const u = ((b.x1 - a.x1) * ry - (b.y1 - a.y1) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x1 + rx * t, y: a.y1 + ry * t };
}

export function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ------------------------------------------------------------------
// editor de paredes: encaixe de um ponto nas pontas vizinhas (e na grade)
// ------------------------------------------------------------------
// pt e walls em % do palco; `thresholdPct` = raio do ímã em %; `gridPct` = passo
// da grade em % (0 = sem grade). Ponta de parede vence a grade.
export function snapPoint(pt, walls, thresholdPct, gridPct = 0, extra = []) {
  let best = null;
  let bestD = thresholdPct;
  const consider = (x, y) => {
    const d = Math.hypot(pt.x - x, pt.y - y);
    if (d <= bestD) {
      bestD = d;
      best = { x, y, snapped: 'ponta' };
    }
  };
  for (const w of walls) {
    consider(w.x1, w.y1);
    consider(w.x2, w.y2);
  }
  for (const e of extra) consider(e.x, e.y);
  if (best) return best;
  if (gridPct > 0) {
    return { x: Math.round(pt.x / gridPct) * gridPct, y: Math.round(pt.y / gridPct) * gridPct, snapped: 'grade' };
  }
  return { x: pt.x, y: pt.y, snapped: null };
}
