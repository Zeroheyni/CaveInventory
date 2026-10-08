// Tabuleiro -- HUD ao redor do tabuleiro em tela cheia. A ideia (pedido do
// usuário, 2ª passada): o PLAYER não precisa sair do tabuleiro pra quase
// nada -- vida, estamina, barras, rolar atributo/dado e ver a iniciativa
// ficam todos à mão, de forma intuitiva e fluida:
//
//   - DOCK (embaixo, centro) -- o "painel do personagem": avatar/nome,
//     barras de HP/Estamina/customizadas com botões −5 −1 +1 +5 que
//     REPETEM ao segurar, número editável (digitar "-7" ou "+3" aplica
//     relativo, "25" aplica absoluto), número flutuante de dano/cura,
//     alerta de vida baixa; chips dos 7 atributos (1 clique = d20 + status)
//     e chips de dado (d4..d100) com quantidade/modificador. Tudo
//     atualiza NO LUGAR (sem re-render, senão segurar o botão quebrava) e
//     grava com debounce -- a barra anda na hora, o banco recebe o valor
//     final. Pro mestre (sem personagem) o dock vira só a fileira de dados.
//   - FEED DE ROLAGENS (acima do dock) -- toda rolagem da campanha (a sua
//     e a dos outros) aparece como um cartão com o dado "girando" e o
//     resultado em destaque (crítico dourado, falha crítica vermelha).
//   - RASTREADOR DE INICIATIVA (topo, centro) -- fileira horizontal de
//     retratos na ordem do combate: turno atual em destaque, HP de quem
//     você pode ver, aviso "SEU TURNO!". Passar o mouse num retrato
//     destaca o token no tabuleiro; clicar faz um "ping" nele. O token da
//     vez ganha anel verde pulsando e os tokens ganham mini-barra de HP
//     (ver `decorate`, chamado pelo board.js a cada re-render).
//   - Drawers laterais (como antes): Dados completo (todo mundo) e
//     Combate completo (só mestre) -- embutem as telas inteiras.
//
// Montado UMA VEZ só (não a cada abrir/fechar tabuleiro) -- igual toda aba
// de character.js. Ver o raciocínio completo (z-index, irmão do container
// do board.js) em board.css.
import { supabase } from '../supabaseClient.js';
import { escapeHtml } from '../shared/gameData.js';
import { getCombatState, getParticipants, subscribeCombat, isVisibleToPlayer, updateParticipantHp, updateParticipantStamina, resolveCondition, listCustomConditions, advanceTurn, retreatTurn } from '../combat.js';
import { renderCombatScreen } from './combat.js';
import { renderDiceScreen } from './dice.js';
import { hpMax, estaminaMax, statusStats } from '../characterSheet.js';
import { activeRuleset } from '../systems/index.js';
import { listCharacterCustomBarsFor, customBarMax, updateCharacterCustomBarValue } from '../customBars.js';
import { rollDice, subscribeDiceRolls, DICE_PRESETS, sidesFromDie, getHiddenRollMode, setHiddenRollMode, onHiddenRollMode, revealRoll } from '../dice.js';

const collapsedKey = (name) => 'board-hud-collapsed-' + name;
function getCollapsed(name, defaultValue) {
  try {
    const v = localStorage.getItem(collapsedKey(name));
    return v === null ? defaultValue : v === '1';
  } catch (_) {
    return defaultValue;
  }
}
function setCollapsed(name, value) {
  try {
    localStorage.setItem(collapsedKey(name), value ? '1' : '0');
  } catch (_) {
    // storage bloqueado (aba anônima etc) -- preferência só não persiste
  }
}

// ---- helpers de animação (sem biblioteca: Web Animations API + transição) ----
const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const EASE = 'cubic-bezier(.22,1,.36,1)';

// "morph": anima a LARGURA/ALTURA de um painel enquanto o conteúdo troca
// (recolher/expandir). Mede antes, deixa o `mutate` rearrumar o DOM,
// mede depois, e transiciona de um tamanho pro outro com o conteúdo
// novo já aparecendo por cima (classe .swap no CSS faz o fade-in).
function morph(el, mutate) {
  if (reduceMotion() || el.style.display === 'none') {
    mutate();
    return;
  }
  const before = el.getBoundingClientRect();
  clearTimeout(el._morphT);
  el.style.transition = 'none';
  el.style.width = '';
  el.style.height = '';
  el.style.overflow = '';
  mutate();
  const after = el.getBoundingClientRect();
  if (Math.abs(after.width - before.width) < 1 && Math.abs(after.height - before.height) < 1) return;
  el.style.overflow = 'hidden';
  el.style.width = before.width + 'px';
  el.style.height = before.height + 'px';
  void el.offsetWidth; // aplica o tamanho "antes" sem transição
  el.style.transition = `width .4s ${EASE}, height .4s ${EASE}`;
  el.style.width = after.width + 'px';
  el.style.height = after.height + 'px';
  el._morphT = setTimeout(() => {
    el.style.transition = '';
    el.style.overflow = '';
    el.style.width = '';
    el.style.height = '';
  }, 460);
}

// FLIP: os filhos que já existiam deslizam suavemente pro novo lugar
// quando algo é inserido/removido (usa a propriedade `translate`, que não
// briga com os `transform` que o CSS já usa neles).
function flipChildren(container, mutate) {
  if (reduceMotion()) {
    mutate();
    return;
  }
  const before = new Map(Array.from(container.children).map((c) => [c, c.getBoundingClientRect()]));
  mutate();
  before.forEach((rect, child) => {
    if (!child.isConnected) return;
    const now = child.getBoundingClientRect();
    const dx = rect.left - now.left;
    const dy = rect.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    child.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration: 420, easing: EASE });
  });
}

const pctOf = (cur, max) => (max > 0 ? Math.max(0, Math.min(100, Math.round((cur / max) * 100))) : 0);
function hpTone(pct) {
  if (pct < 20) return 'low';
  if (pct < 50) return 'mid';
  return 'ok';
}
const TONE_COLOR = { low: '#ff5a5a', mid: '#ffb84d', ok: '#4ade80' };
const signed = (n) => (n > 0 ? '+' + n : String(n));

