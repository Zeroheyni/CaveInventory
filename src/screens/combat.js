// Fase 4 — rastreador de combate (HP + iniciativa). Sem cálculo de
// ataque/dano ainda (depende da ficha de status da Fase 5) — o grupo
// resolve isso verbalmente/com dados físicos, e ajusta HP/iniciativa
// aqui pra todo mundo acompanhar.
//
// Embutida dentro de character.js (aba "COMBATE"), que já tem várias
// dessas IDs em uso (currency-wrap, etc.) — por isso, igual publicArea.js,
// toda busca de elemento fica restrita à própria subárvore do embed.
import { supabase } from '../supabaseClient.js';
import { escapeHtml } from '../shared/gameData.js';
import {
  getCombatState,
  getParticipants,
  subscribeCombat,
  startCombat,
  endCombat,
  passTurn,
  passTurnFixed,
  toggleFixedInitiative,
  addParticipant,
  removeParticipant,
  updateParticipantHp,
  updateParticipantStamina,
  updateParticipantDamage,
  updateParticipantInitiative,
  forceReveal,
  hideAgain,
  reorderParticipants,
  setPlayerCombatPermission,
  isVisibleToPlayer,
  CONDITION_TYPES,
  applyCondition,
  removeCondition,
} from '../combat.js';
import { hpMax as charHpMax, estaminaMax as charEstaminaMax, hpBarClass, STATUS_STATS } from '../characterSheet.js';
import { evaluateDamageFormula, normalizeItemName } from '../shared/damageFormula.js';

let activeChannel = null;

