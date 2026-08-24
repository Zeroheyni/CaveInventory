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
  advanceRound,
  addParticipant,
  removeParticipant,
  updateParticipantHp,
  updateParticipantInitiative,
  forceReveal,
  hideAgain,
  reorderParticipants,
  setPlayerCombatPermission,
  isVisibleToPlayer,
} from '../combat.js';

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
  let hiddenMode = 'visible'; // 'visible' | 'countdown' | 'always'
  let dragId = null;

  async function load() {
    combatState = await getCombatState(campaignId);
    participants = await getParticipants(campaignId);
    if (isMaster) {
      const [{ data: chars }, { data: profs }] = await Promise.all([
        supabase.from('characters').select('id, name').eq('campaign_id', campaignId).order('name'),
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
  function hiddenStatusLabel(p) {
    if (!p.hidden) return null;
    if (p.manually_revealed) return 'revelado manualmente';
    if (p.reveal_at_round === null) return 'sempre oculto';
    const left = p.reveal_at_round - combatState.round;
    return left > 0 ? `revela em ${left} rodada${left === 1 ? '' : 's'}` : 'revelando...';
  }

  // ---- render ----
  function render() {
    if (!combatState.active) {
      app.innerHTML = `
        <div class="combat-empty">
          NENHUM COMBATE ATIVO NO MOMENTO
          ${isMaster ? '<div><button type="button" class="btn combat-start-btn" id="combat-start-btn">⚔ iniciar combate</button></div>' : ''}
        </div>
      `;
      return;
    }

    const mySelf = participants.find((p) => p.character_id === characterId);
    const list = visibleParticipants().slice().sort((a, b) => a.position - b.position);

    app.innerHTML = `
      <div class="combat-round-bar">
        <span class="combat-round-label">RODADA <b>${combatState.round}</b></span>
        <div class="combat-round-actions">
          ${isMaster ? `<button type="button" class="btn btn-ghost" id="combat-advance-round">avançar rodada</button>` : ''}
          ${isMaster ? `<button type="button" class="admin-danger-btn" id="combat-end-btn">encerrar combate</button>` : ''}
        </div>
      </div>

      ${
        !isMaster && mySelf
          ? `
        <div class="combat-self-card">
          <div class="combat-self-card-head">
            <span class="combat-self-name">${escapeHtml(mySelf.display_name)}</span>
            <span class="combat-hp-readout"><b>${mySelf.hp_current}</b> / ${mySelf.hp_max} HP</span>
          </div>
          <div class="combat-hp-bar"><div class="combat-hp-fill ${hpPct(mySelf) <= 25 ? 'low' : ''}" style="width:${hpPct(mySelf)}%"></div></div>
          <div class="combat-hp-controls">
            <button type="button" class="combat-hp-btn" data-hp-delta="-1" data-pid="${mySelf.id}">−</button>
            <input type="number" class="combat-hp-input" data-hp-input data-pid="${mySelf.id}" value="${mySelf.hp_current}">
            <button type="button" class="combat-hp-btn" data-hp-delta="1" data-pid="${mySelf.id}">+</button>
          </div>
        </div>`
          : ''
      }

      <div class="combat-list" id="combat-list">
        ${list.length === 0 ? '<div class="combat-empty">ninguém na iniciativa ainda</div>' : list.map((p) => participantRow(p)).join('')}
      </div>

      ${isMaster ? addParticipantSection() : ''}
      ${isMaster ? permissionsSection() : ''}
    `;
  }

  function participantRow(p) {
    const hiddenLabel = isMaster ? hiddenStatusLabel(p) : null;
    const showHp = canSeeHp(p);
    return `
      <div class="combat-participant-row team-${p.team}" data-row-pid="${p.id}" ${isMaster ? 'draggable="true"' : ''}>
        ${isMaster ? '<span class="combat-drag-handle" title="arraste pra reordenar">⋮⋮</span>' : ''}
        <span class="combat-team-dot team-${p.team}"></span>
        <div class="combat-row-main">
          <div class="combat-row-name">${escapeHtml(p.display_name)}</div>
          <div class="combat-row-sub">
            ${
              showHp
                ? `
              <div class="combat-row-hpbar combat-hp-bar"><div class="combat-hp-fill ${hpPct(p) <= 25 ? 'low' : ''}" style="width:${hpPct(p)}%"></div></div>
              <span class="combat-row-hptxt">${p.hp_current}/${p.hp_max}</span>`
                : '<span class="combat-row-hptxt">HP oculto</span>'
            }
          </div>
        </div>
        ${
          isMaster
            ? `
          <button type="button" class="combat-hp-btn" data-hp-delta="-1" data-pid="${p.id}">−</button>
          <input type="number" class="combat-hp-input" data-hp-input data-pid="${p.id}" value="${p.hp_current}">
          <button type="button" class="combat-hp-btn" data-hp-delta="1" data-pid="${p.id}">+</button>
          <input type="number" class="combat-init-input" data-init-input data-pid="${p.id}" value="${p.initiative ?? ''}" title="iniciativa" placeholder="ini">`
            : `<span class="combat-init-badge" title="iniciativa">${p.initiative ?? '—'}</span>`
        }
        ${hiddenLabel ? `<button type="button" class="combat-hidden-badge" data-force-reveal="${p.id}" data-currently-revealed="${p.manually_revealed}" title="clique pra ${p.manually_revealed ? 'ocultar de novo' : 'revelar agora'}">🔒 ${hiddenLabel}</button>` : ''}
        ${isMaster ? `<button type="button" class="combat-row-remove" data-remove-pid="${p.id}" title="remover">✕</button>` : ''}
      </div>
    `;
  }

  function addParticipantSection() {
    const availableChars = charactersInCampaign.filter((c) => !participants.some((p) => p.character_id === c.id));
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
            <button type="button" class="combat-source-btn ${addSource === 'npc' ? 'active' : ''}" data-add-source="npc">npc / inimigo</button>
          </div>
          ${
            addSource === 'character'
              ? `
            <div class="field" style="margin-bottom:10px;">
              <label>Personagem</label>
              <select class="slot-select" id="combat-add-character">
                ${
                  availableChars.length
                    ? availableChars.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')
                    : '<option value="">nenhum personagem disponível</option>'
                }
              </select>
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
              <option value="aliado" ${addSource === 'character' ? 'selected' : ''}>Aliado</option>
              <option value="inimigo" ${addSource === 'npc' ? 'selected' : ''}>Inimigo</option>
              <option value="neutro">Neutro</option>
            </select>
          </div>
          <div class="field" style="margin-bottom:10px;">
            <label>HP máximo</label>
            <input type="number" class="slot-select" id="combat-add-hp" min="1" value="10">
          </div>
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
  async function onAdvanceRound() {
    await advanceRound(campaignId, combatState.round);
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

      const advanceBtn = e.target.closest('#combat-advance-round');
      if (advanceBtn) return onAdvanceRound();

      const addTrigger = e.target.closest('#combat-add-trigger');
      if (addTrigger) {
        addFormOpen = !addFormOpen;
        render();
        return;
      }

      const sourceBtn = e.target.closest('button[data-add-source]');
      if (sourceBtn) {
        addSource = sourceBtn.dataset.addSource;
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
        await updateParticipantHp(pid, next);
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
      const hiddenSelect = e.target.closest('#combat-add-hidden');
      if (hiddenSelect) {
        hiddenMode = hiddenSelect.value;
        $('combat-add-reveal-wrap').style.display = hiddenMode === 'countdown' ? 'block' : 'none';
        return;
      }

      const hpInput = e.target.closest('input[data-hp-input]');
      if (hpInput) {
        const pid = hpInput.dataset.pid;
        const p = participants.find((x) => x.id === pid);
        if (!p) return;
        const next = Math.max(0, Math.min(p.hp_max, parseInt(hpInput.value) || 0));
        await updateParticipantHp(pid, next);
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
    const hpMax = Math.max(1, parseInt($('combat-add-hp').value) || 1);
    const initiativeRaw = $('combat-add-initiative').value;
    const initiative = initiativeRaw === '' ? null : parseInt(initiativeRaw);
    const revealInRounds = hiddenMode === 'countdown' ? Math.max(1, parseInt($('combat-add-reveal-rounds').value) || 1) : null;
    const position = participants.length;

    if (addSource === 'character') {
      const select = $('combat-add-character');
      const charId = select.value;
      if (!charId) return;
      const char = charactersInCampaign.find((c) => c.id === charId);
      await addParticipant(
        campaignId,
        { characterId: charId, displayName: char ? char.name : 'Personagem', team, hpMax, initiative, hiddenMode, revealInRounds, currentRound: combatState.round },
        position,
      );
    } else {
      const nameInput = $('combat-add-name');
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      await addParticipant(
        campaignId,
        { characterId: null, displayName: name, team, hpMax, initiative, hiddenMode, revealInRounds, currentRound: combatState.round },
        position,
      );
    }
    addFormOpen = false;
    await load();
  }

  wireEvents();
  load();
  subscribeRealtime();
}