export function renderBoardHud(mountParent, { session, profile, campaign, characterId, characterName, isMaster }) {
  const campaignId = campaign.id;
  const root = document.createElement('div');
  root.className = 'board-hud-root';
  root.style.display = 'none';
  mountParent.appendChild(root);

  let visible = false;

  // estado de combate compartilhado: o rastreador carrega/assina, os
  // tokens (decorate) e o aviso de turno leem daqui
  const combat = { state: { active: false, round: 1 }, participants: [] };

  // ---- feed de rolagens + dock vivem numa coluna só (feed em cima do dock) ----
  const bottom = document.createElement('div');
  bottom.className = 'board-hud-bottom';
  const feedEl = document.createElement('div');
  feedEl.className = 'board-hud-feed';
  const dockEl = document.createElement('div');
  dockEl.className = 'board-dock';
  bottom.appendChild(feedEl);
  bottom.appendChild(dockEl);

  let combatDrawer = null;
  let diceDrawer = null;
  if (isMaster) combatDrawer = mountCombatDrawer(root, { session, profile, campaign, characterId, characterName });
  diceDrawer = mountDiceDrawer(root, { session, profile, campaign });
  root.appendChild(bottom);

  const feed = mountRollFeed(feedEl, { campaignId, isVisible: () => visible, isMaster });
  const tracker = mountTracker(root, { campaignId, profile, characterId, isMaster, combat });
  mountDock(dockEl, {
    campaignId,
    session,
    profile,
    characterId,
    characterName,
    isMaster,
    combat,
    showRoll: feed.show,
    openDice: () => diceDrawer && diceDrawer.open(),
  });

  return {
    // raiz do HUD: o board.js monta o drawer "Cenário" (paredes/luz) aqui dentro
    root,
    setVisible(v) {
      visible = !!v;
      root.style.display = visible ? '' : 'none';
      if (visible) tracker.decorate();
    },
    // chamado pelo board.js a cada re-render do tabuleiro (os tokens são
    // recriados via innerHTML, perdem as classes de turno/HP).
    decorate() {
      tracker.decorate();
    },
  };
}

// ---------------------------------------------------------------
// drawer genérico (Combate/Dados) -- handle fixo na borda, painel
// desliza pra fora. O CONTEÚDO só monta na primeira vez que abre
// (`mountBody`), e fica montado pra sempre depois (mesmo padrão de
// "nunca desmonta" do resto do app) -- fechar só esconde via CSS.
// ---------------------------------------------------------------
export function mountDrawer(root, { side, icon, label, title, mountBody, stack = 0 }) {
  const wrap = document.createElement('div');
  wrap.className = `board-hud-drawer side-${side}${stack ? ' stack-' + stack : ''}`;
  root.appendChild(wrap);

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'board-hud-drawer-handle';
  handle.title = title;
  handle.classList.toggle('icon-only', !label);
  handle.innerHTML = `<span class="hud-handle-icon">${icon}</span>${label ? `<span class="hud-handle-label">${label}</span>` : ''}`;

  const panel = document.createElement('div');
  panel.className = 'board-hud-drawer-panel';
  const body = document.createElement('div');
  body.className = 'board-hud-drawer-body';
  panel.appendChild(body);

  if (side === 'left') {
    wrap.appendChild(handle);
    wrap.appendChild(panel);
  } else {
    wrap.appendChild(panel);
    wrap.appendChild(handle);
  }

  let isOpen = false;
  let mounted = false;
  function set(next) {
    isOpen = next;
    wrap.classList.toggle('open', isOpen);
    handle.title = isOpen ? 'fechar' : title;
    if (isOpen && !mounted) {
      mounted = true;
      mountBody(body);
    }
  }
  handle.addEventListener('click', () => set(!isOpen));
  return { open: () => set(true), close: () => set(false) };
}

function mountCombatDrawer(root, { session, profile, campaign, characterId, characterName }) {
  return mountDrawer(root, {
    side: 'right',
    icon: '⚔',
    label: 'COMBATE',
    title: 'combate',
    mountBody(container) {
      renderCombatScreen(container, { session, profile, campaign, characterId, characterName, topicSuffix: '-board', embedded: true });
    },
  });
}

function mountDiceDrawer(root, { session, profile, campaign }) {
  return mountDrawer(root, {
    side: 'left',
    icon: '🎲',
    label: '', // só o ícone -- a alça fica no alto da lateral, longe do dock
    title: 'histórico e dados avançados',
    mountBody(container) {
      renderDiceScreen(container, { session, profile, campaign, topicSuffix: '-board' });
    },
  });
}

// ---------------------------------------------------------------
// feed de rolagens -- cartões empilhados (máx. 3) com o dado "girando"
// e o resultado em destaque. Mostra a rolagem de QUALQUER um da
// campanha (Realtime) e a própria na hora (dedupe pelo id, já que o
// insert devolve a linha completa antes do evento voltar).
// ---------------------------------------------------------------
function mountRollFeed(feedEl, { campaignId, isVisible, isMaster }) {
  const seen = new Set();
  const toasts = new Map(); // id da rolagem -> cartão na tela (pra marcar como revelada)
  const MAX = 3;

  function breakdown(r) {
    const mod = r.modifier ? ` ${r.modifier > 0 ? '+' : '−'} ${Math.abs(r.modifier)}` : '';
    const dice = r.results.length > 1 ? r.results.join(' + ') : String(r.results[0]);
    return `${r.qty}${r.die} · ${dice}${mod}`;
  }

  // faíscas douradas saindo do dado num crítico
  function sparks(toast) {
    for (let i = 0; i < 12; i++) {
      const s = document.createElement('i');
      s.className = 'spark';
      s.style.setProperty('--a', i * 30 + Math.round(Math.random() * 14) + 'deg');
      s.style.setProperty('--d', 46 + Math.round(Math.random() * 40) + 'px');
      toast.appendChild(s);
      setTimeout(() => s.remove(), 1000);
    }
  }

  function show(r, own) {
    if (!r || seen.has(r.id)) return;
    seen.add(r.id);
    if (seen.size > 80) seen.delete(seen.values().next().value);
    if (!isVisible()) return;

    const sides = sidesFromDie(r.die) || 20;
    const single = r.qty === 1;
    const crit = r.die === 'd20' && single && r.results[0] === 20;
    const fumble = r.die === 'd20' && single && r.results[0] === 1;
    const el = document.createElement('div');
    el.className = 'roll-toast' + (own ? ' own' : '') + (crit ? ' crit' : '') + (fumble ? ' fumble' : '') + (r.die === 'd6' ? ' die-d6' : r.die === 'd4' ? ' die-d4' : '') + (r.hidden ? ' hidden-roll' : '');
    toasts.set(r.id, el);
    el.innerHTML = `
      <div class="roll-die"><b class="roll-num">${Math.max(1, Math.floor(Math.random() * sides))}</b><small>${escapeHtml(r.die)}</small></div>
      <div class="roll-meta">
        <div class="roll-who"><b>${escapeHtml(r.roller_name)}</b>${r.label ? `<span class="roll-label">${escapeHtml(r.label)}</span>` : ''}</div>
        <div class="roll-calc">${escapeHtml(breakdown(r))}</div>
        ${crit ? '<div class="roll-tag crit">CRÍTICO!</div>' : fumble ? '<div class="roll-tag fumble">FALHA CRÍTICA</div>' : ''}
        ${r.hidden && isMaster ? '<div class="roll-tag hid">🙈 só você vê <button type="button" class="roll-reveal">revelar</button></div>' : ''}
      </div>
      <button type="button" class="roll-x" title="fechar">×</button>`;
    flipChildren(feedEl, () => {
      feedEl.appendChild(el);
      while (feedEl.children.length > MAX) feedEl.firstElementChild.remove();
    });

    const numEl = el.querySelector('.roll-num');
    const SPIN_MS = 800; // casa com a duração do 'arremesso' do dado no CSS
    const spin = setInterval(() => {
      numEl.textContent = String(1 + Math.floor(Math.random() * Math.max(sides, 2)));
    }, 55);
    setTimeout(() => {
      clearInterval(spin);
      numEl.textContent = String(r.total);
      el.classList.add('revealed');
      if (crit && !reduceMotion()) sparks(el);
    }, SPIN_MS);

    const remove = () => {
      clearInterval(spin);
      if (!el.isConnected || el.classList.contains('leaving')) return;
      el.classList.add('leaving');
      setTimeout(() => flipChildren(feedEl, () => el.remove()), 260);
    };
    el.querySelector('.roll-x').addEventListener('click', remove);
    const revealBtn = el.querySelector('.roll-reveal');
    if (revealBtn) {
      revealBtn.addEventListener('click', async () => {
        revealBtn.disabled = true;
        try {
          await revealRoll(r.id);
          markRevealed(r.id);
        } catch (err) {
          revealBtn.disabled = false;
          window.alert('Não consegui revelar: ' + err.message);
        }
      });
    }
    setTimeout(() => { remove(); toasts.delete(r.id); }, r.hidden ? 14000 : crit || fumble ? 9000 : 7000);
  }

  // o mestre revelou: o cartão dele perde a tag; os outros ainda não tinham visto essa rolagem (ela nasceu oculta)
  function markRevealed(id) {
    const el = toasts.get(id);
    if (!el) return;
    el.classList.remove('hidden-roll');
    const tag = el.querySelector('.roll-tag.hid');
    if (tag) tag.outerHTML = '<div class="roll-tag shown">revelada ✓</div>';
  }

  subscribeDiceRolls(
    campaignId,
    (payload) => {
      if (!payload || !payload.new) return;
      if (payload.eventType === 'INSERT') show(payload.new, false);
      else if (payload.eventType === 'UPDATE' && payload.old && payload.old.hidden && !payload.new.hidden) {
        markRevealed(payload.new.id);
        show(payload.new, false); // jogadores: aparece agora, com a animação de sempre (o mestre já viu, o dedupe ignora)
      }
    },
    'dice-board-feed-' + campaignId
  );

  return { show: (r) => show(r, true) };
}

