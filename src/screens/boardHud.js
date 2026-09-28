// Tabuleiro -- Fase 4: HUD ao redor do tabuleiro em tela cheia (visual
// "HUD de jogo" -- painéis flutuantes translúcidos com borda em glow,
// por cima do tabuleiro mas sempre abaixo da seta do menu lateral, ver
// z-index em board.css). Três painéis independentes, cada um com seu
// próprio estado/Realtime:
//   - iniciativa (canto superior direito) -- só aparece com combate
//     ativo; reaproveita campaign_combat/combat_participants, o MESMO
//     combate da aba Combate (não um sistema novo).
//   - bandeja de dados (borda esquerda, retrátil) -- reaproveita
//     dice.js e as classes CSS já genéricas de dice.css.
//   - barras do personagem (canto configurável, padrão inferior
//     esquerdo) -- só HP/Estamina/barras customizadas do PRÓPRIO
//     personagem, só leitura (ajustar continua na aba Combate/Ficha).
//     Não aparece pro mestre (ele não tem personagem próprio).
//
// Montado como filho do PAI do container do tabuleiro (não do próprio
// container, que o board.js reconstrói inteiro via innerHTML toda
// hora) -- assim sobrevive aos re-renders do board.js sem perder
// estado/Realtime, e ainda assim some sozinho quando o usuário troca
// de aba (porque o pai comum, o -mode-wrap, vira display:none).
import { supabase } from '../supabaseClient.js';
import { escapeHtml } from '../shared/gameData.js';
import { getCombatState, getParticipants, subscribeCombat, passTurn, passTurnFixed, toggleFixedInitiative, isVisibleToPlayer } from '../combat.js';
import { hpMax, estaminaMax, hpBarClass } from '../characterSheet.js';
import { listCharacterCustomBarsFor, customBarMax } from '../customBars.js';
import { rollDice, listRecentRolls, subscribeDiceRolls, DICE_PRESETS, normalizeCustomDie } from '../dice.js';

const BARS_CORNER_KEY = 'board-hud-bars-corner';

export function renderBoardHud(mountParent, { session, profile, campaign, characterId, characterName, isMaster }) {
  const campaignId = campaign.id;
  const root = document.createElement('div');
  root.className = 'board-hud-root';
  mountParent.appendChild(root);

  const cleanups = [];
  cleanups.push(mountInitiativePanel(root, { campaignId, profile, characterId, isMaster }));
  cleanups.push(mountDiceTray(root, { campaignId, rollerId: session.user.id, rollerName: characterName || profile.username || 'alguém' }));
  if (!isMaster && characterId) cleanups.push(mountBarsPanel(root, { campaignId, characterId }));

  return {
    destroy() {
      cleanups.forEach((fn) => fn && fn());
      root.remove();
    },
  };
}

