// Fase 5 — ficha de personagem: status (7 atributos), nível/XP, HP e
// Estamina persistentes, avatar, bio livre, história e módulos.
//
// Embutida dentro de character.js (aba "FICHA") ou aberta direto pelo
// mestre a partir do dashboard (masterFicha.js) — por isso recebe tudo
// que precisa via parâmetro, sem assumir de onde veio. Igual
// publicArea.js/combat.js, toda busca de elemento fica restrita à
// própria subárvore do embed pra não colidir com IDs de outras telas
// compartilhando a mesma página.
import { supabase } from '../supabaseClient.js';
import { escapeHtml } from '../shared/gameData.js';
import {
  getCharacterSheet,
  subscribeCharacterSheet,
  hpMax,
  estaminaMax,
  xpNeeded,
  hpBarClass,
  STATUS_STATS as STATS,
  sheetDataOf,
  updateSheetData,
  updateHpCurrent,
  updateEstaminaCurrent,
  uploadAvatar,
  masterUpdateStats,
  confirmStatusAllocation,
  addModuleToSheetData,
  removeModuleFromSheetData,
} from '../characterSheet.js';
import { rollDice } from '../dice.js';
import { listCharacterCustomBarsFor, updateCharacterCustomBarValue, customBarMax, createCustomBar, assignCustomBar } from '../customBars.js';

let activeChannel = null;
const HISTORIA_COLLAPSED_H = 90;
const MODULE_COLLAPSED_H = 56;

