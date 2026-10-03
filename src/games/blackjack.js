// Easter egg — Blackjack (vinte-e-um) em canvas puro, sem lib externa.
// Você contra a banca numa mesa de 4 baralhos, 25 mãos, começando com 1.000
// fichas -- o placar é quantas fichas você tem no fim (ou quando a banca
// te quebra: sem 10 fichas pra apostar, a mesa te dispensa).
//
// Regras de cassino de verdade: a banca PARA em qualquer 17 (inclusive o
// 17 "mole", com ás valendo 11); blackjack natural paga 3 pra 2; dobrar
// (uma carta só) em qualquer mão de 2 cartas; dividir par uma vez (cartas
// de valor 10 contam como par; dividir ases dá uma carta só pra cada, e
// 21 depois de dividir NÃO é blackjack, paga 1 pra 1); a banca "espia" o
// buraco quando mostra ás ou 10 e já encerra a mão se tiver blackjack.
// Sapato reembaralhado quando restam menos de 52 cartas.
//
// Entradas: clique/toque nos botões e nas fichas; teclado: 1-4 soma 10/25/
// 50/100 na aposta, Enter distribui, Backspace limpa, R repete a última
// aposta, H pede carta, S fica, D dobra, P divide.
//
// O visual muda com o tema ativo (ver `styleOf`): os dois temas especiais
// ganham pintura própria (feltro verde sob a lâmpada / salão art déco de
// ouro e marfim), os demais ficam no clássico com as cores do tema.
import { readThemeColors } from './theme.js';
import { sfx } from './sound.js';

const DECKS = 4;
const RESHUFFLE_BELOW = 52;
const ROUNDS = 25;
const START_CHIPS = 1000;
const MIN_BET = 10;
const MAX_BET = 500;
const CHIP_VALUES = [10, 25, 50, 100];
const DEAL_GAP_MS = 280;
const DEALER_GAP_MS = 520;
const RESULT_MS = 1900;
const END_MS = 1700;

const SUITS = ['♠', '♥', '♣', '♦'];
const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// ---------- regras (puras, exportadas pros testes) ----------
export function cardPoints(rank) {
  if (rank === 1) return 11;
  return rank >= 10 ? 10 : rank;
}
// total da mão: os ases valem 11 enquanto não estourar, senão 1
export function handValue(cards) {
  let total = 0;
  let aces = 0;
  cards.forEach((c) => {
    total += cardPoints(c.r);
    if (c.r === 1) aces += 1;
  });
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}
export function isNaturalBlackjack(cards) {
  return cards.length === 2 && handValue(cards).total === 21;
}
export function canSplitCards(cards) {
  return cards.length === 2 && cardPoints(cards[0].r) === cardPoints(cards[1].r);
}
// o que a banca faz: pede até 17, e PARA em qualquer 17 (inclusive mole)
export function dealerShouldHit(cards) {
  return handValue(cards).total < 17;
}
function newShoe() {
  const shoe = [];
  for (let d = 0; d < DECKS; d++) for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) shoe.push({ r, s });
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