// ---------------------------------------------------------------
// painel de iniciativa (canto superior direito)
// ---------------------------------------------------------------
function mountInitiativePanel(root, { campaignId, profile, characterId, isMaster }) {
  const el = document.createElement('div');
  el.className = 'board-hud-panel board-hud-initiative';
  el.style.display = 'none'; // some visível só depois do load() confirmar combate ativo -- sem isso, pisca uma caixa vazia por uma fração de segundo
  root.appendChild(el);

  let combatState = { active: false, round: 1 };
  let participants = [];
  let busy = false;

  function canSeeHp(p) {
    if (isMaster) return true;
    if (p.character_id === characterId) return true;
    return !!profile.can_see_others_hp;
  }
  function hpPct(p) {
    return p.hp_max > 0 ? Math.max(0, Math.min(100, Math.round((p.hp_current / p.hp_max) * 100))) : 0;
  }
  function visibleParticipants() {
    if (isMaster) return participants;
    return participants.filter((p) => isVisibleToPlayer(p, profile, characterId, combatState.round));
  }
  function avatarHtml(p) {
    if (p.avatar_url) return `<img class="combat-avatar" src="${escapeHtml(p.avatar_url)}" alt="">`;
    const letter = (p.display_name || '?').trim().charAt(0).toUpperCase();
    return `<span class="combat-avatar combat-avatar-placeholder">${escapeHtml(letter)}</span>`;
  }

  function render() {
    if (!combatState.active) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    el.style.display = '';
    const allSorted = participants.slice().sort((a, b) => a.position - b.position);
    const currentTurn = combatState.fixed_initiative
      ? allSorted.find((p) => p.id === combatState.current_turn_id) || allSorted[0] || null
      : allSorted[0] || null;
    const rankMap = new Map(allSorted.map((p, i) => [p.id, i + 1]));
    const list = visibleParticipants().slice().sort((a, b) => a.position - b.position);

    el.innerHTML = `
      <div class="board-hud-head">
        <span class="board-hud-head-icon">⚔</span>
        <span>RODADA ${combatState.round}</span>
        <button type="button" class="board-hud-mini-btn" id="hud-toggle-fixed" title="${combatState.fixed_initiative ? 'destravar iniciativa (a lista volta a girar)' : 'fixar iniciativa (só a borda caminha)'}">${combatState.fixed_initiative ? '🔒' : '🔓'}</button>
      </div>
      <div class="board-hud-initiative-list">
        ${
          list.length === 0
            ? '<div class="board-hud-empty">ninguém na iniciativa</div>'
            : list
                .map((p) => {
                  const isCurrent = currentTurn && p.id === currentTurn.id;
                  const showHp = canSeeHp(p);
                  return `
            <div class="board-hud-init-row ${isCurrent ? 'current-turn' : ''} team-${p.team}">
              <span class="combat-rank-badge">${rankMap.get(p.id)}º</span>
              ${avatarHtml(p)}
              <div class="board-hud-init-main">
                <div class="board-hud-init-name">${escapeHtml(p.display_name)}</div>
                ${showHp ? `<div class="combat-hp-bar board-hud-init-hpbar"><div class="combat-hp-fill ${hpBarClass(hpPct(p))}" style="width:${hpPct(p)}%"></div></div>` : ''}
              </div>
            </div>`;
                })
                .join('')
        }
      </div>
      ${isMaster && participants.length > 0 ? `<button type="button" class="btn board-hud-pass-turn" id="hud-pass-turn" ${busy ? 'disabled' : ''}>passar turno ▸</button>` : ''}
    `;

    const fixedBtn = el.querySelector('#hud-toggle-fixed');
    if (fixedBtn) {
      fixedBtn.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        try {
          await toggleFixedInitiative(campaignId);
        } catch (_) {
          // painel compacto -- erro aqui não trava a tela, só não aplica
        }
        busy = false;
        await load();
      });
    }
    const passBtn = el.querySelector('#hud-pass-turn');
    if (passBtn) passBtn.addEventListener('click', onPassTurn);
  }

  async function onPassTurn() {
    if (busy) return;
    const ordered = participants.slice().sort((a, b) => a.position - b.position);
    if (ordered.length === 0) return;
    busy = true;
    const snapshotState = { round: combatState.round, turns_passed_this_round: combatState.turns_passed_this_round || 0 };
    try {
      if (combatState.fixed_initiative) {
        const currentId = combatState.current_turn_id || ordered[0].id;
        const idx = Math.max(0, ordered.findIndex((p) => p.id === currentId));
        const nextId = ordered[(idx + 1) % ordered.length].id;
        await passTurnFixed(campaignId, nextId, ordered.length, snapshotState);
      } else {
        const [first, ...rest] = ordered;
        const newOrder = [...rest, first];
        await passTurn(campaignId, newOrder, snapshotState);
      }
    } catch (_) {
      // idem -- Realtime traz o estado real de volta de qualquer jeito
    }
    busy = false;
    await load();
  }

  let reloadTimer = null;
  async function load() {
    try {
      const [cs, ps] = await Promise.all([getCombatState(campaignId), getParticipants(campaignId)]);
      combatState = cs;
      participants = ps;
    } catch (_) {
      // painel compacto -- se falhar, só fica com o último estado conhecido
    }
    render();
  }

  const channel = subscribeCombat(
    campaignId,
    () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(load, 500);
    },
    'combat-board-' + campaignId
  );
  load();

  return () => {
    clearTimeout(reloadTimer);
    supabase.removeChannel(channel);
  };
}