export function renderFichaScreen(app, { session, profile, campaign, characterId, onBack }) {
  const isMaster = profile.role === 'master';
  const $ = (id) => app.querySelector('#' + id);

  if (activeChannel) {
    supabase.removeChannel(activeChannel);
    activeChannel = null;
  }

  let sheet = null;
  let draftStats = null; // enquanto distribuindo pontos, rascunho local até confirmar
  let uploadingAvatar = false;
  let statusError = '';
  let historiaExpanded = false;
  const expandedModules = new Set();
  let customBars = []; // barras customizadas (Fase 8) atribuídas a ESTE personagem
  let customBarFormOpen = false; // "+ nova barra" -- só mestre, cria já direto pra ESTE personagem
  let customBarFormMode = 'manual'; // 'manual' | 'formula'
  let customBarFormError = '';

  // debounce -- sem isso, edições rápidas em sequência (bio, história,
  // módulos) disparam vários eventos de realtime seguidos, cada um
  // reobtendo o personagem e sobrescrevendo sheet.sheet_data com uma
  // versão desatualizada antes do próprio save anterior confirmar no
  // banco (mesmo problema já resolvido em publicArea.js/combat.js).
  let realtimeReloadTimer = null;
  async function load() {
    sheet = await getCharacterSheet(characterId);
    customBars = await listCharacterCustomBarsFor(characterId);
    if (sheet && sheet.status_points_unspent > 0 && !draftStats) {
      draftStats = Object.fromEntries(STATS.map((s) => [s.key, sheet[s.key]]));
    }
    render();
    if (!activeChannel) {
      activeChannel = subscribeCharacterSheet(characterId, () => {
        clearTimeout(realtimeReloadTimer);
        realtimeReloadTimer = setTimeout(async () => {
          const fresh = await getCharacterSheet(characterId);
          if (!fresh) return;
          sheet = fresh;
          customBars = await listCharacterCustomBarsFor(characterId);
          // não pisa num rascunho de alocação em andamento
          if (sheet.status_points_unspent <= 0) draftStats = null;
          render();
        }, 700);
      });
    }
  }

  function statusCap() {
    return sheet.status_confirmed ? 16 + sheet.level : 16;
  }
  function draftSpent() {
    return STATS.reduce((sum, s) => sum + (draftStats[s.key] - sheet[s.key]), 0);
  }
  function draftRemaining() {
    return sheet.status_points_unspent - draftSpent();
  }

  function render() {
    if (!sheet) {
      app.innerHTML = '<div class="combat-empty">carregando ficha...</div>';
      return;
    }
    const data = sheetDataOf(sheet);
    const hMax = hpMax(sheet);
    const eMax = estaminaMax(sheet);
    const hpPct = hMax > 0 ? Math.max(0, Math.min(100, Math.round((sheet.hp_current / hMax) * 100))) : 0;
    const ePct = eMax > 0 ? Math.max(0, Math.min(100, Math.round((sheet.estamina_current / eMax) * 100))) : 0;
    const needed = xpNeeded(sheet.level);
    const xpPct = needed > 0 ? Math.max(0, Math.min(100, Math.round((sheet.xp / needed) * 100))) : 0;
    const editingStatus = !isMaster && sheet.status_points_unspent > 0;

    app.innerHTML = `
      ${onBack ? `<button type="button" class="btn btn-ghost" id="ficha-back-btn" style="margin-bottom:12px;">← voltar</button>` : ''}
      <div class="ficha-header-card">
        <div class="ficha-avatar-wrap">
          ${
            sheet.avatar_url
              ? `<img class="ficha-avatar" id="ficha-avatar-img" src="${escapeHtml(sheet.avatar_url)}" alt="avatar">`
              : `<div class="ficha-avatar-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg></div>`
          }
          <button type="button" class="ficha-avatar-upload-btn" id="ficha-avatar-upload-btn" title="${uploadingAvatar ? 'enviando...' : 'trocar foto'}">${uploadingAvatar ? '…' : '📷'}</button>
          <input type="file" accept="image/*" id="ficha-avatar-input" style="display:none;">
        </div>
        <div class="ficha-header-info">
          <div class="ficha-name">${escapeHtml(sheet.name)}</div>
          <div class="ficha-level-row">
            <span class="ficha-level-tag">NÍVEL ${sheet.level}</span>
            <div class="ficha-xp-bar"><div class="ficha-xp-fill" style="width:${xpPct}%"></div></div>
            <span class="ficha-xp-text">${sheet.xp} / ${needed} XP</span>
          </div>
        </div>
      </div>

      <div class="ficha-bars">
        <div class="ficha-bar-block">
          <div class="ficha-bar-label">❤ HP <span class="ficha-bar-readout">${sheet.hp_current} / ${hMax}</span></div>
          <div class="combat-hp-bar"><div class="combat-hp-fill ${hpBarClass(hpPct)}" style="width:${hpPct}%"></div></div>
          <div class="ficha-bar-controls">
            <button type="button" class="combat-hp-btn" data-hp-delta="-1">−</button>
            <input type="number" class="combat-hp-input" id="ficha-hp-input" value="${sheet.hp_current}">
            <button type="button" class="combat-hp-btn" data-hp-delta="1">+</button>
          </div>
        </div>
        <div class="ficha-bar-block">
          <div class="ficha-bar-label">⚡ Estamina <span class="ficha-bar-readout">${sheet.estamina_current} / ${eMax}</span></div>
          <div class="combat-hp-bar"><div class="combat-hp-fill ficha-estamina-fill" style="width:${ePct}%"></div></div>
          <div class="ficha-bar-controls">
            <button type="button" class="combat-hp-btn" data-est-delta="-1">−</button>
            <input type="number" class="combat-hp-input" id="ficha-est-input" value="${sheet.estamina_current}">
            <button type="button" class="combat-hp-btn" data-est-delta="1">+</button>
          </div>
        </div>
        ${customBars.map((cb) => customBarBlock(cb)).join('')}
        ${isMaster ? customBarAddHtml() : ''}
      </div>

      <div class="ficha-section">
        <div class="ficha-section-head">
          <span class="ficha-section-title">STATUS</span>
          ${editingStatus ? `<span class="ficha-points-badge">${draftRemaining()} ponto(s) pra distribuir</span>` : ''}
          ${isMaster ? '<span class="ficha-master-badge">edição livre (mestre)</span>' : ''}
        </div>
        <div class="ficha-status-grid">
          ${STATS.map((s) => statCard(s, editingStatus)).join('')}
        </div>
        ${statusError ? `<p class="admin-error" style="display:block; margin-bottom:8px;">${escapeHtml(statusError)}</p>` : ''}
        ${
          editingStatus
            ? `<div class="ficha-status-actions">
                <button type="button" class="btn" id="ficha-confirm-status" ${draftRemaining() < 0 ? 'disabled' : ''}>confirmar</button>
                <button type="button" class="btn btn-ghost" id="ficha-reset-status">resetar</button>
              </div>`
            : ''
        }
      </div>

      <div class="ficha-section">
        <div class="ficha-section-head"><span class="ficha-section-title">FICHA</span></div>
        <div class="ficha-fields-grid">
          <div><label style="font-size:9px; color:var(--ink-faint); display:block; margin-bottom:4px;">Idade</label><input type="text" id="ficha-idade" value="${escapeHtml(data.idade)}"></div>
          <div><label style="font-size:9px; color:var(--ink-faint); display:block; margin-bottom:4px;">Gênero</label><input type="text" id="ficha-genero" value="${escapeHtml(data.genero)}"></div>
          <div><label style="font-size:9px; color:var(--ink-faint); display:block; margin-bottom:4px;">Sexualidade</label><input type="text" id="ficha-sexualidade" value="${escapeHtml(data.sexualidade)}"></div>
          <div><label style="font-size:9px; color:var(--ink-faint); display:block; margin-bottom:4px;">Raça</label><input type="text" id="ficha-raca" value="${escapeHtml(data.raca)}"></div>
          <div><label style="font-size:9px; color:var(--ink-faint); display:block; margin-bottom:4px;">Trabalho</label><input type="text" id="ficha-trabalho" value="${escapeHtml(data.trabalho)}"></div>
        </div>
      </div>

      <div class="ficha-section">
        <div class="ficha-section-head"><span class="ficha-section-title">HISTÓRIA</span></div>
        <div class="ficha-expandable ${historiaExpanded ? 'expanded' : ''}">
          <textarea class="ficha-historia-box" id="ficha-historia" placeholder="conte a história do personagem...">${escapeHtml(data.historia)}</textarea>
        </div>
        <button type="button" class="ficha-expand-btn" data-expand-toggle="historia" style="display:none;">${historiaExpanded ? 'ver menos ▴' : 'ver mais ▾'}</button>
      </div>

      <div class="ficha-section">
        <div class="ficha-section-head">
          <span class="ficha-section-title">MÓDULOS</span>
          <button type="button" class="btn btn-ghost" id="ficha-add-module">+ módulo</button>
        </div>
        ${
          (data.modulos || []).length === 0
            ? '<p class="admin-empty">nenhum módulo ainda — use "+ módulo" pra adicionar (ex: Qualidades, Medos, Objetivos...)</p>'
            : data.modulos.map((m) => moduleCard(m)).join('')
        }
      </div>
    `;

    wireEvents();
    syncExpandableHeights();
  }

  // mede a altura natural do textarea (ligando height:auto por um
  // instante) e só então aplica a altura fechada ou expandida -- sem
  // isso não dá pra saber se o conteúdo passa da altura fechada.
  function syncExpandableHeights() {
    app.querySelectorAll('.ficha-expandable').forEach((wrap) => {
      const ta = wrap.querySelector('textarea');
      const btn = wrap.nextElementSibling;
      if (!ta || !btn || btn.tagName !== 'BUTTON') return;
      const collapsedH = ta.classList.contains('ficha-module-content') ? MODULE_COLLAPSED_H : HISTORIA_COLLAPSED_H;
      ta.style.height = 'auto';
      const natural = ta.scrollHeight;
      const expanded = wrap.classList.contains('expanded');
      ta.style.height = (expanded ? natural : collapsedH) + 'px';
      btn.style.display = natural > collapsedH + 4 ? '' : 'none';
    });
  }

  // barra customizada (Fase 8) -- igual HP/Estamina visualmente, mas o
  // máximo vem da definição do mestre (fixo ou calculado a partir de
  // um status, ver customBarMax em ../customBars.js) e o dono do
  // personagem também pode ajustar o valor atual (RLS já garante que
  // ele só mexe em current_value, não em nome/cor/fórmula).
  function customBarBlock(cb) {
    const bar = cb.bar;
    if (!bar) return '';
    const max = customBarMax(bar, sheet);
    const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((cb.current_value / max) * 100))) : 0;
    return `
      <div class="ficha-bar-block">
        <div class="ficha-bar-label">${escapeHtml(bar.name)} <span class="ficha-bar-readout">${cb.current_value} / ${max}</span></div>
        <div class="combat-hp-bar"><div class="combat-hp-fill" style="width:${pct}%; background:${escapeHtml(bar.color)}"></div></div>
        <div class="ficha-bar-controls">
          <button type="button" class="combat-hp-btn" data-custom-bar-delta="-1" data-custom-bar-id="${cb.id}">−</button>
          <input type="number" class="combat-hp-input" data-custom-bar-input data-custom-bar-id="${cb.id}" value="${cb.current_value}">
          <button type="button" class="combat-hp-btn" data-custom-bar-delta="1" data-custom-bar-id="${cb.id}">+</button>
        </div>
      </div>`;
  }

  // "+ nova barra" -- só mestre, direto na ficha do jogador (em vez de
  // ir até o Combate e escolher o personagem numa lista) -- já nasce
  // atribuída a ESTE characterId, sem precisar de seletor de jogador.
  function customBarAddHtml() {
    if (!customBarFormOpen) {
      return `<button type="button" class="btn btn-ghost" id="ficha-custom-bar-open-form" style="align-self:flex-start; margin-top:4px;">+ nova barra</button>`;
    }
    return `
      <div class="combat-condition-custom-form" style="margin-top:8px; grid-column: 1 / -1;">
        <input type="text" id="ficha-custom-bar-name" placeholder="nome (ex: Fúria, Mana, Insanidade)" maxlength="30">
        <div class="combat-condition-custom-row">
          <input type="color" id="ficha-custom-bar-color" value="#5ad4ff">
          <label class="combat-custom-bar-mode-radio"><input type="radio" name="ficha-custom-bar-mode" value="manual" ${customBarFormMode === 'manual' ? 'checked' : ''}> personalizável</label>
          <label class="combat-custom-bar-mode-radio"><input type="radio" name="ficha-custom-bar-mode" value="formula" ${customBarFormMode === 'formula' ? 'checked' : ''}> fórmula de status</label>
        </div>
        ${
          customBarFormMode === 'manual'
            ? `<input type="number" id="ficha-custom-bar-manual-max" placeholder="máximo (ex: 20)" min="1">`
            : `<div class="combat-condition-custom-row">
                <select id="ficha-custom-bar-formula-stat">
                  ${STATS.map((s) => `<option value="${s.key}">${s.icon} ${s.label}</option>`).join('')}
                </select>
                <select id="ficha-custom-bar-formula-op">
                  <option value="mult">×</option>
                  <option value="div">÷</option>
                </select>
                <input type="number" id="ficha-custom-bar-formula-value" placeholder="valor (ex: 2)" step="0.5" min="0.5" value="2">
              </div>`
        }
        ${customBarFormError ? `<p class="admin-error" style="display:block;">${escapeHtml(customBarFormError)}</p>` : ''}
        <div class="combat-condition-custom-actions">
          <button type="button" class="btn" id="ficha-custom-bar-save">criar</button>
          <button type="button" class="btn btn-ghost" id="ficha-custom-bar-cancel">cancelar</button>
        </div>
      </div>`;
  }

  function statCard(s, editingStatus) {
    const value = editingStatus ? draftStats[s.key] : sheet[s.key];
    const cap = statusCap();
    const style = `style="--stat-color:${s.color};"`;
    const label = `<div class="ficha-stat-label"><span class="ficha-stat-icon">${s.icon}</span>${s.label}</div>`;
    if (isMaster) {
      return `
        <div class="ficha-stat-card" ${style}>
          ${label}
          <div class="ficha-stat-editrow">
            <button type="button" class="ficha-stat-btn" data-master-stat-delta="-1" data-stat="${s.key}">−</button>
            <span class="ficha-stat-value">${sheet[s.key]}</span>
            <button type="button" class="ficha-stat-btn" data-master-stat-delta="1" data-stat="${s.key}">+</button>
          </div>
          ${rollStatBtn(s, sheet[s.key])}
        </div>`;
    }
    if (editingStatus) {
      return `
        <div class="ficha-stat-card" ${style}>
          ${label}
          <div class="ficha-stat-editrow">
            <button type="button" class="ficha-stat-btn" data-draft-stat-delta="-1" data-stat="${s.key}" ${value <= sheet[s.key] ? 'disabled' : ''}>−</button>
            <span class="ficha-stat-value">${value}</span>
            <button type="button" class="ficha-stat-btn" data-draft-stat-delta="1" data-stat="${s.key}" ${value >= cap ? 'disabled' : ''}>+</button>
          </div>
        </div>`;
    }
    return `
      <div class="ficha-stat-card" ${style}>
        ${label}
        <div class="ficha-stat-value">${value}</div>
        ${rollStatBtn(s, value)}
      </div>`;
  }

  // d20 + valor do status, sem digitar nada -- usa o nome do PERSONAGEM
  // (não a conta logada) como roller_name: fica legível mesmo quando é o
  // mestre rolando pela ficha de outro jogador (via masterFicha.js), e
  // combina com o resto do histórico de dados ("Lyra testou Força" em vez
  // de "biel testou Força" quando biel só está com a ficha da Lyra aberta).
  function rollStatBtn(s, value) {
    return `<button type="button" class="ficha-stat-roll-btn" data-roll-stat data-roll-label="${escapeHtml(s.label)}" data-roll-mod="${value}" title="testar ${s.label} (d20${value >= 0 ? '+' : ''}${value})">🎲</button>`;
  }

  function moduleCard(m) {
    const expanded = expandedModules.has(m.id);
    return `
      <div class="ficha-module-card" data-module-id="${m.id}">
        <div class="ficha-module-head">
          <input type="text" class="ficha-module-title-input" data-module-title="${m.id}" value="${escapeHtml(m.title)}" placeholder="título do módulo">
          <button type="button" class="combat-row-remove" data-remove-module="${m.id}" title="remover">✕</button>
        </div>
        <div class="ficha-expandable ${expanded ? 'expanded' : ''}">
          <textarea class="ficha-module-content" data-module-content="${m.id}" placeholder="conteúdo livre...">${escapeHtml(m.content)}</textarea>
        </div>
        <button type="button" class="ficha-expand-btn" data-expand-toggle="module:${m.id}" style="display:none;">${expanded ? 'ver menos ▴' : 'ver mais ▾'}</button>
      </div>`;
  }

  // ---- ações ----
  async function saveSheetDataField(mutator) {
    const data = sheetDataOf(sheet);
    const next = mutator(data);
    sheet.sheet_data = next;
    await updateSheetData(characterId, next);
  }

  let wired = false;
  function wireEvents() {
    if (wired) return;
    wired = true;

    app.addEventListener('click', async (e) => {
      const backBtn = e.target.closest('#ficha-back-btn');
      if (backBtn) return onBack && onBack();

      const rollStatButton = e.target.closest('button[data-roll-stat]');
      if (rollStatButton) {
        const label = rollStatButton.dataset.rollLabel;
        const mod = parseInt(rollStatButton.dataset.rollMod, 10) || 0;
        rollStatButton.disabled = true;
        try {
          await rollDice(campaign.id, session.user.id, sheet.name, 'd20', 1, mod, label);
        } catch (err) {
          window.alert('Erro ao rolar: ' + err.message);
        }
        rollStatButton.disabled = false;
        return;
      }

      const uploadBtn = e.target.closest('#ficha-avatar-upload-btn');
      if (uploadBtn) return $('ficha-avatar-input').click();

      const hpDelta = e.target.closest('button[data-hp-delta]');
      if (hpDelta) {
        const next = Math.max(0, Math.min(hpMax(sheet), sheet.hp_current + Number(hpDelta.dataset.hpDelta)));
        sheet.hp_current = next;
        render();
        await updateHpCurrent(characterId, next);
        return;
      }
      const estDelta = e.target.closest('button[data-est-delta]');
      if (estDelta) {
        const next = Math.max(0, Math.min(estaminaMax(sheet), sheet.estamina_current + Number(estDelta.dataset.estDelta)));
        sheet.estamina_current = next;
        render();
        await updateEstaminaCurrent(characterId, next);
        return;
      }

      const customBarDelta = e.target.closest('button[data-custom-bar-delta]');
      if (customBarDelta) {
        const cb = customBars.find((c) => c.id === customBarDelta.dataset.customBarId);
        if (!cb) return;
        const max = customBarMax(cb.bar, sheet);
        const next = Math.max(0, Math.min(max, cb.current_value + Number(customBarDelta.dataset.customBarDelta)));
        cb.current_value = next;
        render();
        await updateCharacterCustomBarValue(cb.id, next);
        return;
      }

      const customBarOpenFormBtn = e.target.closest('#ficha-custom-bar-open-form');
      if (customBarOpenFormBtn) {
        customBarFormOpen = true;
        customBarFormMode = 'manual';
        customBarFormError = '';
        render();
        return;
      }
      const customBarCancelBtn = e.target.closest('#ficha-custom-bar-cancel');
      if (customBarCancelBtn) {
        customBarFormOpen = false;
        customBarFormError = '';
        render();
        return;
      }
      const customBarSaveBtn = e.target.closest('#ficha-custom-bar-save');
      if (customBarSaveBtn) {
        const name = ($('ficha-custom-bar-name')?.value || '').trim();
        const color = $('ficha-custom-bar-color')?.value || '#5ad4ff';
        const mode = customBarFormMode;
        const manualMax = mode === 'manual' ? parseInt($('ficha-custom-bar-manual-max')?.value, 10) : null;
        const formulaStat = mode === 'formula' ? $('ficha-custom-bar-formula-stat')?.value : null;
        const formulaOp = mode === 'formula' ? $('ficha-custom-bar-formula-op')?.value : null;
        const formulaValue = mode === 'formula' ? parseFloat($('ficha-custom-bar-formula-value')?.value) : null;
        if (!name) {
          customBarFormError = 'dê um nome pra barra.';
          render();
          return;
        }
        if (mode === 'manual' && (!manualMax || manualMax < 1)) {
          customBarFormError = 'defina um máximo válido (1 ou mais).';
          render();
          return;
        }
        if (mode === 'formula' && (!formulaValue || formulaValue <= 0)) {
          customBarFormError = 'defina um valor de fórmula válido (maior que 0).';
          render();
          return;
        }
        try {
          const newBar = await createCustomBar(campaign.id, { name, color, mode, manualMax, formulaStat, formulaOp, formulaValue });
          await assignCustomBar(campaign.id, newBar.id, characterId, customBarMax(newBar, sheet));
          customBars = await listCharacterCustomBarsFor(characterId);
          customBarFormOpen = false;
          customBarFormError = '';
          render();
        } catch (err) {
          customBarFormError = err.message;
          render();
        }
        return;
      }

      const draftBtn = e.target.closest('button[data-draft-stat-delta]');
      if (draftBtn) {
        const key = draftBtn.dataset.stat;
        const delta = Number(draftBtn.dataset.draftStatDelta);
        const next = draftStats[key] + delta;
        if (next < sheet[key] || next > statusCap()) return;
        if (delta > 0 && draftRemaining() <= 0) return;
        draftStats[key] = next;
        render();
        return;
      }

      const masterBtn = e.target.closest('button[data-master-stat-delta]');
      if (masterBtn) {
        const key = masterBtn.dataset.stat;
        const delta = Number(masterBtn.dataset.masterStatDelta);
        const next = Math.max(1, sheet[key] + delta);
        sheet[key] = next;
        render();
        await masterUpdateStats(characterId, { [key]: next });
        return;
      }

      const confirmBtn = e.target.closest('#ficha-confirm-status');
      if (confirmBtn) {
        statusError = '';
        try {
          await confirmStatusAllocation(characterId, draftStats);
          draftStats = null;
          await load();
        } catch (err) {
          statusError = err.message;
          render();
        }
        return;
      }
      const resetBtn = e.target.closest('#ficha-reset-status');
      if (resetBtn) {
        draftStats = Object.fromEntries(STATS.map((s) => [s.key, sheet[s.key]]));
        statusError = '';
        render();
        return;
      }

      const addModuleBtn = e.target.closest('#ficha-add-module');
      if (addModuleBtn) {
        await saveSheetDataField((data) => addModuleToSheetData(data, 'Novo módulo', ''));
        render();
        return;
      }
      const removeModuleBtn = e.target.closest('button[data-remove-module]');
      if (removeModuleBtn) {
        await saveSheetDataField((data) => removeModuleFromSheetData(data, removeModuleBtn.dataset.removeModule));
        render();
        return;
      }

      const expandBtn = e.target.closest('button[data-expand-toggle]');
      if (expandBtn) {
        const key = expandBtn.dataset.expandToggle;
        if (key === 'historia') {
          historiaExpanded = !historiaExpanded;
        } else if (key.startsWith('module:')) {
          const id = key.slice(7);
          if (expandedModules.has(id)) expandedModules.delete(id);
          else expandedModules.add(id);
        }
        render();
        return;
      }
    });

    app.addEventListener('change', async (e) => {
      const customBarModeRadio = e.target.closest('input[name="ficha-custom-bar-mode"]');
      if (customBarModeRadio) {
        customBarFormMode = customBarModeRadio.value;
        render();
        return;
      }

      const avatarInput = e.target.closest('#ficha-avatar-input');
      if (avatarInput && avatarInput.files[0]) {
        uploadingAvatar = true;
        render();
        try {
          sheet.avatar_url = await uploadAvatar(characterId, avatarInput.files[0]);
        } catch (err) {
          window.alert('Erro ao enviar foto: ' + err.message);
        }
        uploadingAvatar = false;
        render();
        return;
      }

      const hpInput = e.target.closest('#ficha-hp-input');
      if (hpInput) {
        const next = Math.max(0, Math.min(hpMax(sheet), parseInt(hpInput.value) || 0));
        sheet.hp_current = next;
        await updateHpCurrent(characterId, next);
        return;
      }
      const estInput = e.target.closest('#ficha-est-input');
      if (estInput) {
        const next = Math.max(0, Math.min(estaminaMax(sheet), parseInt(estInput.value) || 0));
        sheet.estamina_current = next;
        await updateEstaminaCurrent(characterId, next);
        return;
      }

      const customBarInput = e.target.closest('input[data-custom-bar-input]');
      if (customBarInput) {
        const cb = customBars.find((c) => c.id === customBarInput.dataset.customBarId);
        if (!cb) return;
        const max = customBarMax(cb.bar, sheet);
        const next = Math.max(0, Math.min(max, parseInt(customBarInput.value) || 0));
        cb.current_value = next;
        await updateCharacterCustomBarValue(cb.id, next);
        return;
      }

      const idadeInput = e.target.closest('#ficha-idade');
      if (idadeInput) return saveSheetDataField((data) => ({ ...data, idade: idadeInput.value }));
      const generoInput = e.target.closest('#ficha-genero');
      if (generoInput) return saveSheetDataField((data) => ({ ...data, genero: generoInput.value }));
      const sexInput = e.target.closest('#ficha-sexualidade');
      if (sexInput) return saveSheetDataField((data) => ({ ...data, sexualidade: sexInput.value }));
      const racaInput = e.target.closest('#ficha-raca');
      if (racaInput) return saveSheetDataField((data) => ({ ...data, raca: racaInput.value }));
      const trabalhoInput = e.target.closest('#ficha-trabalho');
      if (trabalhoInput) return saveSheetDataField((data) => ({ ...data, trabalho: trabalhoInput.value }));
      const historiaInput = e.target.closest('#ficha-historia');
      if (historiaInput) return saveSheetDataField((data) => ({ ...data, historia: historiaInput.value }));

      const moduleTitle = e.target.closest('input[data-module-title]');
      if (moduleTitle) {
        return saveSheetDataField((data) => ({
          ...data,
          modulos: data.modulos.map((m) => (m.id === moduleTitle.dataset.moduleTitle ? { ...m, title: moduleTitle.value } : m)),
        }));
      }
      const moduleContent = e.target.closest('textarea[data-module-content]');
      if (moduleContent) {
        return saveSheetDataField((data) => ({
          ...data,
          modulos: data.modulos.map((m) => (m.id === moduleContent.dataset.moduleContent ? { ...m, content: moduleContent.value } : m)),
        }));
      }
    });
  }

  load();
}
