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
import { getCombatState, getParticipants, subscribeCombat, isVisibleToPlayer, updateParticipantHp, updateParticipantStamina } from '../combat.js';
import { renderCombatScreen } from './combat.js';
import { renderDiceScreen } from './dice.js';
import { hpMax, estaminaMax, STATUS_STATS } from '../characterSheet.js';
import { listCharacterCustomBarsFor, customBarMax, updateCharacterCustomBarValue } from '../customBars.js';
import { rollDice, subscribeDiceRolls, DICE_PRESETS, sidesFromDie } from '../dice.js';

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

const STAT_ABBR = { vitalidade: 'VIT', forca: 'FOR', agilidade: 'AGI', destreza: 'DES', inteligencia: 'INT', estamina: 'EST', observacao: 'OBS' };
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

  const feed = mountRollFeed(feedEl, { campaignId, isVisible: () => visible });
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
function mountDrawer(root, { side, icon, label, title, mountBody }) {
  const wrap = document.createElement('div');
  wrap.className = `board-hud-drawer side-${side}`;
  root.appendChild(wrap);

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'board-hud-drawer-handle';
  handle.title = title;
  handle.innerHTML = `<span class="hud-handle-icon">${icon}</span><span class="hud-handle-label">${label}</span>`;

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
    label: 'DADOS',
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
function mountRollFeed(feedEl, { campaignId, isVisible }) {
  const seen = new Set();
  const MAX = 3;

  function breakdown(r) {
    const mod = r.modifier ? ` ${r.modifier > 0 ? '+' : '−'} ${Math.abs(r.modifier)}` : '';
    const dice = r.results.length > 1 ? r.results.join(' + ') : String(r.results[0]);
    return `${r.qty}${r.die} · ${dice}${mod}`;
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
    el.className = 'roll-toast' + (own ? ' own' : '') + (crit ? ' crit' : '') + (fumble ? ' fumble' : '') + (r.die === 'd6' ? ' die-d6' : r.die === 'd4' ? ' die-d4' : '');
    el.innerHTML = `
      <div class="roll-die"><b class="roll-num">${Math.max(1, Math.floor(Math.random() * sides))}</b><small>${escapeHtml(r.die)}</small></div>
      <div class="roll-meta">
        <div class="roll-who"><b>${escapeHtml(r.roller_name)}</b>${r.label ? `<span class="roll-label">${escapeHtml(r.label)}</span>` : ''}</div>
        <div class="roll-calc">${escapeHtml(breakdown(r))}</div>
        ${crit ? '<div class="roll-tag crit">CRÍTICO!</div>' : fumble ? '<div class="roll-tag fumble">FALHA CRÍTICA</div>' : ''}
      </div>
      <button type="button" class="roll-x" title="fechar">×</button>`;
    feedEl.appendChild(el);
    while (feedEl.children.length > MAX) feedEl.firstElementChild.remove();

    const numEl = el.querySelector('.roll-num');
    const SPIN_MS = 650;
    const spin = setInterval(() => {
      numEl.textContent = String(1 + Math.floor(Math.random() * Math.max(sides, 2)));
    }, 55);
    setTimeout(() => {
      clearInterval(spin);
      numEl.textContent = String(r.total);
      el.classList.add('revealed');
    }, SPIN_MS);

    const remove = () => {
      clearInterval(spin);
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 260);
    };
    el.querySelector('.roll-x').addEventListener('click', remove);
    setTimeout(remove, crit || fumble ? 9000 : 7000);
  }

  subscribeDiceRolls(
    campaignId,
    (payload) => {
      if (payload && payload.eventType === 'INSERT' && payload.new) show(payload.new, false);
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

  function render() {
    if (!combat.state.active) {
      el.style.display = 'none';
      el.innerHTML = '';
      prevCurrentId = undefined;
      return;
    }
    el.style.display = '';
    const allSorted = combat.participants.slice().sort((a, b) => a.position - b.position);
    const current = currentTurnOf(allSorted);
    const rankMap = new Map(allSorted.map((p, i) => [p.id, i + 1]));
    const list = visibleParticipants().slice().sort((a, b) => a.position - b.position);
    const currentVisible = current && list.some((p) => p.id === current.id);
    el.className = 'board-hud-tracker' + (collapsed ? ' collapsed' : '');

    el.innerHTML = `
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
                ${showHp ? `<span class="trk-hp"><span class="trk-hp-fill tone-${hpTone(pct)}" style="width:${pct}%"></span></span>` : ''}
                ${isMe ? '<span class="trk-me-tag">você</span>' : ''}
              </button>`;
                  })
                  .join('')
          }
        </div>`
      }
    `;

    el.querySelector('#trk-toggle').addEventListener('click', () => {
      collapsed = !collapsed;
      setCollapsed('rastreador', collapsed);
      render();
    });
    el.querySelectorAll('.trk-card').forEach((card) => {
      card.addEventListener('mouseenter', () => tokenFor(card.dataset.cid)?.classList.add('hud-hl'));
      card.addEventListener('mouseleave', () => tokenFor(card.dataset.cid)?.classList.remove('hud-hl'));
      card.addEventListener('click', () => ping(card.dataset.cid));
    });
    // mantém o turno atual à vista numa fileira que rola
    const curCard = el.querySelector('.trk-card.current');
    if (curCard) {
      const listEl = el.querySelector('#trk-list');
      listEl.scrollLeft = curCard.offsetLeft - listEl.clientWidth / 2 + curCard.clientWidth / 2;
    }

    // "SEU TURNO!" -- só quando a vez MUDA pra mim (não a cada reload)
    const currentId = current ? current.id : null;
    if (prevCurrentId !== undefined && currentId !== prevCurrentId && current && characterId && current.character_id === characterId) {
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
  function decorate() {
    const tokens = document.querySelectorAll('.board-token[data-character-id]');
    if (!tokens.length) return;
    const active = combat.state.active;
    const allSorted = active ? combat.participants.slice().sort((a, b) => a.position - b.position) : [];
    const current = active ? currentTurnOf(allSorted) : null;
    const visible = active ? visibleParticipants() : [];
    tokens.forEach((t) => {
      const p = visible.find((x) => x.character_id === t.dataset.characterId);
      t.classList.toggle('turn-active', !!(p && current && p.id === current.id));
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
            ${STATUS_STATS.map((s) => {
              const val = char[s.key] || 0;
              return `<button type="button" class="dock-chip dock-stat" data-stat="${s.key}" style="--c:${s.color};" title="${escapeHtml(s.label)} — rolar d20 ${signed(val)}"><span class="dock-stat-ico">${s.icon}</span><b>${STAT_ABBR[s.key]}</b><i>${val}</i></button>`;
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

  function wire() {
    const col = el.querySelector('#dock-collapse');
    if (col) {
      col.addEventListener('click', () => {
        collapsed = !collapsed;
        setCollapsed('dock', collapsed);
        render();
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
        const s = STATUS_STATS.find((x) => x.key === btn.dataset.stat);
        if (!s || !char) return;
        doRoll(btn, { die: 'd20', qty: 1, mod: char[s.key] || 0, label: s.label });
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
    // se o usuário está com o foco num campo do dock (digitando), só atualiza números no lugar
    if (el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && char) {
      vitalsList().forEach((v) => updateVitalUi(v.kind));
      return;
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