// ---------------------------------------------------------------
// bandeja de dados (borda esquerda, retrátil) -- mesma UI/classes da
// bandeja de combat.js, só que num módulo próprio pra poder ser
// montado aqui também sem duplicar o template inteiro no board.js.
// ---------------------------------------------------------------
function mountDiceTray(root, { campaignId, rollerId, rollerName }) {
  const el = document.createElement('div');
  el.className = 'board-hud-dice-tray';
  root.appendChild(el);

  let open = false;
  let rolls = [];
  let qty = 1;
  let modifier = 0;
  let customValue = '';
  let rolling = false;
  let error = '';
  let channel = null;

  function render() {
    el.className = 'board-hud-dice-tray' + (open ? ' open' : '');
    el.innerHTML = `
      <button type="button" class="board-hud-dice-handle" id="hud-dice-toggle" title="${open ? 'fechar dados' : 'rolar dados'}"><span>🎲</span></button>
      <div class="board-hud-dice-panel">
        <div class="combat-dice-tray-buttons">
          ${DICE_PRESETS.map((d) => `<button type="button" class="dice-die-btn" data-hud-die="${d}" ${rolling ? 'disabled' : ''}>${d}</button>`).join('')}
        </div>
        <div class="dice-custom-row">
          <span class="dice-custom-prefix">d</span>
          <input type="number" id="hud-dice-custom-value" min="2" max="1000" placeholder="ex: 132" value="${escapeHtml(customValue)}">
          <button type="button" class="dice-custom-roll-btn" id="hud-dice-custom-roll-btn" ${rolling ? 'disabled' : ''}>rolar</button>
        </div>
        <div class="combat-dice-tray-mods">
          <label class="dice-field"><span>qtd</span><input type="number" id="hud-dice-qty" min="1" max="10" value="${qty}"></label>
          <label class="dice-field"><span>mod</span><input type="number" id="hud-dice-modifier" value="${modifier}"></label>
        </div>
        ${error ? `<p class="admin-error" style="display:block;">${escapeHtml(error)}</p>` : ''}
        <div class="combat-dice-tray-recent">
          ${
            rolls.length === 0
              ? `<p class="admin-empty">ninguém rolou nada ainda.</p>`
              : rolls
                  .slice(0, 6)
                  .map(
                    (r) => `
            <div class="dice-roll-entry">
              <span class="dice-roll-who">${escapeHtml(r.roller_name)}</span>
              ${r.label ? `<span class="dice-roll-label">🎯 ${escapeHtml(r.label)}</span>` : ''}
              <span class="dice-roll-formula">${r.qty}${r.die}${r.modifier ? (r.modifier > 0 ? '+' + r.modifier : r.modifier) : ''}</span>
              <span class="dice-roll-total">${r.total}</span>
            </div>`
                  )
                  .join('')
          }
        </div>
      </div>`;
    wire();
  }

  function wire() {
    el.querySelector('#hud-dice-toggle').addEventListener('click', async () => {
      open = !open;
      if (open && !channel) {
        try {
          rolls = await listRecentRolls(campaignId, 8);
          channel = subscribeDiceRolls(
            campaignId,
            async () => {
              rolls = await listRecentRolls(campaignId, 8);
              render();
            },
            'dice-board-' + campaignId
          );
        } catch (err) {
          error = err.message;
        }
      }
      render();
    });
    el.querySelectorAll('[data-hud-die]').forEach((btn) => {
      btn.addEventListener('click', () => performRoll(btn.dataset.hudDie));
    });
    el.querySelector('#hud-dice-custom-roll-btn').addEventListener('click', () => {
      const die = normalizeCustomDie(customValue);
      if (!die) {
        error = 'dado customizado precisa ser um número entre 2 e 1000.';
        render();
        return;
      }
      performRoll(die);
    });
    el.querySelector('#hud-dice-qty').addEventListener('change', (e) => {
      qty = Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1));
    });
    el.querySelector('#hud-dice-modifier').addEventListener('change', (e) => {
      modifier = parseInt(e.target.value, 10) || 0;
    });
    el.querySelector('#hud-dice-custom-value').addEventListener('input', (e) => {
      customValue = e.target.value;
    });
  }

  async function performRoll(die) {
    if (rolling) return;
    rolling = true;
    error = '';
    render();
    try {
      const roll = await rollDice(campaignId, rollerId, rollerName, die, qty, modifier);
      rolls = [roll, ...rolls];
    } catch (err) {
      error = err.message;
    }
    rolling = false;
    render();
  }

  render();

  return () => {
    if (channel) supabase.removeChannel(channel);
  };
}