function styleOf() {
  const id = document.documentElement.getAttribute('data-theme');
  if (id === 'blackjack-feltro') return 'feltro';
  if (id === 'blackjack-deco') return 'deco';
  return 'classic';
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function createBlackjackGame(canvas, { onScoreChange, onGameOver }) {
  const ctx = canvas.getContext('2d');
  canvas.style.touchAction = 'none';
  const W = canvas.width;
  const H = canvas.height;

  const CARD_W = 46;
  const CARD_H = 64;
  const DEALER_Y = 96;
  const PLAYER_Y = 232;

  let shoe, chips, handNo, bet, lastBet, phase; // 'bet' | 'dealing' | 'player' | 'dealer' | 'result' | 'over'
  let hands, active, dealer;
  let message, messageColor, messageUntil;
  let raf = null;
  let running = false;
  let colors = readThemeColors();
  let style = styleOf();
  let timers = [];
  let listeners = [];
  let particles = [];
  let buttons = []; // { x,y,w,h,label,enabled,onClick }
  let shakeUntil = 0;
  let lastTs = null;

  function later(fn, ms) {
    timers.push(setTimeout(fn, ms));
  }
  function stopTimers() {
    timers.forEach((t) => clearTimeout(t));
    timers = [];
  }
  function notify() {
    onScoreChange && onScoreChange(chips);
  }

  // ---------- sapato ----------
  function draw1() {
    if (shoe.length < 1) shoe = newShoe();
    return shoe.pop();
  }
  function ensureShoe() {
    if (!shoe || shoe.length < RESHUFFLE_BELOW) {
      shoe = newShoe();
      flashMsg('sapato embaralhado', '', 1200);
    }
  }
  function flashMsg(text, color, ms = 1400) {
    message = text;
    messageColor = color || null;
    messageUntil = Date.now() + ms;
  }

  // ---------- mãos ----------
  function makeCard(card, fromX, fromY, toX, toY, faceUp) {
    return { r: card.r, s: card.s, x: fromX, y: fromY, tx: toX, ty: toY, faceUp, flip: faceUp ? 1 : 0, born: Date.now() };
  }
  function layout() {
    // posições-alvo das cartas (mão do jogador, uma ou duas lado a lado)
    const n = hands.length;
    hands.forEach((h, hi) => {
      const span = n === 1 ? W : W / 2;
      const cx = n === 1 ? W / 2 : span * hi + span / 2;
      const step = Math.min(24, (span - 60 - CARD_W) / Math.max(1, h.cards.length - 1));
      const total = CARD_W + step * (h.cards.length - 1);
      h.cards.forEach((c, i) => {
        c.tx = cx - total / 2 + step * i + CARD_W / 2;
        c.ty = PLAYER_Y;
      });
      h.cx = cx;
    });
    const dstep = Math.min(26, (W - 60 - CARD_W) / Math.max(1, dealer.cards.length - 1));
    const dtotal = CARD_W + dstep * (dealer.cards.length - 1);
    dealer.cards.forEach((c, i) => {
      c.tx = W / 2 - dtotal / 2 + dstep * i + CARD_W / 2;
      c.ty = DEALER_Y;
    });
  }
  function giveTo(list, faceUp) {
    const c = makeCard(draw1(), W - 40, -30, W / 2, PLAYER_Y, faceUp);
    list.push(c);
    layout();
    sfx.card();
    return c;
  }

  function reset() {
    stopTimers();
    shoe = null;
    chips = START_CHIPS;
    handNo = 0;
    bet = 0;
    lastBet = 0;
    particles = [];
    hands = [];
    active = 0;
    dealer = { cards: [], hideHole: true };
    message = '';
    messageUntil = 0;
    ensureShoe();
    nextHandSetup();
  }
  function nextHandSetup() {
    handNo += 1;
    phase = 'bet';
    bet = 0;
    hands = [{ cards: [], bet: 0, done: false, doubled: false, fromSplit: false, result: null, cx: W / 2 }];
    dealer = { cards: [], hideHole: true };
    active = 0;
  }

  // ---------- apostas ----------
  function maxBet() {
    return Math.min(MAX_BET, chips);
  }
  function addBet(v) {
    if (phase !== 'bet') return;
    if (bet + v > maxBet()) {
      flashMsg(`aposta máxima: ${maxBet()}`, colors.warn, 900);
      return;
    }
    bet += v;
    sfx.chip();
  }
  function clearBet() {
    if (phase !== 'bet') return;
    bet = 0;
  }
  function repeatBet() {
    if (phase !== 'bet' || !lastBet) return;
    bet = Math.min(lastBet, maxBet());
    sfx.chip();
  }

  // ---------- fluxo da mão ----------
  function deal() {
    if (phase !== 'bet') return;
    if (bet < MIN_BET) {
      flashMsg(`aposta mínima: ${MIN_BET}`, colors.warn, 900);
      return;
    }
    ensureShoe();
    phase = 'dealing';
    lastBet = bet;
    chips -= bet;
    hands[0].bet = bet;
    notify();
    sfx.chip();
    const h = hands[0];
    giveTo(h.cards, true);
    later(() => giveTo(dealer.cards, true), DEAL_GAP_MS);
    later(() => giveTo(h.cards, true), DEAL_GAP_MS * 2);
    later(() => {
      const c = giveTo(dealer.cards, false);
      c.faceUp = false;
      afterInitialDeal();
    }, DEAL_GAP_MS * 3);
  }

  function dealerUp() {
    return dealer.cards[0];
  }
  function afterInitialDeal() {
    later(() => {
      if (!running) return;
      const up = dealerUp();
      const dealerBJ = isNaturalBlackjack(dealer.cards);
      const playerBJ = isNaturalBlackjack(hands[0].cards);
      // a banca "espia" quando mostra ás ou carta de 10
      if ((up.r === 1 || cardPoints(up.r) === 10) && dealerBJ) {
        revealHole();
        later(() => settle(), 700);
        return;
      }
      if (playerBJ) {
        hands[0].done = true;
        startDealerTurn();
        return;
      }
      phase = 'player';
      active = 0;
    }, 200);
  }

  function revealHole() {
    dealer.hideHole = false;
    dealer.cards.forEach((c) => {
      if (!c.faceUp) {
        c.faceUp = true;
        c.flip = 0;
        c.flipping = Date.now();
      }
    });
    sfx.card();
  }

  function advanceHand() {
    // próxima mão do jogador (split) ou vez da banca
    for (let i = active + 1; i < hands.length; i++) {
      if (!hands[i].done) {
        active = i;
        // a segunda mão do split ainda só tem 1 carta: completa
        if (hands[i].cards.length === 1) {
          giveTo(hands[i].cards, true);
          if (hands[i].splitAces) hands[i].done = true;
          else if (handValue(hands[i].cards).total === 21) hands[i].done = true;
        }
        if (hands[i].done) continue;
        return;
      }
    }
    startDealerTurn();
  }

  function startDealerTurn() {
    phase = 'dealer';
    // a banca só compra se sobrou alguma mão viva que não seja blackjack natural (esse já está ganho)
    const anyAlive = hands.some((h) => handValue(h.cards).total <= 21 && !(isNaturalBlackjack(h.cards) && !h.fromSplit));
    revealHole();
    const draw = () => {
      if (!running) return;
      if (anyAlive && dealerShouldHit(dealer.cards)) {
        giveTo(dealer.cards, true);
        later(draw, DEALER_GAP_MS);
      } else {
        later(() => settle(), 600);
      }
    };
    later(draw, DEALER_GAP_MS + 300);
  }

  // ---------- ações do jogador ----------
  function curHand() {
    return hands[active];
  }
  function canHit() {
    return phase === 'player' && !curHand().done;
  }
  function canDouble() {
    const h = curHand();
    return phase === 'player' && !h.done && h.cards.length === 2 && chips >= h.bet && !h.splitAces;
  }
  function canSplit() {
    const h = curHand();
    return phase === 'player' && !h.done && hands.length === 1 && canSplitCards(h.cards) && chips >= h.bet;
  }

  function hit() {
    if (!canHit()) return;
    const h = curHand();
    giveTo(h.cards, true);
    const v = handValue(h.cards).total;
    if (v > 21) {
      h.done = true;
      sfx.bust();
      later(() => advanceHand(), 650);
    } else if (v === 21) {
      h.done = true;
      later(() => advanceHand(), 450);
    }
  }
  function stand() {
    if (phase !== 'player' || curHand().done) return;
    curHand().done = true;
    advanceHand();
  }
  function doubleDown() {
    if (!canDouble()) return;
    const h = curHand();
    chips -= h.bet;
    h.bet *= 2;
    h.doubled = true;
    notify();
    sfx.chip();
    giveTo(h.cards, true);
    h.done = true;
    if (handValue(h.cards).total > 21) sfx.bust();
    later(() => advanceHand(), 700);
  }
  function split() {
    if (!canSplit()) return;
    const h = curHand();
    chips -= h.bet;
    notify();
    sfx.chip();
    const second = h.cards.pop();
    const aces = h.cards[0].r === 1;
    h.fromSplit = true;
    h.splitAces = aces;
    hands.push({ cards: [second], bet: h.bet, done: false, doubled: false, fromSplit: true, splitAces: aces, result: null, cx: W / 2 });
    layout();
    giveTo(h.cards, true); // segunda carta da primeira mão
    if (aces || handValue(h.cards).total === 21) {
      h.done = true;
      later(() => advanceHand(), 600);
    }
  }

  // ---------- fim da mão ----------
  function settle() {
    if (!running) return;
    const d = handValue(dealer.cards).total;
    const dBJ = isNaturalBlackjack(dealer.cards);
    let net = 0;
    let text = [];
    hands.forEach((h) => {
      const v = handValue(h.cards).total;
      const pBJ = isNaturalBlackjack(h.cards) && !h.fromSplit;
      let payout = 0; // total devolvido à mesa do jogador (inclui a aposta)
      let res;
      if (v > 21) {
        res = 'perdeu';
      } else if (pBJ && !dBJ) {
        payout = Math.floor(h.bet * 2.5);
        res = 'blackjack';
      } else if (dBJ && !pBJ) {
        res = 'perdeu';
      } else if (pBJ && dBJ) {
        payout = h.bet;
        res = 'empate';
      } else if (d > 21 || v > d) {
        payout = h.bet * 2;
        res = 'ganhou';
      } else if (v === d) {
        payout = h.bet;
        res = 'empate';
      } else {
        res = 'perdeu';
      }
      h.result = res;
      chips += payout;
      net += payout - h.bet;
      text.push(res);
    });
    notify();
    phase = 'result';
    const anyBJ = hands.some((h) => h.result === 'blackjack');
    if (net > 0) {
      sfx.win();
      sparkle(W / 2, PLAYER_Y, colors.accent, 22);
    } else if (net < 0) sfx.lose();
    else sfx.chip();
    const bust = hands.length === 1 && handValue(hands[0].cards).total > 21;
    const label = anyBJ ? 'BLACKJACK!' : bust ? 'ESTOUROU' : net > 0 ? 'GANHOU' : net < 0 ? 'PERDEU' : 'EMPATE';
    flashMsg(`${label}  ${net > 0 ? '+' : net < 0 ? '−' : ''}${Math.abs(net) || ''}`.trim(), net > 0 ? colors.accent : net < 0 ? colors.danger : colors.warn, RESULT_MS - 200);
    later(() => endHand(), RESULT_MS);
  }

  function endHand() {
    if (!running) return;
    if (handNo >= ROUNDS || chips < MIN_BET) {
      phase = 'over';
      flashMsg(chips < MIN_BET ? 'A MESA TE DISPENSOU' : 'FIM DA NOITE', colors.warn, END_MS);
      later(() => {
        if (!running) return;
        stop();
        sfx.gameOver();
        onGameOver && onGameOver(chips);
      }, END_MS);
      return;
    }
    nextHandSetup();
  }

  function sparkle(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 40 + Math.random() * 110;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: 1, color });
    }
    if (particles.length > 80) particles.splice(0, particles.length - 80);
  }

  // ---------- desenho ----------
  function isLight() {
    ctx.fillStyle = colors.bg;
    const c = String(ctx.fillStyle);
    if (c[0] !== '#' || c.length < 7) return false;
    return (parseInt(c.slice(1, 3), 16) * 299 + parseInt(c.slice(3, 5), 16) * 587 + parseInt(c.slice(5, 7), 16) * 114) / 1000 > 150;
  }
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }
  function pal() {
    if (style === 'feltro') return { felt: '#0b3d24', feltHi: '#14683f', rim: '#5a3a1a', ink: '#f4f1e6', dim: '#a9cdb5', gold: '#e8c25a', card: '#fbf9f1', red: '#c4232d', black: '#15151a', back: '#1c4d9c', backHi: '#3a78d8', chipText: '#fff' };
    if (style === 'deco') return { felt: '#124a46', feltHi: '#1b6b64', rim: '#c89b2a', ink: '#f6edd4', dim: '#b9d8cf', gold: '#e0b43e', card: '#fcf6e4', red: '#a8321f', black: '#1b1b1b', back: '#0f3b38', backHi: '#c89b2a', chipText: '#1b1b1b' };
    const light = isLight();
    return { felt: colors.panel, feltHi: colors.bg, rim: colors.line, ink: colors.ink, dim: colors.inkDim, gold: colors.warn, card: light ? '#fffdf6' : '#f0ece0', red: colors.danger, black: '#17171c', back: colors.accentCore, backHi: colors.accent, chipText: '#fff' };
  }

  function suitPath(s, cx, cy, size, color) {
    ctx.fillStyle = color;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(size / 20, size / 20);
    ctx.beginPath();
    if (s === 1) {
      // copas
      ctx.moveTo(0, 8);
      ctx.bezierCurveTo(-14, -2, -9, -12, 0, -5);
      ctx.bezierCurveTo(9, -12, 14, -2, 0, 8);
    } else if (s === 3) {
      // ouros
      ctx.moveTo(0, -9);
      ctx.lineTo(7, 0);
      ctx.lineTo(0, 9);
      ctx.lineTo(-7, 0);
    } else if (s === 0) {
      // espadas
      ctx.moveTo(0, -9);
      ctx.bezierCurveTo(-14, 2, -8, 10, 0, 4);
      ctx.bezierCurveTo(8, 10, 14, 2, 0, -9);
      ctx.moveTo(-1, 3);
      ctx.lineTo(-3.5, 10);
      ctx.lineTo(3.5, 10);
      ctx.lineTo(1, 3);
    } else {
      // paus
      ctx.arc(0, -5, 4.6, 0, Math.PI * 2);
      ctx.moveTo(-5, 3);
      ctx.arc(-5, 3, 4.6, 0, Math.PI * 2);
      ctx.moveTo(10, 3);
      ctx.arc(5, 3, 4.6, 0, Math.PI * 2);
      ctx.moveTo(-1, 3);
      ctx.lineTo(-3.5, 10);
      ctx.lineTo(3.5, 10);
      ctx.lineTo(1, 3);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawCard(c, p, now) {
    // desliza até o alvo
    const k = clamp((now - c.born) / 320, 0, 1);
    const e = 1 - (1 - k) * (1 - k);
    const x = c.x + (c.tx - c.x) * e;
    const y = c.y + (c.ty - c.y) * e;
    // virada (flip) ao revelar
    let sx = 1;
    let faceUp = c.faceUp;
    if (c.flipping) {
      const t = clamp((now - c.flipping) / 320, 0, 1);
      sx = Math.abs(Math.cos(t * Math.PI));
      faceUp = t >= 0.5;
      if (t >= 1) c.flipping = 0;
    }
    ctx.save();
    ctx.translate(x, y);
    // sombra
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-CARD_W / 2 + 3, -CARD_H / 2 + 4, CARD_W * sx, CARD_H);
    ctx.scale(sx, 1);
    ctx.rotate((1 - e) * 0.5);
    if (faceUp) {
      ctx.fillStyle = p.card;
      rr(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      rr(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 5);
      ctx.stroke();
      const red = c.s === 1 || c.s === 3;
      const col = red ? p.red : p.black;
      ctx.fillStyle = col;
      ctx.font = 'bold 15px Georgia, serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(RANKS[c.r], -CARD_W / 2 + 4, -CARD_H / 2 + 3);
      suitPath(c.s, -CARD_W / 2 + 10, -CARD_H / 2 + 26, 11, col);
      // naipe grande no centro-direita
      suitPath(c.s, 4, 10, 26, col);
      if (c.r >= 11) {
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.18;
        ctx.font = 'bold 40px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(RANKS[c.r], 6, 4);
        ctx.globalAlpha = 1;
      }
    } else {
      ctx.fillStyle = p.back;
      rr(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 5);
      ctx.fill();
      ctx.strokeStyle = p.backHi;
      ctx.lineWidth = 2;
      rr(-CARD_W / 2 + 4, -CARD_H / 2 + 4, CARD_W - 8, CARD_H - 8, 3);
      ctx.stroke();
      ctx.fillStyle = p.backHi;
      ctx.globalAlpha = 0.5;
      for (let i = -2; i <= 2; i++) for (let j = -3; j <= 3; j++) if ((i + j) % 2 === 0) ctx.fillRect(i * 7 - 2, j * 7 - 2, 4, 4);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawChip(x, y, r, value, p, selected) {
    const chipCol = { 10: '#3a8dff', 25: '#2fa84f', 50: '#d8452e', 100: '#222' }[value] || p.gold;
    ctx.save();
    ctx.translate(x, y);
    if (selected) {
      ctx.shadowColor = p.gold;
      ctx.shadowBlur = 12;
    }
    ctx.fillStyle = chipCol;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, r - 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.arc(0, 0, r - 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${value >= 100 ? 11 : 13}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), 0, 1);
    ctx.restore();
  }

  function drawTable(p) {
    ctx.fillStyle = style === 'classic' ? colors.bg : '#0a0a0a';
    ctx.fillRect(0, 0, W, H);
    // feltro
    const g = ctx.createRadialGradient(W / 2, 170, 20, W / 2, 170, 270);
    g.addColorStop(0, p.feltHi);
    g.addColorStop(1, p.felt);
    ctx.fillStyle = g;
    rr(6, 38, W - 12, H - 44, 22);
    ctx.fill();
    ctx.strokeStyle = p.rim;
    ctx.lineWidth = 5;
    rr(6, 38, W - 12, H - 44, 22);
    ctx.stroke();
    if (style === 'deco') {
      ctx.strokeStyle = 'rgba(224,180,62,0.55)';
      ctx.lineWidth = 1.5;
      rr(14, 46, W - 28, H - 60, 16);
      ctx.stroke();
      // leque art déco no centro da mesa
      ctx.strokeStyle = 'rgba(224,180,62,0.28)';
      for (let i = 1; i <= 5; i++) {
        ctx.beginPath();
        ctx.arc(W / 2, 190, 30 + i * 14, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      }
    } else {
      // arco de texto "BLACKJACK PAGA 3 PARA 2" gravado no feltro
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(W / 2, 28, 150, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BLACKJACK PAGA 3 PARA 2', W / 2, 150);
    ctx.fillText('BANCA PARA NO 17', W / 2, 163);
  }

  function btn(x, y, w, h, label, enabled, onClick, kind = 'main') {
    buttons.push({ x, y, w, h, enabled, onClick });
    const p = pal();
    ctx.save();
    ctx.globalAlpha = enabled ? 1 : 0.32;
    const fill = kind === 'main' ? colors.accent : kind === 'warn' ? p.gold : 'rgba(0,0,0,0.4)';
    ctx.fillStyle = kind === 'ghost' ? fill : style === 'deco' ? (kind === 'main' ? '#e0b43e' : '#f0d27a') : style === 'feltro' ? (kind === 'main' ? '#3a8dff' : '#e8c25a') : fill;
    rr(x, y, w, h, 9);
    ctx.fill();
    if (kind !== 'ghost') {
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      rr(x + 2, y + 2, w - 4, h * 0.4, 7);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    rr(x, y, w, h, 9);
    ctx.stroke();
    ctx.fillStyle = kind === 'ghost' ? p.ink : '#111';
    // texto claro sobre botão escuro
    if (kind !== 'ghost') {
      ctx.fillStyle = '#111';
    }
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    ctx.restore();
  }

  function valueLabel(cards, hideSecond) {
    const list = hideSecond ? cards.slice(0, 1) : cards;
    if (!list.length) return '';
    const v = handValue(list);
    return v.soft && v.total <= 21 && list.length > 1 ? `${v.total - 10}/${v.total}` : String(v.total);
  }

  function drawHands(p, now) {
    // banca
    ctx.fillStyle = p.dim;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BANCA', W / 2, 58);
    dealer.cards.forEach((c) => drawCard(c, p, now));
    if (dealer.cards.length) {
      const hide = dealer.hideHole && dealer.cards.length > 1;
      const lbl = valueLabel(dealer.cards, hide);
      drawBadge(W / 2 + (CARD_W / 2 + Math.min(26, 0) + 16 + Math.max(0, dealer.cards.length - 1) * 13), DEALER_Y - 26, lbl, p);
    }
    // jogador
    hands.forEach((h, hi) => {
      if (h.cards.length) {
        h.cards.forEach((c) => drawCard(c, p, now));
        const v = handValue(h.cards).total;
        const isActive = phase === 'player' && hi === active && !h.done;
        drawBadge(h.cx, PLAYER_Y + CARD_H / 2 + 14, valueLabel(h.cards, false), p, v > 21 ? p.red : isActive ? colors.accent : null);
        if (isActive && hands.length > 1) {
          ctx.strokeStyle = colors.accent;
          ctx.lineWidth = 2;
          rr(h.cx - 56, PLAYER_Y - CARD_H / 2 - 8, 112, CARD_H + 16, 8);
          ctx.stroke();
        }
        if (h.result && phase === 'result') {
          ctx.fillStyle = h.result === 'perdeu' ? p.red : h.result === 'empate' ? p.gold : '#4ade80';
          ctx.font = 'bold 12px monospace';
          ctx.fillText(h.result.toUpperCase(), h.cx, PLAYER_Y - CARD_H / 2 - 16);
        }
      }
      if (h.bet > 0) {
        // fichas da aposta ao lado da mão
        ctx.fillStyle = p.gold;
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`aposta ${h.bet}`, h.cx, PLAYER_Y + CARD_H / 2 + 36);
      }
    });
  }
  function drawBadge(x, y, text, p, color) {
    if (!text) return;
    ctx.save();
    ctx.font = 'bold 12px monospace';
    const w = ctx.measureText(text).width + 14;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    rr(x - w / 2, y - 10, w, 20, 10);
    ctx.fill();
    ctx.fillStyle = color || p.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 1);
    ctx.restore();
  }

  function drawUi(p) {
    buttons = [];
    // cabeçalho
    ctx.fillStyle = style === 'classic' ? colors.ink : p.ink;
    ctx.font = 'bold 13px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(`MÃO ${Math.min(handNo, ROUNDS)}/${ROUNDS}`, 14, 18);
    ctx.textAlign = 'right';
    ctx.fillStyle = style === 'classic' ? colors.warn : p.gold;
    ctx.fillText(`FICHAS ${chips}`, W - 14, 18);
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = style === 'classic' ? colors.inkDim : p.dim;
    ctx.fillText(`sapato: ${shoe ? shoe.length : 0} cartas`, W / 2, 18);

    const by = 346;
    if (phase === 'bet') {
      // fichas pra apostar
      CHIP_VALUES.forEach((v, i) => {
        const cx = 50 + i * 86;
        drawChip(cx, 318, 24, v, p, false);
        buttons.push({ x: cx - 24, y: 294, w: 48, h: 48, enabled: true, onClick: () => addBet(v) });
      });
      ctx.fillStyle = p.gold;
      ctx.font = 'bold 15px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`APOSTA: ${bet}`, W / 2, 268);
      btn(14, by + 12, 70, 34, 'LIMPAR', bet > 0, clearBet, 'ghost');
      btn(90, by + 12, 70, 34, 'REPETIR', lastBet > 0 && lastBet <= chips, repeatBet, 'ghost');
      btn(168, by + 12, 178, 34, 'DISTRIBUIR', bet >= MIN_BET, deal, 'main');
    } else {
      const en = phase === 'player';
      btn(10, by + 8, 80, 36, 'CARTA (H)', en && canHit(), hit, 'main');
      btn(96, by + 8, 80, 36, 'FICAR (S)', en, stand, 'warn');
      btn(182, by + 8, 80, 36, 'DOBRAR (D)', en && canDouble(), doubleDown, 'main');
      btn(268, by + 8, 82, 36, 'DIVIDIR (P)', en && canSplit(), split, 'warn');
    }
    ctx.fillStyle = style === 'classic' ? colors.inkDim : p.dim;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(phase === 'bet' ? 'teclas 1-4 somam fichas · Enter distribui · R repete' : 'H carta · S ficar · D dobrar · P dividir', W / 2, H - 14);
  }

  function draw() {
    colors = readThemeColors();
    style = styleOf();
    const p = pal();
    const now = Date.now();
    ctx.save();
    if (shakeUntil > now) ctx.translate((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5);
    drawTable(p);
    drawHands(p, now);
    particles.forEach((q) => {
      ctx.globalAlpha = Math.max(0, q.life);
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - 2, q.y - 2, 4, 4);
    });
    ctx.globalAlpha = 1;
    ctx.restore();
    drawUi(p);
    if (messageUntil > now) {
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.fillRect(0, 148, W, 34);
      ctx.fillStyle = messageColor || colors.warn;
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(message, W / 2, 165);
    }
  }

  function tick(ts) {
    if (!running) return;
    const dt = lastTs === null ? 0.016 : Math.min((ts - lastTs) / 1000, 0.08);
    lastTs = ts;
    particles.forEach((q) => {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vy += 200 * dt;
      q.life -= dt * 1.4;
    });
    particles = particles.filter((q) => q.life > 0);
    draw();
    raf = requestAnimationFrame(tick);
  }

  // ---------- entrada ----------
  function onPointerDown(e) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const x = ((e.clientX - rect.left) * W) / rect.width;
    const y = ((e.clientY - rect.top) * H) / rect.height;
    for (const b of buttons) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        if (b.enabled) b.onClick();
        return;
      }
    }
  }
  function handleKey(e) {
    const k = e.key;
    const map = { 1: 10, 2: 25, 3: 50, 4: 100 };
    if (map[k]) {
      e.preventDefault();
      addBet(map[k]);
    } else if (k === 'Enter') {
      e.preventDefault();
      deal();
    } else if (k === 'Backspace') {
      e.preventDefault();
      clearBet();
    } else if (k === 'r' || k === 'R') {
      e.preventDefault();
      repeatBet();
    } else if (k === 'h' || k === 'H') {
      e.preventDefault();
      hit();
    } else if (k === 's' || k === 'S') {
      e.preventDefault();
      stand();
    } else if (k === 'd' || k === 'D') {
      e.preventDefault();
      doubleDown();
    } else if (k === 'p' || k === 'P') {
      e.preventDefault();
      split();
    }
  }

  function start() {
    stopTimers();
    running = true;
    reset();
    draw();
    notify();
    lastTs = null;
    canvas.addEventListener('pointerdown', onPointerDown);
    listeners.push(['pointerdown', onPointerDown]);
    raf = requestAnimationFrame(tick);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    stopTimers();
    listeners.forEach(([t, fn]) => canvas.removeEventListener(t, fn));
    listeners = [];
  }

  return { start, stop, handleKey, get running() { return running; } };
}