export function renderCombatScreen(app, { session, profile, campaign, characterId, characterName }) {
  const campaignId = campaign.id;
  const isMaster = profile.role === 'master';
  const $ = (id) => app.querySelector('#' + id);

  if (activeChannel) {
    supabase.removeChannel(activeChannel);
    activeChannel = null;
  }

  let combatState = { active: false, round: 1 };
  let participants = [];
  let charactersInCampaign = [];
  let members = [];
  let addFormOpen = false;
  let addSource = 'character';
  let addCharacterId = null;
  let addBankNpcId = null;
  let hiddenMode = 'visible'; // 'visible' | 'countdown' | 'always'
  let dragId = null;
  let openWeaponInfo = null; // id do participante com o popover de dano da arma aberto (só mestre)
  let conditionPickerFor = null; // id do participante com o mini-form de "aplicar condição" aberto (só mestre)
  let masterCardTab = 'jogadores'; // 'jogadores' | 'aliados' | 'inimigos'

  async function load() {
    combatState = await getCombatState(campaignId);
    participants = await getParticipants(campaignId);
    if (isMaster) {
      const [{ data: chars }, { data: profs }] = await Promise.all([
        supabase
          .from('characters')
          .select(
            'id, name, vitalidade, forca, agilidade, destreza, inteligencia, estamina, observacao, hp_current, estamina_current, avatar_url, data, ' +
              'is_npc, npc_sheet_type, npc_has_status, hp_max_override, estamina_max_override, npc_damage'
          )
          .eq('campaign_id', campaignId)
          .order('name'),
        supabase.from('profiles').select('id, username, role, can_see_others_hp, can_see_hidden_initiative').eq('campaign_id', campaignId),
      ]);
      charactersInCampaign = chars || [];
      members = (profs || []).filter((p) => p.role !== 'master');
    }
    render();
  }

  // debounce -- sem isso, cliques rápidos em +/- de HP disparam vários
  // eventos de realtime em sequência, cada um reobtendo os dados e
  // sobrescrevendo a atualização otimista local antes do próprio
  // request dela terminar (mesmo problema já resolvido em publicArea.js).
  let realtimeReloadTimer = null;
  function subscribeRealtime() {
    activeChannel = subscribeCombat(campaignId, () => {
      clearTimeout(realtimeReloadTimer);
      realtimeReloadTimer = setTimeout(async () => {
        combatState = await getCombatState(campaignId);
        participants = await getParticipants(campaignId);
        render();
      }, 700);
    });
  }

  // ---- helpers ----
  function visibleParticipants() {
    if (isMaster) return participants;
    return participants.filter((p) => isVisibleToPlayer(p, profile, characterId, combatState.round));
  }
  function canSeeHp(p) {
    if (isMaster) return true;
    if (p.character_id === characterId) return true;
    return !!profile.can_see_others_hp;
  }
  function hpPct(p) {
    return p.hp_max > 0 ? Math.max(0, Math.min(100, Math.round((p.hp_current / p.hp_max) * 100))) : 0;
  }
  function staminaPct(p) {
    return p.stamina_max > 0 ? Math.max(0, Math.min(100, Math.round((p.stamina_current / p.stamina_max) * 100))) : 0;
  }
  function hiddenStatusLabel(p) {
    if (!p.hidden) return null;
    if (p.manually_revealed) return 'revelado manualmente';
    if (p.reveal_at_round === null) return 'sempre oculto';
    const left = p.reveal_at_round - combatState.round;
    return left > 0 ? `revela em ${left} rodada${left === 1 ? '' : 's'}` : 'revelando...';
  }
  // ---- condições de combate (Fase 8) -- ver db/031_patch_combat_conditions.sql ----
  function conditionExpiryLabel(cond) {
    if (cond.round_expira === null || cond.round_expira === undefined) return 'manual';
    const left = cond.round_expira - combatState.round;
    return left > 0 ? `${left} rodada${left === 1 ? '' : 's'}` : 'expirando...';
  }
  function conditionPickerHtml(p) {
    return `
      <div class="combat-condition-picker" data-pid="${p.id}">
        <select class="combat-condition-select">
          ${CONDITION_TYPES.map((t) => `<option value="${t.key}">${t.icon} ${t.label}</option>`).join('')}
        </select>
        <input type="number" class="combat-condition-duration" min="1" placeholder="rodadas (vazio=manual)">
        <button type="button" class="btn" data-condition-apply="${p.id}">aplicar</button>
      </div>`;
  }
  function conditionsRowHtml(p) {
    const conds = Array.isArray(p.conditions) ? p.conditions : [];
    if (conds.length === 0 && !isMaster) return '';
    const badges = conds
      .map((c) => {
        const meta = CONDITION_TYPES.find((t) => t.key === c.tipo) || { label: c.tipo, icon: '❔', color: '#9db4c7' };
        const title = `${meta.label} — ${conditionExpiryLabel(c)}${isMaster ? ' (clique pra remover)' : ''}`;
        return `<button type="button" class="combat-condition-badge" style="--cond-color:${meta.color};" data-remove-condition="${c.id}" data-pid="${p.id}" title="${escapeHtml(title)}" ${isMaster ? '' : 'disabled'}>${meta.icon}</button>`;
      })
      .join('');
    const addBtn = isMaster ? `<button type="button" class="combat-condition-add-btn" data-condition-add-toggle="${p.id}" title="aplicar condição">+</button>` : '';
    const picker = isMaster && conditionPickerFor === p.id ? conditionPickerHtml(p) : '';
    return `<div class="combat-conditions-row">${badges}${addBtn}${picker}</div>`;
  }

  // ---- resumo do mestre (Fase 6) -- HP/estamina/status/arma equipada de todo mundo ----
  function statusValuesOf(char) {
    return {
      vitalidade: char.vitalidade,
      forca: char.forca,
      agilidade: char.agilidade,
      destreza: char.destreza,
      inteligencia: char.inteligencia,
      estamina: char.estamina,
      observacao: char.observacao,
    };
  }
  function findEquippedWeapon(char) {
    const d = char.data || {};
    const equip = d.equip || {};
    const items = Array.isArray(d.items) ? d.items : [];
    for (const slotVal of Object.values(equip)) {
      if (!slotVal || typeof slotVal !== 'string' || slotVal.indexOf(':') === -1) continue;
      const [kind, id] = slotVal.split(':');
      if (kind !== 'item') continue;
      const it = items.find((i) => i.id === id);
      if (it && it.tag === 'arma') return it;
    }
    return null;
  }
  function resolveCharAmmoDamage(char, name) {
    const d = char.data || {};
    const items = Array.isArray(d.items) ? d.items : [];
    const target = normalizeItemName(name);
    const ammoItem = items.find((i) => i.tag === 'municao' && normalizeItemName(i.name) === target);
    if (!ammoItem || !ammoItem.ammoDamage) return null;
    return evaluateDamageFormula(ammoItem.ammoDamage, statusValuesOf(char), null);
  }
  function weaponDamageText(char, weapon) {
    const computed = weapon.damage ? evaluateDamageFormula(weapon.damage, statusValuesOf(char), (name) => resolveCharAmmoDamage(char, name)) : null;
    const numberText = computed !== null ? String(computed) : weapon.damage || '—';
    const typeText = weapon.damageType ? ` de ${weapon.damageType}` : '';
    return `${weapon.name}: ${numberText} dano${typeText}`;
  }
  // agrupa os participantes atuais do combate em 3 abas -- jogador de
  // verdade (character_id aponta pra um characters que NÃO é NPC) vai
  // em Jogadores não importa o time; qualquer NPC (do banco, vinculado
  // ou não, ou avulso) vai por time: inimigo -> Inimigos, o resto
  // (aliado/neutro) -> Aliados.
  function charOf(p) {
    return p.character_id ? charactersInCampaign.find((c) => c.id === p.character_id) : null;
  }
  function tabOfParticipant(p) {
    if (!p) return null;
    const char = charOf(p);
    if (char && !char.is_npc) return 'jogadores';
    if (p.team === 'inimigo') return 'inimigos';
    return 'aliados';
  }
  function categorizedParticipants() {
    const groups = { jogadores: [], aliados: [], inimigos: [] };
    participants.forEach((p) => groups[tabOfParticipant(p)].push(p));
    Object.values(groups).forEach((list) => list.sort((a, b) => a.position - b.position));
    return groups;
  }
  // quem vai ficar com a vez depois do "passar turno" atual -- mesma
  // lógica usada em onPassTurn(), só que sem efeito colateral (usada
  // pra destacar o próximo no painel do mestre).
  function computeNextTurn(allSorted, currentTurn) {
    if (allSorted.length < 2 || !currentTurn) return null;
    if (combatState.fixed_initiative) {
      const idx = allSorted.findIndex((p) => p.id === currentTurn.id);
      return allSorted[(idx + 1) % allSorted.length];
    }
    return allSorted[1] || null;
  }
  const MASTER_TAB_LABELS = { jogadores: 'Jogadores', aliados: 'Aliados', inimigos: 'Inimigos' };
  function masterPlayersSummary(currentTurn, nextTurn) {
    if (!combatState.active || participants.length === 0) return '';
    const groups = categorizedParticipants();
    const currentTab = tabOfParticipant(currentTurn);
    const nextTab = tabOfParticipant(nextTurn);
    const list = groups[masterCardTab] || [];
    return `
      <div class="combat-master-summary">
        <div class="combat-master-summary-head">
          <span class="combat-master-summary-title">PAINEL DO MESTRE</span>
          ${currentTurn ? `<span class="combat-turn-indicator"><span class="combat-turn-dot"></span>vez de: <b>${escapeHtml(currentTurn.display_name)}</b></span>` : ''}
          <button type="button" class="btn btn-ghost" id="combat-master-top-pass-turn">passar turno ▸</button>
        </div>
        <div class="combat-master-tabs">
          ${['jogadores', 'aliados', 'inimigos']
            .map(
              (tab) => `
            <button type="button" class="combat-master-tab-btn ${masterCardTab === tab ? 'active' : ''}" data-master-tab="${tab}">
              ${MASTER_TAB_LABELS[tab]} <span class="combat-master-tab-count">${groups[tab].length}</span>
              <span class="combat-master-tab-marks">
                ${currentTab === tab ? '<span class="tab-mark current" title="vez de alguém aqui"></span>' : ''}
                ${nextTab === tab ? '<span class="tab-mark next" title="próximo está aqui"></span>' : ''}
              </span>
            </button>`
            )
            .join('')}
        </div>
        <div class="combat-master-summary-grid">
          ${list.length === 0 ? '<p class="admin-empty">ninguém nessa categoria</p>' : list.map((p) => masterCard(p, currentTurn, nextTurn)).join('')}
        </div>
      </div>`;
  }
  function masterCard(p, currentTurn, nextTurn) {
    const char = charOf(p);
    const isRealPlayer = char && !char.is_npc;
    const isCompleteNpc = char && char.is_npc && char.npc_sheet_type === 'completa';
    // status/arma só fazem sentido pra jogador de verdade ou NPC de
    // ficha completa (tem inventário/equipamento pra calcular); NPC de
    // ficha simples só mostra status se o mestre marcou que quer, e
    // nunca tem arma calculada (sem equipamento).
    const showStatusChips = isRealPlayer || isCompleteNpc || (char && char.npc_has_status);
    const hPct = hpPct(p);
    const ePct = staminaPct(p);
    const isCurrent = currentTurn && p.id === currentTurn.id;
    const isNext = nextTurn && p.id === nextTurn.id;
    const weapon = isRealPlayer || isCompleteNpc ? findEquippedWeapon(char) : null;
    const infoOpen = openWeaponInfo === p.id;
    return `
      <div class="combat-master-player-card ${isCurrent ? 'current-turn' : ''} ${isNext ? 'next-turn' : ''}">
        <div class="combat-master-player-head">
          ${avatarThumb({ display_name: p.display_name, avatar_url: char ? char.avatar_url : null })}
          <span class="combat-master-player-name">${escapeHtml(p.display_name)}</span>
          ${weapon ? `<button type="button" class="combat-weapon-btn ${infoOpen ? 'active' : ''}" data-weapon-toggle="${p.id}" title="dano da arma equipada">⚔</button>` : ''}
        </div>
        <div class="combat-hp-bar"><div class="combat-hp-fill ${hpBarClass(hPct)}" style="width:${hPct}%"></div></div>
        <div class="combat-master-bar-row">
          <button type="button" class="combat-hp-btn" data-hp-delta="-1" data-pid="${p.id}">−</button>
          <span class="combat-master-bar-txt">❤ ${p.hp_current}/${p.hp_max}</span>
          <button type="button" class="combat-hp-btn" data-hp-delta="1" data-pid="${p.id}">+</button>
        </div>
        <div class="combat-hp-bar"><div class="combat-hp-fill ficha-estamina-fill" style="width:${ePct}%"></div></div>
        <div class="combat-master-bar-row">
          <button type="button" class="combat-hp-btn" data-est-delta="-1" data-pid="${p.id}">−</button>
          <span class="combat-master-bar-txt">⚡ ${p.stamina_current}/${p.stamina_max}</span>
          <button type="button" class="combat-hp-btn" data-est-delta="1" data-pid="${p.id}">+</button>
        </div>
        ${
          showStatusChips
            ? `<div class="combat-master-stat-row">
                ${STATUS_STATS.map((s) => `<span class="combat-master-stat-chip" style="--stat-color:${s.color};" title="${s.label}">${s.icon}${char[s.key] ?? '—'}</span>`).join('')}
              </div>`
            : ''
        }
        ${
          !isRealPlayer && !isCompleteNpc
            ? `<div class="combat-master-npc-damage">
                <label>Dano</label>
                <input type="text" class="slot-select" data-npc-damage-input data-pid="${p.id}" data-char-id="${char ? char.id : ''}" value="${escapeHtml((char ? char.npc_damage : p.damage) || '')}" placeholder="ex: 8 cortante">
              </div>`
            : ''
        }
        ${weapon && infoOpen ? `<div class="combat-weapon-info">${escapeHtml(weaponDamageText(char, weapon))}</div>` : ''}
      </div>`;
  }

  function avatarThumb(p) {
    if (p.avatar_url) return `<img class="combat-avatar" src="${escapeHtml(p.avatar_url)}" alt="">`;
    const letter = (p.display_name || '?').trim().charAt(0).toUpperCase();
    return `<span class="combat-avatar combat-avatar-placeholder">${escapeHtml(letter)}</span>`;
  }

  // ---- render ----
  function render() {
    const allSorted = participants.slice().sort((a, b) => a.position - b.position);
    const currentTurn = combatState.active
      ? combatState.fixed_initiative
        ? allSorted.find((p) => p.id === combatState.current_turn_id) || allSorted[0] || null
        : allSorted[0] || null
      : null;
    const nextTurn = computeNextTurn(allSorted, currentTurn);
    const summaryHtml = isMaster ? masterPlayersSummary(currentTurn, nextTurn) : '';
    if (!combatState.active) {
      app.innerHTML =
        summaryHtml +
        `
        <div class="combat-empty">
          NENHUM COMBATE ATIVO NO MOMENTO
          ${isMaster ? '<div><button type="button" class="btn combat-start-btn" id="combat-start-btn">⚔ iniciar combate</button></div>' : ''}
        </div>
      `;
      return;
    }

    const mySelf = participants.find((p) => p.character_id === characterId);
    const list = visibleParticipants().slice().sort((a, b) => a.position - b.position);
    const currentTurnVisible = currentTurn && (isMaster || list.some((p) => p.id === currentTurn.id));
    const rankMap = new Map(allSorted.map((p, i) => [p.id, i + 1]));

    app.innerHTML =
      summaryHtml +
      `
      <div class="combat-round-bar">
        <div class="combat-round-info">
          <span class="combat-round-label">RODADA <b>${combatState.round}</b><span class="combat-turn-sub"> · turno ${combatState.turns_passed_this_round || 0}/${participants.length}</span></span>
          ${currentTurn ? `<span class="combat-turn-indicator"><span class="combat-turn-dot"></span>vez de: <b>${currentTurnVisible ? escapeHtml(currentTurn.display_name) : '???'}</b></span>` : ''}
        </div>
        <div class="combat-round-actions">
          ${
            participants.length > 0
              ? `<button type="button" class="btn btn-ghost" id="combat-toggle-fixed" title="trava a ordem: em vez da lista girar a cada turno, só a borda verde caminha">${combatState.fixed_initiative ? '🔓 destravar iniciativa' : '🔒 fixar iniciativa'}</button>`
              : ''
          }
          ${isMaster && participants.length > 0 ? `<button type="button" class="btn" id="combat-pass-turn">passar turno ▸</button>` : ''}
          ${isMaster ? `<button type="button" class="admin-danger-btn" id="combat-end-btn">encerrar combate</button>` : ''}
        </div>
      </div>

      ${
        !isMaster && mySelf
          ? `
        <div class="combat-self-card ${currentTurn && mySelf.id === currentTurn.id ? 'current-turn' : ''}">
          <div class="combat-self-card-head">
            <span class="combat-self-name">${avatarThumb(mySelf)}<span class="combat-rank-badge">${rankMap.get(mySelf.id)}º</span>${escapeHtml(mySelf.display_name)}${currentTurn && mySelf.id === currentTurn.id ? ' <span class="combat-turn-indicator" style="display:inline-flex;"><span class="combat-turn-dot"></span>sua vez!</span>' : ''}</span>
            <span class="combat-hp-readout"><b>${mySelf.hp_current}</b> / ${mySelf.hp_max} HP</span>
          </div>
          <div class="combat-hp-bar"><div class="combat-hp-fill ${hpBarClass(hpPct(mySelf))}" style="width:${hpPct(mySelf)}%"></div></div>
          <div class="combat-hp-controls">
            <button type="button" class="combat-hp-btn" data-hp-delta="-1" data-pid="${mySelf.id}">−</button>
            <input type="number" class="combat-hp-input" data-hp-input data-pid="${mySelf.id}" value="${mySelf.hp_current}">
            <button type="button" class="combat-hp-btn" data-hp-delta="1" data-pid="${mySelf.id}">+</button>
          </div>
          <div class="combat-self-card-head" style="margin-top:10px;">
            <span class="combat-self-name">⚡ Estamina</span>
            <span class="combat-hp-readout"><b>${mySelf.stamina_current}</b> / ${mySelf.stamina_max}</span>
          </div>
          <div class="combat-hp-bar"><div class="combat-hp-fill ficha-estamina-fill" style="width:${staminaPct(mySelf)}%"></div></div>
          <div class="combat-hp-controls">
            <button type="button" class="combat-hp-btn" data-est-delta="-1" data-pid="${mySelf.id}">−</button>
            <input type="number" class="combat-hp-input" data-est-input data-pid="${mySelf.id}" value="${mySelf.stamina_current}">
            <button type="button" class="combat-hp-btn" data-est-delta="1" data-pid="${mySelf.id}">+</button>
          </div>
        </div>`
          : ''
      }

      <div class="combat-list" id="combat-list">
        ${list.length === 0 ? '<div class="combat-empty">ninguém na iniciativa ainda</div>' : list.map((p) => participantRow(p, currentTurn && p.id === currentTurn.id, rankMap.get(p.id))).join('')}
      </div>

      ${isMaster ? addParticipantSection() : ''}
      ${isMaster ? permissionsSection() : ''}
    `;
  }

  function participantRow(p, isCurrentTurn, rank) {
    const hiddenLabel = isMaster ? hiddenStatusLabel(p) : null;
    const showHp = canSeeHp(p);
    return `
      <div class="combat-participant-row team-${p.team} ${isCurrentTurn ? 'current-turn' : ''}" data-row-pid="${p.id}" ${isMaster ? 'draggable="true"' : ''}>
        ${isMaster ? '<span class="combat-drag-handle" title="arraste pra reordenar">⋮⋮</span>' : ''}
        <span class="combat-rank-badge" title="ordem na iniciativa">${rank}º</span>
        ${avatarThumb(p)}
        <span class="combat-team-dot team-${p.team}"></span>
        <div class="combat-row-main">
          <div class="combat-row-name">${escapeHtml(p.display_name)}</div>
          <div class="combat-row-sub">
            ${
              showHp
                ? `
              <div class="combat-row-hpbar combat-hp-bar"><div class="combat-hp-fill ${hpBarClass(hpPct(p))}" style="width:${hpPct(p)}%"></div></div>
              <span class="combat-row-hptxt">${p.hp_current}/${p.hp_max}</span>`
                : '<span class="combat-row-hptxt">HP oculto</span>'
            }
          </div>
          ${
            showHp && p.stamina_max > 0
              ? `
          <div class="combat-row-sub">
            <div class="combat-row-hpbar combat-hp-bar"><div class="combat-hp-fill ficha-estamina-fill" style="width:${staminaPct(p)}%"></div></div>
            <span class="combat-row-hptxt">${p.stamina_current}/${p.stamina_max} ⚡</span>
          </div>`
              : ''
          }
          ${conditionsRowHtml(p)}
        </div>
        ${
          isMaster
            ? `
          <button type="button" class="combat-hp-btn" data-hp-delta="-1" data-pid="${p.id}" title="HP">−</button>
          <input type="number" class="combat-hp-input" data-hp-input data-pid="${p.id}" value="${p.hp_current}" title="HP">
          <button type="button" class="combat-hp-btn" data-hp-delta="1" data-pid="${p.id}" title="HP">+</button>
          <button type="button" class="combat-hp-btn" data-est-delta="-1" data-pid="${p.id}" title="Estamina">−⚡</button>
          <input type="number" class="combat-hp-input" data-est-input data-pid="${p.id}" value="${p.stamina_current}" title="Estamina">
          <button type="button" class="combat-hp-btn" data-est-delta="1" data-pid="${p.id}" title="Estamina">+⚡</button>
          <input type="number" class="combat-init-input" data-init-input data-pid="${p.id}" value="${p.initiative ?? ''}" title="iniciativa" placeholder="ini">`
            : `<span class="combat-init-badge" title="iniciativa">${p.initiative ?? '—'}</span>`
        }
        ${hiddenLabel ? `<button type="button" class="combat-hidden-badge" data-force-reveal="${p.id}" data-currently-revealed="${p.manually_revealed}" title="clique pra ${p.manually_revealed ? 'ocultar de novo' : 'revelar agora'}">🔒 ${hiddenLabel}</button>` : ''}
        ${isMaster ? `<button type="button" class="combat-row-remove" data-remove-pid="${p.id}" title="remover">✕</button>` : ''}
      </div>
    `;
  }

  function addParticipantSection() {
    const realChars = charactersInCampaign.filter((c) => !c.is_npc);
    const bankNpcs = charactersInCampaign.filter((c) => c.is_npc);
    const availableChars = realChars.filter((c) => !participants.some((p) => p.character_id === c.id));
    const currentAddCharId = addCharacterId || (availableChars[0] && availableChars[0].id) || null;
    const selectedChar = availableChars.find((c) => c.id === currentAddCharId);
    const currentBankNpcId = addBankNpcId || (bankNpcs[0] && bankNpcs[0].id) || null;
    const selectedBankNpc = bankNpcs.find((c) => c.id === currentBankNpcId);
    return `
      <div class="combat-add-trigger">
        <button type="button" class="btn btn-ghost" id="combat-add-trigger">${addFormOpen ? 'fechar' : '+ adicionar participante'}</button>
      </div>
      ${
        addFormOpen
          ? `
        <div class="combat-add-card">
          <div class="combat-add-card-head"><h3>// NOVO PARTICIPANTE</h3></div>
          <div class="combat-source-toggle">
            <button type="button" class="combat-source-btn ${addSource === 'character' ? 'active' : ''}" data-add-source="character">personagem</button>
            <button type="button" class="combat-source-btn ${addSource === 'npc_bank' ? 'active' : ''}" data-add-source="npc_bank">banco de NPCs</button>
            <button type="button" class="combat-source-btn ${addSource === 'npc' ? 'active' : ''}" data-add-source="npc">npc avulso</button>
          </div>
          ${
            addSource === 'character'
              ? `
            <div class="field" style="margin-bottom:10px;">
              <label>Personagem</label>
              <select class="slot-select" id="combat-add-character">
                ${
                  availableChars.length
                    ? availableChars.map((c) => `<option value="${c.id}" ${c.id === currentAddCharId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')
                    : '<option value="">nenhum personagem disponível</option>'
                }
              </select>
            </div>`
              : addSource === 'npc_bank'
                ? `
            <div class="field" style="margin-bottom:10px;">
              <label>NPC do banco</label>
              <select class="slot-select" id="combat-add-bank-npc">
                ${
                  bankNpcs.length
                    ? bankNpcs.map((c) => `<option value="${c.id}" ${c.id === currentBankNpcId ? 'selected' : ''}>${escapeHtml(c.name)} (${c.npc_sheet_type})</option>`).join('')
                    : '<option value="">nenhum NPC salvo -- crie um no banco de NPCs</option>'
                }
              </select>
            </div>
            <div class="field" style="margin-bottom:10px;">
              <label>Quantidade (spawna várias cópias, ex: 3x Goblin)</label>
              <input type="number" class="slot-select" id="combat-add-quantity" min="1" value="1">
            </div>`
                : `
            <div class="field" style="margin-bottom:10px;">
              <label>Nome</label>
              <input type="text" class="slot-select" id="combat-add-name" placeholder="ex: Lobo das cavernas">
            </div>`
          }
          <div class="field" style="margin-bottom:10px;">
            <label>Time</label>
            <select class="slot-select" id="combat-add-team">
              <option value="aliado" ${addSource !== 'npc' ? 'selected' : ''}>Aliado</option>
              <option value="inimigo" ${addSource === 'npc' ? 'selected' : ''}>Inimigo</option>
              <option value="neutro">Neutro</option>
            </select>
          </div>
          ${
            addSource === 'character'
              ? `<div class="transfer-balance" id="combat-add-char-preview" style="margin-bottom:10px;">${
                  selectedChar
                    ? `<span>❤ ${selectedChar.hp_current}/${charHpMax(selectedChar)}</span><span class="transfer-balance-arrow">·</span><span>⚡ ${selectedChar.estamina_current}/${charEstaminaMax(selectedChar)}</span>`
                    : '<span>sem personagem disponível</span>'
                }</div>`
              : addSource === 'npc_bank'
                ? `<div class="transfer-balance" id="combat-add-bank-npc-preview" style="margin-bottom:10px;">${
                    selectedBankNpc
                      ? `<span>❤ ${selectedBankNpc.hp_current}/${charHpMax(selectedBankNpc)}</span><span class="transfer-balance-arrow">·</span><span>⚡ ${selectedBankNpc.estamina_current}/${charEstaminaMax(selectedBankNpc)}</span>`
                      : '<span>sem NPC disponível</span>'
                  }</div>`
                : `
          <div class="field" style="margin-bottom:10px;">
            <label>HP máximo</label>
            <input type="number" class="slot-select" id="combat-add-hp" min="1" value="10">
          </div>
          <div class="field" style="margin-bottom:10px;">
            <label>Estamina máxima</label>
            <input type="number" class="slot-select" id="combat-add-stamina" min="0" value="10">
          </div>`
          }
          <div class="field" style="margin-bottom:10px;">
            <label>Iniciativa</label>
            <div style="display:flex; gap:6px;">
              <input type="number" class="slot-select" id="combat-add-initiative" placeholder="valor">
              <button type="button" class="combat-roll-btn" id="combat-add-roll" title="rolar 1d20">🎲</button>
            </div>
          </div>
          <div class="field" style="margin-bottom:10px;">
            <label>Visibilidade da iniciativa</label>
            <select class="slot-select" id="combat-add-hidden">
              <option value="visible">Visível</option>
              <option value="countdown">Oculta — revela em N rodadas</option>
              <option value="always">Sempre oculta</option>
            </select>
          </div>
          <div class="field" id="combat-add-reveal-wrap" style="display:none; margin-bottom:10px;">
            <label>Revela em quantas rodadas</label>
            <input type="number" class="slot-select" id="combat-add-reveal-rounds" min="1" value="1">
          </div>
          <button type="button" class="btn" id="combat-add-submit">adicionar</button>
        </div>`
          : ''
      }
    `;
  }

  function permissionsSection() {
    return `
      <div class="combat-permissions">
        <div class="combat-permissions-head">PERMISSÕES DOS JOGADORES</div>
        ${members
          .map(
            (m) => `
          <div class="combat-perm-row">
            <span>${escapeHtml(m.username)}</span>
            <div class="combat-perm-btns">
              <button type="button" class="combat-perm-btn ${m.can_see_others_hp ? 'granted' : ''}" data-perm="can_see_others_hp" data-pid="${m.id}" data-current="${m.can_see_others_hp}">vê HP dos outros</button>
              <button type="button" class="combat-perm-btn ${m.can_see_hidden_initiative ? 'granted' : ''}" data-perm="can_see_hidden_initiative" data-pid="${m.id}" data-current="${m.can_see_hidden_initiative}">vê iniciativas ocultas</button>
            </div>
          </div>`
          )
          .join('')}
      </div>
    `;
  }

  // ---- ações ----
  async function onStartCombat() {
    await startCombat(campaignId);
    addFormOpen = false;
    await load();
  }
  async function onEndCombat() {
    if (!window.confirm('Encerrar o combate? Todos os participantes serão removidos da lista.')) return;
    await endCombat(campaignId);
    await load();
  }
  async function onPassTurn() {
    const ordered = participants.slice().sort((a, b) => a.position - b.position);
    if (ordered.length === 0) return;
    const snapshotState = { round: combatState.round, turns_passed_this_round: combatState.turns_passed_this_round || 0 };

    if (combatState.fixed_initiative) {
      // fixo -- a lista (position) não muda, só o ponteiro de quem tem
      // a vez anda pro próximo da ordem parada, voltando pro início.
      const currentId = combatState.current_turn_id || ordered[0].id;
      const idx = Math.max(0, ordered.findIndex((p) => p.id === currentId));
      const nextId = ordered[(idx + 1) % ordered.length].id;
      const turnsPassed = snapshotState.turns_passed_this_round + 1;
      if (turnsPassed >= ordered.length) {
        combatState.round = snapshotState.round + 1;
        combatState.turns_passed_this_round = 0;
      } else {
        combatState.turns_passed_this_round = turnsPassed;
      }
      combatState.current_turn_id = nextId;
      render();
      await passTurnFixed(campaignId, nextId, ordered.length, snapshotState);
      return;
    }

    // otimista -- aplica local (quem tá em 1º vai pro fim, resto sobe)
    // antes do roundtrip, igual o resto do drag-and-drop já faz aqui.
    const [first, ...rest] = ordered;
    const newOrder = [...rest, first];
    newOrder.forEach((p, i) => {
      p.position = i;
    });
    const turnsPassed = snapshotState.turns_passed_this_round + 1;
    if (turnsPassed >= ordered.length) {
      combatState.round = snapshotState.round + 1;
      combatState.turns_passed_this_round = 0;
    } else {
      combatState.turns_passed_this_round = turnsPassed;
    }
    render();

    await passTurn(campaignId, newOrder, snapshotState);
  }
  async function onToggleFixedInitiative() {
    await toggleFixedInitiative(campaignId);
    await load();
  }

  let wired = false;
  function wireEvents() {
    if (wired) return;
    wired = true;

    app.addEventListener('click', async (e) => {
      const startBtn = e.target.closest('#combat-start-btn');
      if (startBtn) return onStartCombat();

      const endBtn = e.target.closest('#combat-end-btn');
      if (endBtn) return onEndCombat();

      const passTurnBtn = e.target.closest('#combat-pass-turn');
      if (passTurnBtn) return onPassTurn();

      const toggleFixedBtn = e.target.closest('#combat-toggle-fixed');
      if (toggleFixedBtn) return onToggleFixedInitiative();

      const weaponToggleBtn = e.target.closest('button[data-weapon-toggle]');
      if (weaponToggleBtn) {
        const id = weaponToggleBtn.dataset.weaponToggle;
        openWeaponInfo = openWeaponInfo === id ? null : id;
        render();
        return;
      }

      const conditionAddToggleBtn = e.target.closest('button[data-condition-add-toggle]');
      if (conditionAddToggleBtn) {
        const id = conditionAddToggleBtn.dataset.conditionAddToggle;
        conditionPickerFor = conditionPickerFor === id ? null : id;
        render();
        return;
      }

      const conditionApplyBtn = e.target.closest('button[data-condition-apply]');
      if (conditionApplyBtn) {
        const pid = conditionApplyBtn.dataset.conditionApply;
        const picker = conditionApplyBtn.closest('.combat-condition-picker');
        const key = picker.querySelector('.combat-condition-select').value;
        const durationRaw = picker.querySelector('.combat-condition-duration').value;
        const duration = durationRaw === '' ? null : Math.max(1, parseInt(durationRaw, 10) || 1);
        conditionPickerFor = null;
        try {
          await applyCondition(pid, key, duration);
          await load();
        } catch (err) {
          window.alert(err.message);
          render();
        }
        return;
      }

      const removeConditionBtn = e.target.closest('button[data-remove-condition]');
      if (removeConditionBtn) {
        const pid = removeConditionBtn.dataset.pid;
        const conditionId = removeConditionBtn.dataset.removeCondition;
        try {
          await removeCondition(pid, conditionId);
          await load();
        } catch (err) {
          window.alert(err.message);
        }
        return;
      }

      const masterTabBtn = e.target.closest('button[data-master-tab]');
      if (masterTabBtn) {
        masterCardTab = masterTabBtn.dataset.masterTab;
        render();
        return;
      }

      const topPassTurnBtn = e.target.closest('#combat-master-top-pass-turn');
      if (topPassTurnBtn) return onPassTurn();

      const addTrigger = e.target.closest('#combat-add-trigger');
      if (addTrigger) {
        addFormOpen = !addFormOpen;
        render();
        return;
      }

      const sourceBtn = e.target.closest('button[data-add-source]');
      if (sourceBtn) {
        addSource = sourceBtn.dataset.addSource;
        addCharacterId = null;
        addBankNpcId = null;
        render();
        return;
      }

      const rollBtn = e.target.closest('#combat-add-roll');
      if (rollBtn) {
        $('combat-add-initiative').value = String(Math.floor(Math.random() * 20) + 1);
        return;
      }

      const submitBtn = e.target.closest('#combat-add-submit');
      if (submitBtn) return onAddSubmit();

      const hpDeltaBtn = e.target.closest('button[data-hp-delta]');
      if (hpDeltaBtn) {
        const pid = hpDeltaBtn.dataset.pid;
        const p = participants.find((x) => x.id === pid);
        if (!p) return;
        const next = Math.max(0, Math.min(p.hp_max, p.hp_current + Number(hpDeltaBtn.dataset.hpDelta)));
        p.hp_current = next; // otimista -- clique seguinte já lê o valor atualizado, sem esperar o roundtrip
        render();
        await updateParticipantHp(pid, next, p.character_id);
        return;
      }

      const estDeltaBtn = e.target.closest('button[data-est-delta]');
      if (estDeltaBtn) {
        const pid = estDeltaBtn.dataset.pid;
        const p = participants.find((x) => x.id === pid);
        if (!p) return;
        const next = Math.max(0, Math.min(p.stamina_max, p.stamina_current + Number(estDeltaBtn.dataset.estDelta)));
        p.stamina_current = next;
        render();
        await updateParticipantStamina(pid, next, p.character_id);
        return;
      }

      const removeBtn = e.target.closest('button[data-remove-pid]');
      if (removeBtn) {
        await removeParticipant(removeBtn.dataset.removePid);
        return;
      }

      const revealBtn = e.target.closest('button[data-force-reveal]');
      if (revealBtn) {
        const pid = revealBtn.dataset.forceReveal;
        const currentlyRevealed = revealBtn.dataset.currentlyRevealed === 'true';
        if (currentlyRevealed) await hideAgain(pid);
        else await forceReveal(pid);
        return;
      }

      const permBtn = e.target.closest('button[data-perm]');
      if (permBtn) {
        const field = permBtn.dataset.perm;
        const current = permBtn.dataset.current === 'true';
        await setPlayerCombatPermission(permBtn.dataset.pid, field, !current);
        await load();
        return;
      }
    });

    app.addEventListener('change', async (e) => {
      const npcDamageInput = e.target.closest('input[data-npc-damage-input]');
      if (npcDamageInput) {
        const pid = npcDamageInput.dataset.pid;
        const p = participants.find((x) => x.id === pid);
        if (!p) return;
        p.damage = npcDamageInput.value;
        await updateParticipantDamage(pid, npcDamageInput.value, npcDamageInput.dataset.charId || null);
        return;
      }

      const hiddenSelect = e.target.closest('#combat-add-hidden');
      if (hiddenSelect) {
        hiddenMode = hiddenSelect.value;
        $('combat-add-reveal-wrap').style.display = hiddenMode === 'countdown' ? 'block' : 'none';
        return;
      }

      const charSelect = e.target.closest('#combat-add-character');
      if (charSelect) {
        addCharacterId = charSelect.value || null;
        render();
        return;
      }

      const bankNpcSelect = e.target.closest('#combat-add-bank-npc');
      if (bankNpcSelect) {
        addBankNpcId = bankNpcSelect.value || null;
        render();
        return;
      }

      const hpInput = e.target.closest('input[data-hp-input]');
      if (hpInput) {
        const pid = hpInput.dataset.pid;
        const p = participants.find((x) => x.id === pid);
        if (!p) return;
        const next = Math.max(0, Math.min(p.hp_max, parseInt(hpInput.value) || 0));
        await updateParticipantHp(pid, next, p.character_id);
        return;
      }

      const estInput = e.target.closest('input[data-est-input]');
      if (estInput) {
        const pid = estInput.dataset.pid;
        const p = participants.find((x) => x.id === pid);
        if (!p) return;
        const next = Math.max(0, Math.min(p.stamina_max, parseInt(estInput.value) || 0));
        await updateParticipantStamina(pid, next, p.character_id);
        return;
      }

      const initInput = e.target.closest('input[data-init-input]');
      if (initInput) {
        const pid = initInput.dataset.pid;
        const v = initInput.value === '' ? null : parseInt(initInput.value);
        await updateParticipantInitiative(pid, isNaN(v) ? null : v);
        return;
      }
    });

    // ---- arrastar pra reordenar (só mestre) ----
    const list = () => $('combat-list');
    app.addEventListener('dragstart', (e) => {
      const row = e.target.closest('.combat-participant-row[draggable="true"]');
      if (!row) return;
      dragId = row.dataset.rowPid;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
    });
    app.addEventListener('dragend', (e) => {
      const row = e.target.closest('.combat-participant-row');
      if (row) row.classList.remove('dragging');
      list()?.querySelectorAll('.combat-participant-row').forEach((r) => r.classList.remove('drag-over-top', 'drag-over-bottom'));
      dragId = null;
    });
    app.addEventListener('dragover', (e) => {
      if (!dragId) return;
      const row = e.target.closest('.combat-participant-row[draggable="true"]');
      if (!row || row.dataset.rowPid === dragId) return;
      e.preventDefault();
      const rect = row.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      row.classList.toggle('drag-over-top', before);
      row.classList.toggle('drag-over-bottom', !before);
    });
    app.addEventListener('dragleave', (e) => {
      const row = e.target.closest('.combat-participant-row');
      if (row) row.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    app.addEventListener('drop', async (e) => {
      const row = e.target.closest('.combat-participant-row[draggable="true"]');
      if (!row || !dragId || row.dataset.rowPid === dragId) return;
      e.preventDefault();
      const before = row.classList.contains('drag-over-top');
      row.classList.remove('drag-over-top', 'drag-over-bottom');

      const ordered = participants.slice().sort((a, b) => a.position - b.position).map((p) => p.id);
      const fromIdx = ordered.indexOf(dragId);
      if (fromIdx === -1) return;
      ordered.splice(fromIdx, 1);
      let toIdx = ordered.indexOf(row.dataset.rowPid);
      if (!before) toIdx += 1;
      ordered.splice(toIdx, 0, dragId);

      // aplica localmente já, pra não esperar o roundtrip da rede pra sentir o drop
      ordered.forEach((id, i) => {
        const p = participants.find((x) => x.id === id);
        if (p) p.position = i;
      });
      render();
      await reorderParticipants(ordered);
    });
  }

  async function onAddSubmit() {
    const team = $('combat-add-team').value;
    const initiativeRaw = $('combat-add-initiative').value;
    const initiative = initiativeRaw === '' ? null : parseInt(initiativeRaw);
    const revealInRounds = hiddenMode === 'countdown' ? Math.max(1, parseInt($('combat-add-reveal-rounds').value) || 1) : null;
    const position = participants.length;

    if (addSource === 'character') {
      const select = $('combat-add-character');
      const charId = select.value;
      if (!charId) return;
      const char = charactersInCampaign.find((c) => c.id === charId);
      if (!char) return;
      // HP/Estamina de personagem vêm direto da ficha (persistentes) --
      // não é o mestre que digita um valor novo aqui.
      await addParticipant(
        campaignId,
        {
          characterId: charId,
          displayName: char.name,
          team,
          hpMax: charHpMax(char),
          hpCurrent: char.hp_current,
          staminaMax: charEstaminaMax(char),
          staminaCurrent: char.estamina_current,
          initiative,
          hiddenMode,
          revealInRounds,
          currentRound: combatState.round,
          avatarUrl: char.avatar_url,
        },
        position,
      );
    } else if (addSource === 'npc_bank') {
      const bankSelect = $('combat-add-bank-npc');
      const npc = charactersInCampaign.find((c) => c.id === (bankSelect && bankSelect.value));
      if (!npc) return;
      const quantity = Math.max(1, parseInt($('combat-add-quantity').value) || 1);
      const hMax = charHpMax(npc);
      const eMax = charEstaminaMax(npc);
      if (quantity === 1) {
        // uma cópia só -- fica vinculado ao registro do banco, HP/estamina
        // sincronizam de volta pra lá igual personagem de jogador (faz
        // sentido pra NPC nomeado e recorrente, tipo um aliado fixo).
        await addParticipant(
          campaignId,
          {
            characterId: npc.id,
            displayName: npc.name,
            team,
            hpMax: hMax,
            hpCurrent: npc.hp_current,
            staminaMax: eMax,
            staminaCurrent: npc.estamina_current,
            initiative,
            hiddenMode,
            revealInRounds,
            currentRound: combatState.round,
            avatarUrl: npc.avatar_url,
          },
          position,
        );
      } else {
        // várias cópias -- desvincula do registro do banco (senão as
        // cópias compartilhariam a MESMA linha de HP, e dano numa
        // "sujaria" as outras e o próprio registro do banco). Cada
        // cópia começa cheia, e o dano (se tiver) vai como texto fixo.
        let dmgText = null;
        if (npc.npc_sheet_type === 'simples') {
          dmgText = npc.npc_damage || null;
        } else {
          const weapon = findEquippedWeapon(npc);
          dmgText = weapon ? weaponDamageText(npc, weapon) : null;
        }
        for (let i = 0; i < quantity; i++) {
          await addParticipant(
            campaignId,
            {
              characterId: null,
              displayName: `${npc.name} ${i + 1}`,
              team,
              hpMax: hMax,
              hpCurrent: hMax,
              staminaMax: eMax,
              staminaCurrent: eMax,
              initiative,
              hiddenMode,
              revealInRounds,
              currentRound: combatState.round,
              avatarUrl: npc.avatar_url,
              damage: dmgText,
            },
            position + i,
          );
        }
      }
    } else {
      const nameInput = $('combat-add-name');
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      const hpMax = Math.max(1, parseInt($('combat-add-hp').value) || 1);
      const staminaMax = Math.max(0, parseInt($('combat-add-stamina').value) || 0);
      await addParticipant(
        campaignId,
        { characterId: null, displayName: name, team, hpMax, staminaMax, initiative, hiddenMode, revealInRounds, currentRound: combatState.round },
        position,
      );
    }
    addFormOpen = false;
    addCharacterId = null;
    addBankNpcId = null;
    await load();
  }

  wireEvents();
  load();
  subscribeRealtime();
}