// ---------------------------------------------------------------
// rastreador de iniciativa (topo, centro)
// ---------------------------------------------------------------
function mountTracker(root, { campaignId, profile, characterId, isMaster, combat }) {
  const el = document.createElement('div');
  el.className = 'board-hud-tracker';
  el.style.display = 'none'; // aparece só depois do load() confirmar combate ativo -- sem isso pisca uma caixa vazia
  root.appendChild(el);
  const banner = document.createElement('div');
  banner.className = 'board-hud-turn-banner';
  root.appendChild(banner);

  let collapsed = getCollapsed('rastreador', false);
  // posição livre da barra (fração da área do HUD): null = centralizada no topo
  const POS_KEY = 'cave.board.tracker.pos';
  let pos = null;
  try {
    const raw = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (raw && Number.isFinite(raw.fx) && Number.isFinite(raw.fy)) pos = { fx: raw.fx, fy: raw.fy };
  } catch (_) { /* sem storage: fica no centro */ }
  let turnBusy = false;
  function applyPos() {
    if (!pos) {
      el.classList.remove('free');
      el.style.left = '';
      el.style.top = '';
      return;
    }
    const r = root.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (!r.width || !r.height) return;
    const x = Math.max(4, Math.min(r.width - w - 4, pos.fx * r.width));
    const y = Math.max(4, Math.min(r.height - Math.min(h, 60) - 4, pos.fy * r.height));
    el.classList.add('free');
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }
  window.addEventListener('resize', () => applyPos());
  function wireDrag() {
    const grip = el.querySelector('#trk-grip');
    if (!grip) return;
    grip.addEventListener('dblclick', () => {
      pos = null;
      try { localStorage.removeItem(POS_KEY); } catch (_) { /* tanto faz */ }
      applyPos();
    });
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      const rr = root.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      const dx = e.clientX - er.left;
      const dy = e.clientY - er.top;
      grip.setPointerCapture(e.pointerId);
      el.classList.add('free', 'dragging');
      const move = (ev) => {
        const x = Math.max(4, Math.min(rr.width - el.offsetWidth - 4, ev.clientX - rr.left - dx));
        const y = Math.max(4, Math.min(rr.height - 60, ev.clientY - rr.top - dy));
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        pos = { fx: x / rr.width, fy: y / rr.height };
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        el.classList.remove('dragging');
        if (pos) {
          try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (_) { /* sem storage: vale só agora */ }
        }
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
  }
  function focusCurrentToken() {
    const all = combat.participants.slice().sort((a, b) => a.position - b.position);
    const cur = currentTurnOf(all);
    if (cur && cur.character_id) window.dispatchEvent(new CustomEvent('cave:board-focus', { detail: { characterId: cur.character_id } }));
  }
  async function stepTurn(dir) {
    if (turnBusy || !isMaster) return;
    turnBusy = true;
    el.classList.add('busy');
    try {
      if (dir > 0) await advanceTurn(campaignId, combat.participants, combat.state);
      else await retreatTurn(campaignId, combat.participants, combat.state);
      await load();
    } catch (err) {
      window.alert('Não consegui mudar o turno: ' + err.message);
    }
    turnBusy = false;
    el.classList.remove('busy');
  }
  let prevCurrentId; // undefined = ainda não carregou (não anuncia "seu turno" no primeiro load)
  let bannerTimer = null;

  function canSeeHp(p) {
    if (isMaster) return true;
    if (p.character_id === characterId) return true;
    return !!profile.can_see_others_hp;
  }
  function visibleParticipants() {
    if (isMaster) return combat.participants;
    return combat.participants.filter((p) => isVisibleToPlayer(p, profile, characterId, combat.state.round));
  }
  function currentTurnOf(sorted) {
    return combat.state.fixed_initiative ? sorted.find((p) => p.id === combat.state.current_turn_id) || sorted[0] || null : sorted[0] || null;
  }
  function avatarHtml(p) {
    if (p.avatar_url) return `<img class="trk-avatar" src="${escapeHtml(p.avatar_url)}" alt="">`;
    const letter = (p.display_name || '?').trim().charAt(0).toUpperCase();
    return `<span class="trk-avatar trk-avatar-letter">${escapeHtml(letter)}</span>`;
  }

  // ícones pequenos das condições do participante (só o ícone; o texto completo vai no title)
  function condChipsHtml(p) {
    const conds = Array.isArray(p.conditions) ? p.conditions : [];
    if (!conds.length) return '';
    const shown = conds.slice(0, 3);
    const extra = conds.length - shown.length;
    const chips = shown
      .map((c) => {
        const meta = resolveCondition(c.tipo, customConditions);
        return '<i class="trk-cond" style="--c:' + escapeHtml(meta.color) + ';" title="' + escapeHtml(condLabel(c, meta)) + '">' + escapeHtml(meta.icon) + '</i>';
      })
      .join('');
    return '<span class="trk-conds">' + chips + (extra > 0 ? '<i class="trk-cond more">+' + extra + '</i>' : '') + '</span>';
  }

  let prevRound;
  let leaveTimer = null;

  // foto do estado visual ANTES de re-renderizar: posição de cada cartão
  // (pra animar a troca de ordem), largura da barra de HP (pra animar o
  // dano/cura) e a rolagem da fileira.
  function snapshot() {
    const rects = new Map();
    const hp = new Map();
    el.querySelectorAll('.trk-card').forEach((c) => {
      rects.set(c.dataset.pid, c.getBoundingClientRect());
      const fill = c.querySelector('.trk-hp-fill');
      hp.set(c.dataset.pid, fill ? fill.style.width : null);
    });
    const listEl = el.querySelector('#trk-list');
    return { rects, hp, scroll: listEl ? listEl.scrollLeft : undefined };
  }

  function render({ noFlip = false } = {}) {
    if (!combat.state.active) {
      prevCurrentId = undefined;
      prevRound = undefined;
      if (el.style.display === 'none' || el.classList.contains('leaving')) return;
      if (reduceMotion()) {
        el.style.display = 'none';
        el.innerHTML = '';
        return;
      }
      // saída suave quando o combate termina
      el.classList.add('leaving');
      clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => {
        el.style.display = 'none';
        el.innerHTML = '';
        el.classList.remove('leaving');
      }, 300);
      return;
    }
    clearTimeout(leaveTimer);
    const snap = el.style.display === 'none' || noFlip ? null : snapshot();
    el.style.display = '';
    const allSorted = combat.participants.slice().sort((a, b) => a.position - b.position);
    const current = currentTurnOf(allSorted);
    const rankMap = new Map(allSorted.map((p, i) => [p.id, i + 1]));
    const list = visibleParticipants().slice().sort((a, b) => a.position - b.position);
    const currentVisible = current && list.some((p) => p.id === current.id);
    el.className = 'board-hud-tracker' + (collapsed ? ' collapsed' : '') + (pos ? ' free' : '');

    el.innerHTML = `
      <span class="trk-grip" id="trk-grip" title="arraste pra mover a barra · duplo clique volta pro centro">⠿</span>
      <button type="button" class="trk-round" id="trk-toggle" title="${collapsed ? 'expandir iniciativa' : 'recolher iniciativa'}">
        <span class="trk-round-icon">⚔</span>
        <span class="trk-round-num">RODADA <b>${combat.state.round}</b></span>
        ${collapsed ? `<span class="trk-round-now">${currentVisible ? escapeHtml(current.display_name) : '…'}</span>` : ''}
        <span class="trk-round-caret">${collapsed ? '▸' : '▾'}</span>
      </button>
      ${
        collapsed
          ? ''
          : `<div class="trk-list" id="trk-list">
          ${
            list.length === 0
              ? '<div class="trk-empty">ninguém na iniciativa</div>'
              : list
                  .map((p) => {
                    const isCurrent = current && p.id === current.id;
                    const isMe = !!characterId && p.character_id === characterId;
                    const showHp = canSeeHp(p);
                    const pct = pctOf(p.hp_current, p.hp_max);
                    return `
              <button type="button" class="trk-card team-${escapeHtml(p.team)} ${isCurrent ? 'current' : ''} ${isMe ? 'me' : ''}" data-pid="${p.id}" data-cid="${p.character_id || ''}" title="${escapeHtml(p.display_name)}${isMe ? ' (você)' : ''}${showHp ? ` — ${p.hp_current}/${p.hp_max} HP` : ''}">
                ${isCurrent ? '<span class="trk-now">TURNO</span>' : ''}
                <span class="trk-rank">${rankMap.get(p.id)}º</span>
                ${avatarHtml(p)}
                <span class="trk-name">${escapeHtml(p.display_name)}</span>
                ${p.initiative !== null && p.initiative !== undefined ? '<span class="trk-init" title="iniciativa">' + escapeHtml(String(p.initiative)) + '</span>' : ''}
                ${condChipsHtml(p)}
                ${showHp ? `<span class="trk-hp"><span class="trk-hp-fill tone-${hpTone(pct)}" style="width:${pct}%"></span></span>` : ''}
                ${isMe ? '<span class="trk-me-tag">você</span>' : ''}
              </button>`;
                  })
                  .join('')
          }
        </div>`
      }
      <div class="trk-ctl">
        <button type="button" class="trk-ctl-btn" id="trk-focus" title="centralizar o tabuleiro em quem tem a vez">🎯</button>
        ${
          isMaster
            ? '<button type="button" class="trk-ctl-btn" id="trk-prev" title="voltar o turno">⏮</button><button type="button" class="trk-ctl-btn trk-next" id="trk-next" title="passar o turno">⏭</button>'
            : ''
        }
      </div>
    `;
    wireDrag();
    applyPos();
    el.querySelector('#trk-focus').addEventListener('click', focusCurrentToken);
    const nextBtn = el.querySelector('#trk-next');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => stepTurn(1));
      el.querySelector('#trk-prev').addEventListener('click', () => stepTurn(-1));
    }

    el.querySelector('#trk-toggle').addEventListener('click', () => {
      morph(el, () => {
        collapsed = !collapsed;
        setCollapsed('rastreador', collapsed);
        render({ noFlip: true });
        el.classList.add('swap');
      });
    });
    el.querySelectorAll('.trk-card').forEach((card) => {
      card.addEventListener('mouseenter', () => tokenFor(card.dataset.cid)?.classList.add('hud-hl'));
      card.addEventListener('mouseleave', () => tokenFor(card.dataset.cid)?.classList.remove('hud-hl'));
      card.addEventListener('click', () => {
        ping(card.dataset.cid);
        if (card.dataset.cid) window.dispatchEvent(new CustomEvent('cave:board-focus', { detail: { characterId: card.dataset.cid } }));
      });
    });

    const currentId = current ? current.id : null;
    const turnChanged = prevCurrentId !== undefined && currentId !== prevCurrentId;
    const animate = !reduceMotion();

    // fileira: mantém a rolagem de antes e desliza suave até o turno atual
    const listEl = el.querySelector('#trk-list');
    const curCard = el.querySelector('.trk-card.current');
    if (listEl) {
      const target = curCard ? curCard.offsetLeft - listEl.clientWidth / 2 + curCard.clientWidth / 2 : 0;
      listEl.style.scrollBehavior = 'auto';
      if (snap && snap.scroll !== undefined && animate) {
        listEl.scrollLeft = snap.scroll;
        void listEl.offsetWidth;
        listEl.style.scrollBehavior = '';
        if (Math.abs(target - snap.scroll) > 2) listEl.scrollTo({ left: target, behavior: 'smooth' });
      } else {
        listEl.scrollLeft = target;
        listEl.style.scrollBehavior = '';
      }
    }

    if (animate) {
      if (snap) {
        el.querySelectorAll('.trk-card').forEach((card) => {
          const pid = card.dataset.pid;
          const was = snap.rects.get(pid);
          const now = card.getBoundingClientRect();
          if (was) {
            const dx = was.left - now.left;
            const dy = was.top - now.top;
            // cartão trocou de lugar na ordem: desliza do lugar antigo pro novo
            if (Math.abs(dx) > 1 || Math.abs(dy) > 1) card.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration: 560, easing: EASE });
          } else if (snap.rects.size) {
            card.animate([{ opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1 }], { duration: 400, easing: EASE });
          }
          // dano/cura: a barra anda do valor antigo pro novo (o elemento é
          // novo, então a transição de CSS precisa de um ponto de partida)
          const fill = card.querySelector('.trk-hp-fill');
          const prevW = snap.hp.get(pid);
          if (fill && prevW && prevW !== fill.style.width) {
            const to = fill.style.width;
            fill.style.width = prevW;
            void fill.offsetWidth;
            fill.style.width = to;
          }
        });
      }
      if (turnChanged) {
        el.querySelectorAll('.trk-card').forEach((card) => {
          const pid = card.dataset.pid;
          if (pid === currentId) {
            // passa o bastão: quem ganhou a vez cresce com um estouro de anel
            card.animate([{ scale: 0.85 }, { scale: 1.1, offset: 0.55 }, { scale: 1 }], { duration: 620, easing: EASE });
            const tag = card.querySelector('.trk-now');
            if (tag) tag.animate([{ scale: 0, opacity: 0 }, { scale: 1.2, opacity: 1, offset: 0.6 }, { scale: 1, opacity: 1 }], { duration: 520, easing: EASE });
            const av = card.querySelector('.trk-avatar');
            if (av) av.animate([{ boxShadow: '0 0 0 0 rgba(74,222,128,0.95)' }, { boxShadow: '0 0 0 22px rgba(74,222,128,0)' }], { duration: 800, easing: 'ease-out' });
          } else if (pid === prevCurrentId) {
            card.animate([{ scale: 1.12 }, { scale: 1 }], { duration: 420, easing: EASE });
          }
        });
      }
      if (prevRound !== undefined && prevRound !== combat.state.round) {
        const num = el.querySelector('.trk-round-num b');
        if (num) num.animate([{ scale: 2.4, color: '#ffffff' }, { scale: 1 }], { duration: 700, easing: EASE });
      }
    }
    prevRound = combat.state.round;

    // "SEU TURNO!" -- só quando a vez MUDA pra mim (não a cada reload)
    if (turnChanged && current && characterId && current.character_id === characterId) {
      showBanner();
    }
    prevCurrentId = currentId;
  }

  function showBanner() {
    banner.innerHTML = '<div class="turn-banner-inner"><span>⚔</span> SEU TURNO!</div>';
    banner.classList.remove('show');
    void banner.offsetWidth; // reinicia a animação se vier duas vezes seguidas
    banner.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => banner.classList.remove('show'), 2600);
  }

  // ---- ligação com os tokens do board.js (sem acoplar os módulos: acha
  // pelo data-character-id que o tokenHtml agora escreve) ----
  function tokenFor(cid) {
    if (!cid) return null;
    return Array.from(document.querySelectorAll('.board-token[data-character-id]')).find((n) => n.dataset.characterId === cid) || null;
  }
  function ping(cid) {
    const t = tokenFor(cid);
    if (!t) return;
    t.classList.remove('hud-ping');
    void t.offsetWidth;
    t.classList.add('hud-ping');
    setTimeout(() => t.classList.remove('hud-ping'), 1500);
  }
  // ---- condições no token (db/031, db/037): fichas redondas de vidro com o ícone e a cor da condição, flutuando em cima
  // do token. Vivem numa camada própria do palco (o token tem overflow:hidden e cortaria); um MutationObserver nos
  // tokens mantém cada fileira grudada no token (arrasto, redimensionar) e some junto quando a luz esconde o token. ----
  let customConditions = [];
  const MAX_CHIPS = 3;
  function condLeft(c) {
    if (c.round_expira === null || c.round_expira === undefined) return null;
    return c.round_expira - (combat.state.round || 1);
  }
  function condLabel(c, meta) {
    const left = condLeft(c);
    return meta.label + (left === null ? ' — até o mestre remover' : left > 0 ? ` — ${left} rodada${left === 1 ? '' : 's'}` : ' — acabando');
  }
  function syncCondWrap(wrap, tokenEl) {
    wrap.style.left = tokenEl.style.left;
    wrap.style.top = tokenEl.style.top;
    wrap.style.width = tokenEl.style.width;
    wrap.hidden = tokenEl.dataset.unseen === '1';
  }
  let condObserver = null;
  function decorateConditions() {
    const stage = document.getElementById('board-stage');
    if (!stage) return;
    let layer = stage.querySelector('.board-cond-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'board-cond-layer';
      stage.appendChild(layer);
    }
    if (condObserver) condObserver.disconnect();
    layer.innerHTML = '';
    const visible = visibleParticipants();
    const pairs = [];
    document.querySelectorAll('.board-token[data-character-id]').forEach((tokenEl) => {
      const p = visible.find((x) => x.character_id === tokenEl.dataset.characterId);
      const conds = p && Array.isArray(p.conditions) ? p.conditions : [];
      if (!conds.length) return;
      const shown = conds.slice(0, MAX_CHIPS);
      const extra = conds.length - shown.length;
      const chips = shown
        .map((c, i) => {
          const meta = resolveCondition(c.tipo, customConditions);
          const left = condLeft(c);
          const badge = left === null ? '' : `<i class="cn">${left > 0 ? left : '!'}</i>`;
          return `<span class="board-cond-chip" style="--c:${escapeHtml(meta.color)}; --i:${i};" title="${escapeHtml(condLabel(c, meta))}"><span class="ci">${escapeHtml(meta.icon)}</span>${badge}</span>`;
        })
        .join('');
      const more = extra > 0 ? `<span class="board-cond-more" title="${extra} condição(ões) a mais">+${extra}</span>` : '';
      const wrap = document.createElement('div');
      wrap.className = 'board-cond-wrap';
      wrap.innerHTML = `<div class="board-cond-row">${chips}${more}</div>`;
      layer.appendChild(wrap);
      syncCondWrap(wrap, tokenEl);
      pairs.push([wrap, tokenEl]);
    });
    if (pairs.length && typeof MutationObserver !== 'undefined') {
      condObserver = new MutationObserver((muts) => {
        const touched = new Set(muts.map((m) => m.target));
        pairs.forEach(([wrap, tokenEl]) => {
          if (touched.has(tokenEl)) syncCondWrap(wrap, tokenEl);
        });
      });
      pairs.forEach(([, tokenEl]) => condObserver.observe(tokenEl, { attributes: true, attributeFilter: ['style', 'data-unseen'] }));
    }
  }

  const deco = { current: undefined };
  function decorate() {
    decorateConditions();
    const active = combat.state.active;
    const allSorted = active ? combat.participants.slice().sort((a, b) => a.position - b.position) : [];
    const current = active ? currentTurnOf(allSorted) : null;
    // a vez mudou desde a última vez que olhei? (undefined = primeira leitura, não anima)
    const curId = current ? current.id : null;
    const arrive = active && deco.current !== undefined && deco.current !== curId;
    deco.current = active ? curId : undefined;
    const tokens = document.querySelectorAll('.board-token[data-character-id]');
    if (!tokens.length) return;
    const visible = active ? visibleParticipants() : [];
    tokens.forEach((t) => {
      const p = visible.find((x) => x.character_id === t.dataset.characterId);
      const isTurn = !!(p && current && p.id === current.id);
      t.classList.toggle('turn-active', isTurn);
      if (isTurn && arrive && !reduceMotion()) {
        t.classList.remove('turn-arrive');
        void t.offsetWidth;
        t.classList.add('turn-arrive');
        setTimeout(() => t.classList.remove('turn-arrive'), 1100);
      }
      if (p && canSeeHp(p)) {
        const pct = pctOf(p.hp_current, p.hp_max);
        t.classList.add('has-hp');
        t.style.setProperty('--hp', pct + '%');
        t.style.setProperty('--hp-color', TONE_COLOR[hpTone(pct)]);
      } else {
        t.classList.remove('has-hp');
        t.style.removeProperty('--hp');
        t.style.removeProperty('--hp-color');
      }
    });
  }

  let reloadTimer = null;
  async function load() {
    try {
      const [cs, ps] = await Promise.all([getCombatState(campaignId), getParticipants(campaignId)]);
      combat.state = cs;
      combat.participants = ps;
      try {
        customConditions = await listCustomConditions(campaignId);
      } catch (_) {
        customConditions = []; // sem as customizadas, mostra só o catálogo
      }
    } catch (_) {
      // painel compacto -- se falhar, só fica com o último estado conhecido
    }
    render();
    decorate();
  }

  subscribeCombat(
    campaignId,
    () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(load, 500);
    },
    'combat-board-hud-' + campaignId
  );
  load();

  return { decorate };
}