// ---------------------------------------------------------------
// barras do personagem (canto configurável, só leitura) -- HP,
// Estamina e barras customizadas do PRÓPRIO personagem. Lê direto de
// `characters`/`character_custom_bars` (não de combat_participants):
// esses valores são persistentes e existem com ou sem combate ativo,
// e updateParticipantHp (combat.js) sempre grava nos dois juntos, então
// characters.hp_current nunca fica desatualizado em relação ao combate.
// ---------------------------------------------------------------
function mountBarsPanel(root, { campaignId, characterId }) {
  const el = document.createElement('div');
  el.className = 'board-hud-panel board-hud-bars';
  el.style.display = 'none'; // idem painel de iniciativa -- some visível só depois do load() trazer o personagem
  root.appendChild(el);

  let corner = 'bottom-left';
  try {
    corner = localStorage.getItem(BARS_CORNER_KEY) || 'bottom-left';
  } catch (_) {
    // localStorage pode falhar (aba anônima, storage bloqueado) -- painel
    // só continua no padrão, sem quebrar o resto do HUD por causa disso.
  }

  let char = null;
  let customBars = [];

  function render() {
    el.className = `board-hud-panel board-hud-bars corner-${corner}`;
    if (!char) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    el.style.display = '';
    const hMax = hpMax(char);
    const eMax = estaminaMax(char);
    const hPct = hMax > 0 ? Math.max(0, Math.min(100, Math.round((char.hp_current / hMax) * 100))) : 0;
    const ePct = eMax > 0 ? Math.max(0, Math.min(100, Math.round((char.estamina_current / eMax) * 100))) : 0;
    el.innerHTML = `
      <div class="board-hud-head">
        ${char.avatar_url ? `<img class="combat-avatar" src="${escapeHtml(char.avatar_url)}" alt="">` : `<span class="combat-avatar combat-avatar-placeholder">${escapeHtml((char.name || '?').charAt(0).toUpperCase())}</span>`}
        <span>${escapeHtml(char.name)}</span>
        <button type="button" class="board-hud-mini-btn" id="hud-bars-corner-toggle" title="mudar de canto">⇄</button>
      </div>
      <div class="board-hud-bar-row">
        <span class="board-hud-bar-label">❤ HP</span>
        <div class="combat-hp-bar"><div class="combat-hp-fill ${hpBarClass(hPct)}" style="width:${hPct}%"></div></div>
        <span class="board-hud-bar-txt">${char.hp_current}/${hMax}</span>
      </div>
      ${
        eMax > 0
          ? `<div class="board-hud-bar-row">
               <span class="board-hud-bar-label">⚡ EST</span>
               <div class="combat-hp-bar"><div class="combat-hp-fill ficha-estamina-fill" style="width:${ePct}%"></div></div>
               <span class="board-hud-bar-txt">${char.estamina_current}/${eMax}</span>
             </div>`
          : ''
      }
      ${customBars
        .map((cb) => {
          const max = customBarMax(cb.bar, char);
          const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((cb.current_value / max) * 100))) : 0;
          return `
        <div class="board-hud-bar-row">
          <span class="board-hud-bar-label" style="color:${escapeHtml(cb.bar.color)};">${escapeHtml(cb.bar.name)}</span>
          <div class="combat-hp-bar"><div class="combat-hp-fill" style="width:${pct}%; background:${escapeHtml(cb.bar.color)}"></div></div>
          <span class="board-hud-bar-txt">${cb.current_value}/${max}</span>
        </div>`;
        })
        .join('')}
    `;
    const toggleBtn = el.querySelector('#hud-bars-corner-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        corner = corner === 'bottom-left' ? 'top-left' : 'bottom-left';
        try {
          localStorage.setItem(BARS_CORNER_KEY, corner);
        } catch (_) {
          // idem -- preferência só não persiste, painel continua funcionando
        }
        render();
      });
    }
  }

  let reloadTimer = null;
  async function load() {
    try {
      const [{ data: charRow }, bars] = await Promise.all([
        supabase
          .from('characters')
          .select('name, avatar_url, hp_current, estamina_current, hp_max_override, estamina_max_override, vitalidade, forca, agilidade, destreza, inteligencia, estamina, observacao')
          .eq('id', characterId)
          .maybeSingle(),
        listCharacterCustomBarsFor(characterId),
      ]);
      char = charRow;
      customBars = bars || [];
    } catch (_) {
      // painel compacto -- se falhar, fica com o último estado conhecido
    }
    render();
  }

  const channel = supabase
    .channel('board-bars-' + characterId)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'characters', filter: `id=eq.${characterId}` }, () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(load, 400);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'character_custom_bars', filter: `character_id=eq.${characterId}` }, () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(load, 400);
    })
    .subscribe();
  load();

  return () => {
    clearTimeout(reloadTimer);
    supabase.removeChannel(channel);
  };
}