// ---------------------------------------------------------------
// dock do personagem (embaixo, centro)
// ---------------------------------------------------------------
function mountDock(el, { campaignId, session, profile, characterId, characterName, isMaster, combat, showRoll, openDice }) {
  const hasChar = !isMaster && !!characterId;
  let collapsed = getCollapsed('dock', window.innerWidth <= 760); // celular: começa recolhido (a barra de HP continua à vista)
  let char = null;
  let customBars = [];

  // dados rápidos: quantidade/modificador aplicam nos chips de dado
  let diceQty = 1;
  let diceMod = 0;
  let rolling = false;

  // gravação com debounce (a barra anda na hora, o banco recebe o valor final)
  const saveTimers = new Map();
  let inflight = 0;

  const rollerName = () => (hasChar ? characterName || (char && char.name) || profile.username : profile.username) || 'jogador';

  // ------------------------------------------------ valores
  function vitalInfo(kind) {
    if (!char) return { cur: 0, max: 0 };
    if (kind === 'hp') return { cur: char.hp_current, max: hpMax(char) };
    if (kind === 'estamina') return { cur: char.estamina_current, max: estaminaMax(char) };
    const cb = customBars.find((c) => c.id === kind);
    return cb ? { cur: cb.current_value, max: customBarMax(cb.bar, char) } : { cur: 0, max: 0 };
  }
  function setLocal(kind, next) {
    if (kind === 'hp') char.hp_current = next;
    else if (kind === 'estamina') char.estamina_current = next;
    else {
      const cb = customBars.find((c) => c.id === kind);
      if (cb) cb.current_value = next;
    }
  }
  function vitalsList() {
    const list = [{ kind: 'hp', label: '❤ HP', color: null }];
    if (estaminaMax(char) > 0) list.push({ kind: 'estamina', label: '⚡ EST', color: '#ffd93d' });
    customBars.forEach((cb) => list.push({ kind: cb.id, label: cb.bar.name, color: cb.bar.color }));
    return list;
  }

  // ------------------------------------------------ aplicar +/- (otimista, in-place)
  const floatState = new Map(); // kind -> { sum, timer }
  function changeVital(kind, delta, absolute) {
    const { cur, max } = vitalInfo(kind);
    const next = Math.max(0, Math.min(max, absolute !== undefined ? absolute : cur + delta));
    if (next === cur) return;
    setLocal(kind, next);
    updateVitalUi(kind);
    flashFloat(kind, next - cur);
    scheduleSave(kind);
  }

  function flashFloat(kind, diff) {
    const block = el.querySelector(`.dock-vital[data-kind="${CSS.escape(kind)}"]`);
    const fl = block && block.querySelector('.dock-float');
    if (!fl) return;
    const st = floatState.get(kind) || { sum: 0, timer: null };
    st.sum += diff; // soma gestos seguidos (segurar +1 vira "+7", não 7 números piscando)
    clearTimeout(st.timer);
    st.timer = setTimeout(() => floatState.delete(kind), 700);
    floatState.set(kind, st);
    fl.textContent = st.sum > 0 ? '+' + st.sum : st.sum < 0 ? '−' + Math.abs(st.sum) : '';
    fl.className = 'dock-float ' + (st.sum > 0 ? 'heal' : 'dmg');
    void fl.offsetWidth;
    fl.classList.add('pop');
    const bar = block.querySelector('.dock-bar');
    bar.classList.remove('flash-dmg', 'flash-heal');
    void bar.offsetWidth;
    bar.classList.add(diff < 0 ? 'flash-dmg' : 'flash-heal');
  }

  function updateVitalUi(kind) {
    const { cur, max } = vitalInfo(kind);
    const block = el.querySelector(`.dock-vital[data-kind="${CSS.escape(kind)}"]`);
    if (block) {
      const pct = pctOf(cur, max);
      const fill = block.querySelector('.dock-bar-fill');
      fill.style.width = pct + '%';
      if (kind === 'hp') fill.dataset.tone = hpTone(pct);
      const input = block.querySelector('.dock-vital-input');
      if (input && document.activeElement !== input) input.value = cur;
      const maxEl = block.querySelector('.dock-vital-max');
      if (maxEl) maxEl.textContent = '/' + max;
    }
    if (kind === 'hp') {
      const pct = pctOf(cur, max);
      el.classList.toggle('low', pct < 25 && max > 0);
      const mini = el.querySelector('.dock-mini-fill');
      if (mini) {
        mini.style.width = pct + '%';
        mini.dataset.tone = hpTone(pct);
      }
      const miniTxt = el.querySelector('.dock-mini-txt');
      if (miniTxt) miniTxt.textContent = `${cur}/${max}`;
    }
  }

  function scheduleSave(kind) {
    clearTimeout(saveTimers.get(kind));
    saveTimers.set(
      kind,
      setTimeout(() => {
        saveTimers.delete(kind);
        saveVital(kind);
      }, 350)
    );
  }

  // HP/Estamina passam por updateParticipantHp/Stamina (combat.js) SE o
  // personagem tiver um participante de combate agora (grava characters
  // E combat_participants juntos -- sem isso o combate ficava com valor
  // desatualizado); sem combate, grava direto em `characters` (RLS: dono
  // edita a própria linha). Barra customizada grava direto.
  async function saveVital(kind) {
    const { cur } = vitalInfo(kind);
    inflight++;
    try {
      if (kind === 'hp' || kind === 'estamina') {
        const { data: participant } = await supabase
          .from('combat_participants')
          .select('id')
          .eq('campaign_id', campaignId)
          .eq('character_id', characterId)
          .maybeSingle();
        if (participant) {
          if (kind === 'hp') await updateParticipantHp(participant.id, cur, characterId);
          else await updateParticipantStamina(participant.id, cur, characterId);
        } else {
          const field = kind === 'hp' ? 'hp_current' : 'estamina_current';
          const { error } = await supabase.from('characters').update({ [field]: cur }).eq('id', characterId);
          if (error) throw error;
        }
      } else {
        await updateCharacterCustomBarValue(kind, cur);
      }
    } catch (_) {
      // se falhar, o próximo load() (realtime) corrige sozinho -- a barra não trava
    }
    inflight--;
  }

  // ------------------------------------------------ rolar
  async function doRoll(btn, { die, qty, mod, label }) {
    if (rolling) return;
    rolling = true;
    btn.classList.add('rolling');
    try {
      const row = await rollDice(campaignId, session.user.id, rollerName(), die, qty, mod, label);
      showRoll(row);
    } catch (err) {
      window.alert('Erro ao rolar: ' + err.message);
    }
    btn.classList.remove('rolling');
    rolling = false;
  }

  // ------------------------------------------------ render (estrutura)
  function vitalHtml(v) {
    const { cur, max } = vitalInfo(v.kind);
    const pct = pctOf(cur, max);
    const big = max >= 20;
    const steps = (big ? [-5, -1, 1, 5] : [-1, 1])
      .map((d) => `<button type="button" class="dock-step ${d < 0 ? 'minus' : 'plus'}" data-delta="${d}" tabindex="-1">${d < 0 ? '−' : '+'}${Math.abs(d)}</button>`)
      .join('');
    const fillStyle = v.color ? `background:${escapeHtml(v.color)};` : '';
    return `
      <div class="dock-vital" data-kind="${escapeHtml(v.kind)}">
        <div class="dock-vital-top">
          <span class="dock-vital-label" ${v.color ? `style="color:${escapeHtml(v.color)};"` : ''}>${escapeHtml(v.label)}</span>
          <span class="dock-vital-val"><input type="text" inputmode="numeric" class="dock-vital-input" value="${cur}" title="digite um valor, ou +N / −N pra somar/tirar" aria-label="${escapeHtml(v.label)}"><span class="dock-vital-max">/${max}</span></span>
        </div>
        <div class="dock-bar"><div class="dock-bar-fill" ${v.kind === 'hp' ? `data-tone="${hpTone(pct)}"` : ''} style="width:${pct}%; ${fillStyle}"></div><span class="dock-float"></span></div>
        <div class="dock-steps">${steps}</div>
      </div>`;
  }

  function render() {
    el.className = 'board-dock' + (collapsed ? ' collapsed' : '') + (!hasChar ? ' no-char' : '');
    const diceHtml = `
      <div class="dock-group dock-dice">
        <span class="dock-group-label">DADOS</span>
        <div class="dock-chips">
          <label class="dock-mini-field" title="quantidade de dados">×<input type="number" id="dock-qty" min="1" max="10" value="${diceQty}"></label>
          <label class="dock-mini-field" title="modificador">±<input type="number" id="dock-mod" value="${diceMod}"></label>
          ${DICE_PRESETS.map((d) => `<button type="button" class="dock-chip dock-die" data-die="${d}" title="rolar ${d}">${d}</button>`).join('')}
          ${isMaster ? '<button type="button" class="dock-chip dock-hidden ' + (getHiddenRollMode() ? 'on' : '') + '" id="dock-hidden" title="rolagem oculta: ' + (getHiddenRollMode() ? 'LIGADA — só você vê o que rola (clique pra desligar)' : 'desligada — clique pra rolar só pra você') + '">🙈</button>' : ''}
          <button type="button" class="dock-chip dock-more" id="dock-more" title="histórico e dado personalizado">⋯</button>
        </div>
      </div>`;

    if (!hasChar) {
      // mestre: só os dados (ele gerencia o resto pelo drawer de Combate)
      el.innerHTML = collapsed
        ? `<button type="button" class="dock-expand-solo" id="dock-collapse" title="mostrar dados">🎲</button>`
        : `<div class="dock-actions">${diceHtml}<button type="button" class="dock-collapse" id="dock-collapse" title="recolher">▾</button></div>`;
      wire();
      return;
    }
    if (!char) {
      el.innerHTML = '';
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    const hMax = hpMax(char);
    const hPct = pctOf(char.hp_current, hMax);
    el.classList.toggle('low', hPct < 25 && hMax > 0);

    const avatar = char.avatar_url
      ? `<img class="dock-avatar" src="${escapeHtml(char.avatar_url)}" alt="">`
      : `<span class="dock-avatar dock-avatar-letter">${escapeHtml((char.name || '?').charAt(0).toUpperCase())}</span>`;

    if (collapsed) {
      el.innerHTML = `
        <div class="dock-mini">
          ${avatar}
          <div class="dock-mini-main">
            <b>${escapeHtml(char.name)}</b>
            <div class="dock-mini-bar"><div class="dock-mini-fill" data-tone="${hpTone(hPct)}" style="width:${hPct}%"></div></div>
          </div>
          <span class="dock-mini-txt">${char.hp_current}/${hMax}</span>
          <button type="button" class="dock-collapse" id="dock-collapse" title="expandir">▴</button>
        </div>`;
      wire();
      return;
    }

    el.innerHTML = `
      <div class="dock-top">
        <div class="dock-id">${avatar}<div class="dock-id-txt"><b>${escapeHtml(char.name)}</b><small>Nv ${char.level || 1}</small></div></div>
        <div class="dock-vitals">${vitalsList().map(vitalHtml).join('')}</div>
        <button type="button" class="dock-collapse" id="dock-collapse" title="recolher">▾</button>
      </div>
      <div class="dock-actions">
        <div class="dock-group dock-attrs">
          <span class="dock-group-label">ATRIBUTOS</span>
          <div class="dock-chips">
            ${statusStats().map((s) => {
              const val = char[s.key] || 0;
              return `<button type="button" class="dock-chip dock-stat" data-stat="${s.key}" style="--c:${s.color};" title="${escapeHtml(s.label)} — rolar ${activeRuleset().attributeTestDie} ${signed(val)}"><span class="dock-stat-ico">${s.icon}</span><b>${s.abbr}</b><i>${val}</i></button>`;
            }).join('')}
          </div>
        </div>
        ${diceHtml}
      </div>`;
    wire();
  }

  // ------------------------------------------------ eventos
  function bindHold(btn, fn) {
    let t1 = null;
    let t2 = null;
    const stop = () => {
      clearTimeout(t1);
      clearInterval(t2);
      t1 = t2 = null;
    };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      fn();
      t1 = setTimeout(() => {
        t2 = setInterval(fn, 85);
      }, 420);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
    btn.addEventListener('click', (e) => {
      if (e.detail === 0) fn(); // ativação por teclado (Enter/Espaço)
    });
  }

  // o 🙈 também liga/desliga em outros lugares (aba Dados, bandeja do combate): mantém o chip daqui igual
  if (isMaster) {
    onHiddenRollMode((on) => {
      const b = el.querySelector('#dock-hidden');
      if (!b) return;
      b.classList.toggle('on', on);
      b.title = on ? 'rolagem oculta: LIGADA — só você vê o que rola (clique pra desligar)' : 'rolagem oculta: desligada — clique pra rolar só pra você';
    });
  }

  function wire() {
    const col = el.querySelector('#dock-collapse');
    if (col) {
      col.addEventListener('click', () => {
        morph(el, () => {
          collapsed = !collapsed;
          setCollapsed('dock', collapsed);
          render();
          el.classList.add('swap'); // conteúdo novo entra com fade (CSS)
        });
      });
    }

    el.querySelectorAll('.dock-vital').forEach((block) => {
      const kind = block.dataset.kind;
      block.querySelectorAll('.dock-step').forEach((btn) => bindHold(btn, () => changeVital(kind, Number(btn.dataset.delta))));
      const input = block.querySelector('.dock-vital-input');
      const commit = () => {
        const raw = input.value.trim().replace('−', '-');
        if (/^[+-]\d+$/.test(raw)) changeVital(kind, parseInt(raw, 10)); // relativo
        else if (/^\d+$/.test(raw)) changeVital(kind, 0, parseInt(raw, 10)); // absoluto
        input.value = vitalInfo(kind).cur;
      };
      input.addEventListener('focus', () => input.select());
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        else if (e.key === 'Escape') {
          input.value = vitalInfo(kind).cur;
          input.blur();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          changeVital(kind, e.key === 'ArrowUp' ? 1 : -1);
        }
      });
    });

    el.querySelectorAll('.dock-stat').forEach((btn) => {
      btn.addEventListener('click', () => {
        const s = statusStats().find((x) => x.key === btn.dataset.stat);
        if (!s || !char) return;
        doRoll(btn, { die: activeRuleset().attributeTestDie, qty: 1, mod: char[s.key] || 0, label: s.label });
      });
    });
    el.querySelectorAll('.dock-die').forEach((btn) => {
      btn.addEventListener('click', () => doRoll(btn, { die: btn.dataset.die, qty: diceQty, mod: diceMod, label: null }));
    });
    const qty = el.querySelector('#dock-qty');
    if (qty) qty.addEventListener('change', () => (diceQty = Math.min(10, Math.max(1, parseInt(qty.value, 10) || 1))) && (qty.value = diceQty));
    const mod = el.querySelector('#dock-mod');
    if (mod) mod.addEventListener('change', () => (diceMod = parseInt(mod.value, 10) || 0));
    const more = el.querySelector('#dock-more');
    if (more) more.addEventListener('click', openDice);
    const hid = el.querySelector('#dock-hidden');
    if (hid) hid.addEventListener('click', () => setHiddenRollMode(!getHiddenRollMode()));
  }

  // ------------------------------------------------ carga + realtime
  let reloadTimer = null;
  async function load() {
    if (!hasChar) {
      render();
      return;
    }
    // não sobrescreve um valor que ainda estou digitando/gravando -- tenta de novo logo depois
    if (saveTimers.size || inflight) {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(load, 600);
      return;
    }
    try {
      const [{ data: charRow }, bars] = await Promise.all([
        supabase
          .from('characters')
          .select('name, avatar_url, level, hp_current, estamina_current, hp_max_override, estamina_max_override, vitalidade, forca, agilidade, destreza, inteligencia, estamina, observacao')
          .eq('id', characterId)
          .maybeSingle(),
        listCharacterCustomBarsFor(characterId),
      ]);
      if (charRow) char = charRow;
      customBars = bars || [];
    } catch (_) {
      // dock é "glance" -- se falhar, fica com o último estado conhecido
    }
    // mesma estrutura de antes (mesmas barras, não recolhido)? atualiza SÓ os
    // números no lugar -- as barras deslizam do valor antigo pro novo em vez
    // de o dock inteiro ser recriado (e some o foco/digitação em andamento).
    if (char && !collapsed && el.querySelector('.dock-vital')) {
      const list = vitalsList();
      const domKinds = Array.from(el.querySelectorAll('.dock-vital')).map((n) => n.dataset.kind).join('|');
      if (domKinds === list.map((v) => v.kind).join('|')) {
        list.forEach((v) => updateVitalUi(v.kind));
        el.querySelectorAll('.dock-stat').forEach((chip) => {
          const i = chip.querySelector('i');
          if (i) i.textContent = char[chip.dataset.stat] || 0;
        });
        const idTxt = el.querySelector('.dock-id-txt small');
        if (idTxt) idTxt.textContent = 'Nv ' + (char.level || 1);
        return;
      }
    }
    render();
  }

  if (hasChar) {
    supabase
      .channel('board-dock-' + characterId)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'characters', filter: `id=eq.${characterId}` }, () => {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(load, 400);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'character_custom_bars', filter: `character_id=eq.${characterId}` }, () => {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(load, 400);
      })
      .subscribe();
  }
  load();
}
