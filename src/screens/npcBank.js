// Fase 6 — banco de NPCs: fichas que só o mestre enxerga, criadas como
// "completa" (igual um player -- status, ficha, história, inventário)
// ou "simples" (nome + Vida/Estamina/Dano, status opcional). Puxar um
// NPC do banco pro combate é feito em combat.js (fonte "banco de
// NPCs" no formulário de adicionar participante).
import { escapeHtml } from '../shared/gameData.js';
import {
  listCampaignNpcs,
  subscribeCampaignSheets,
  createCompleteNpc,
  createSimpleNpc,
  updateSimpleNpc,
  deleteNpc,
  hpMax,
  estaminaMax,
  hpBarClass,
  STATUS_STATS,
} from '../characterSheet.js';
import { renderFichaScreen } from './ficha.js';
import { renderCharacterScreen } from './character.js';

export function renderNpcBankScreen(app, { session, profile, campaign, topApp, onBack }) {
  const campaignId = campaign.id;
  const $ = (id) => app.querySelector('#' + id);

  let npcs = [];
  let viewingFichaId = null;
  let createMode = null; // null | 'choose' | 'completa' | 'simples'
  let editingSimpleId = null; // id do npc simples sendo editado inline
  let confirmingDelete = null;
  let channel = null;
  let realtimeReloadTimer = null;
  let formError = '';

  async function load() {
    npcs = await listCampaignNpcs(campaignId);
    render();
    if (!channel) {
      channel = subscribeCampaignSheets(campaignId, () => {
        clearTimeout(realtimeReloadTimer);
        realtimeReloadTimer = setTimeout(load, 700);
      });
    }
  }

  function backToTopApp() {
    renderCharacterScreen(topApp, { session, profile, campaign });
  }

  function render() {
    if (viewingFichaId) {
      renderFichaScreen(app, {
        session,
        profile,
        campaign,
        characterId: viewingFichaId,
        onBack: () => {
          viewingFichaId = null;
          render();
        },
      });
      return;
    }

    app.innerHTML = `
      ${onBack ? `<button type="button" class="btn btn-ghost" id="npc-bank-back-btn" style="margin-bottom:12px;">← voltar</button>` : ''}
      <div class="npc-bank-head">
        <div class="ficha-section-title">BANCO DE NPCS</div>
        ${!createMode ? `<button type="button" class="btn" id="npc-bank-new-btn">+ novo NPC</button>` : ''}
      </div>
      ${createMode ? createPanel() : ''}
      <div class="npc-bank-grid">
        ${npcs.length === 0 ? '<p class="admin-empty">nenhum NPC salvo ainda -- use "+ novo NPC" pra criar o primeiro.</p>' : npcs.map(npcCard).join('')}
      </div>
    `;
    wireEvents();
    const nameInput = $('npc-simple-name') || $('npc-completa-name');
    if (nameInput) nameInput.focus();
  }

  function createPanel() {
    if (createMode === 'choose') {
      return `
        <div class="npc-bank-create-card">
          <div class="npc-bank-create-head">
            <h3>// NOVO NPC</h3>
            <button class="icon-btn" id="npc-create-close" title="fechar">✕</button>
          </div>
          <div class="npc-type-choice">
            <button type="button" class="npc-type-btn" data-choose-type="completa">
              <span class="npc-type-btn-title">Ficha completa</span>
              <span class="npc-type-btn-desc">Igual um player -- status, história, foto, inventário e equipamento.</span>
            </button>
            <button type="button" class="npc-type-btn" data-choose-type="simples">
              <span class="npc-type-btn-title">Ficha simples</span>
              <span class="npc-type-btn-desc">Só nome, Vida, Estamina e Dano -- rápido pra inimigo genérico. Status é opcional.</span>
            </button>
          </div>
        </div>`;
    }
    if (createMode === 'completa') {
      return `
        <div class="npc-bank-create-card">
          <div class="npc-bank-create-head">
            <h3>// NOVO NPC — FICHA COMPLETA</h3>
            <button class="icon-btn" id="npc-create-close" title="fechar">✕</button>
          </div>
          <div class="field" style="margin-bottom:12px;"><label for="npc-completa-name">Nome</label><input type="text" id="npc-completa-name" placeholder="ex: Capitã Vessa"></div>
          ${formError ? `<p class="admin-error" style="display:block;">${escapeHtml(formError)}</p>` : ''}
          <button type="button" class="btn" id="npc-completa-submit">criar e abrir ficha</button>
        </div>`;
    }
    return simpleForm(null);
  }

  function simpleForm(npc) {
    const editing = !!npc;
    const hMax = npc ? npc.hp_max_override ?? 10 : 10;
    const eMax = npc ? npc.estamina_max_override ?? 10 : 10;
    return `
      <div class="npc-bank-create-card" ${editing ? `data-editing-id="${npc.id}"` : ''}>
        <div class="npc-bank-create-head">
          <h3>// ${editing ? 'EDITAR NPC' : 'NOVO NPC'} — FICHA SIMPLES</h3>
          <button class="icon-btn" id="npc-create-close" title="fechar">✕</button>
        </div>
        <div class="form-grid">
          <div class="field"><label for="npc-simple-name">Nome</label><input type="text" id="npc-simple-name" value="${editing ? escapeHtml(npc.name) : ''}" placeholder="ex: Goblin"></div>
          <div class="field"><label for="npc-simple-hp">Vida máx.</label><input type="number" id="npc-simple-hp" min="1" value="${hMax}"></div>
          <div class="field"><label for="npc-simple-est">Estamina máx.</label><input type="number" id="npc-simple-est" min="0" value="${eMax}"></div>
        </div>
        <div class="field" style="margin-bottom:10px;"><label for="npc-simple-damage">Dano</label><input type="text" id="npc-simple-damage" value="${editing ? escapeHtml(npc.npc_damage || '') : ''}" placeholder="ex: 6 cortante"></div>
        <div class="uses-row">
          <label class="checkbox-wrap"><input type="checkbox" id="npc-simple-status" ${editing ? (npc.npc_has_status ? 'checked' : '') : ''}> Incluir os 7 status</label>
        </div>
        ${formError ? `<p class="admin-error" style="display:block;">${escapeHtml(formError)}</p>` : ''}
        <button type="button" class="btn" id="npc-simple-submit">${editing ? 'salvar' : 'criar NPC'}</button>
      </div>`;
  }

  function npcCard(npc) {
    const isCompleta = npc.npc_sheet_type === 'completa';
    const hMax = hpMax(npc);
    const eMax = estaminaMax(npc);
    const hPct = hMax > 0 ? Math.round(((npc.hp_current || 0) / hMax) * 100) : 0;
    const ePct = eMax > 0 ? Math.round(((npc.estamina_current || 0) / eMax) * 100) : 0;
    const showStatus = isCompleta || npc.npc_has_status;
    const isEditing = editingSimpleId === npc.id;
    if (isEditing) return simpleForm(npc);
    return `
      <div class="npc-bank-card">
        <div class="npc-bank-card-head">
          ${npc.avatar_url ? `<img class="ficha-dash-avatar" src="${escapeHtml(npc.avatar_url)}" alt="">` : `<div class="ficha-dash-avatar"></div>`}
          <div class="npc-bank-card-info">
            <div class="ficha-dash-name">${escapeHtml(npc.name)}</div>
            <span class="npc-type-badge ${isCompleta ? 'completa' : 'simples'}">${isCompleta ? 'completa' : 'simples'}</span>
          </div>
        </div>
        <div class="ficha-dash-bar-row"><span class="ficha-dash-bar-icon">❤</span><div class="combat-hp-bar"><div class="combat-hp-fill ${hpBarClass(hPct)}" style="width:${hPct}%"></div></div></div>
        <div class="ficha-dash-bar-row"><span class="ficha-dash-bar-icon">⚡</span><div class="combat-hp-bar"><div class="combat-hp-fill ficha-estamina-fill" style="width:${ePct}%"></div></div></div>
        ${
          showStatus
            ? `<div class="combat-master-stat-row">${STATUS_STATS.map((s) => `<span class="combat-master-stat-chip" style="--stat-color:${s.color};" title="${s.label}">${s.icon}${npc[s.key] ?? '—'}</span>`).join('')}</div>`
            : `<div class="npc-bank-damage-preview">⚔ ${npc.npc_damage ? escapeHtml(npc.npc_damage) : 'sem dano definido'}</div>`
        }
        <div class="npc-bank-card-actions">
          ${
            isCompleta
              ? `<button type="button" class="btn btn-ghost" data-open-ficha="${npc.id}" title="ficha">📋 ficha</button>
                 <button type="button" class="btn btn-ghost" data-open-inventory="${npc.id}" title="inventário">🎒 itens</button>`
              : `<button type="button" class="btn btn-ghost" data-edit-simple="${npc.id}" title="editar">✎ editar</button>`
          }
          <button type="button" class="combat-row-remove" data-delete-npc="${npc.id}" title="${confirmingDelete === npc.id ? 'clique de novo pra confirmar' : 'apagar'}">${confirmingDelete === npc.id ? '⚠' : '✕'}</button>
        </div>
      </div>`;
  }

  let wired = false;
  function wireEvents() {
    if (wired) return;
    wired = true;

    app.addEventListener('click', async (e) => {
      const backBtn = e.target.closest('#npc-bank-back-btn');
      if (backBtn) return onBack && onBack();

      const newBtn = e.target.closest('#npc-bank-new-btn');
      if (newBtn) {
        createMode = 'choose';
        formError = '';
        render();
        return;
      }
      const closeBtn = e.target.closest('#npc-create-close');
      if (closeBtn) {
        createMode = null;
        formError = '';
        render();
        return;
      }
      const chooseBtn = e.target.closest('button[data-choose-type]');
      if (chooseBtn) {
        createMode = chooseBtn.dataset.chooseType;
        render();
        return;
      }

      const completaSubmit = e.target.closest('#npc-completa-submit');
      if (completaSubmit) {
        const name = $('npc-completa-name').value.trim();
        if (!name) {
          formError = 'dê um nome pro NPC.';
          render();
          return;
        }
        try {
          const created = await createCompleteNpc(campaignId, name);
          createMode = null;
          formError = '';
          viewingFichaId = created.id;
          await load();
        } catch (err) {
          formError = 'erro: ' + err.message;
          render();
        }
        return;
      }

      const simpleSubmit = e.target.closest('#npc-simple-submit');
      if (simpleSubmit) {
        const card = simpleSubmit.closest('[data-editing-id]');
        const editingId = card ? card.dataset.editingId : null;
        const name = $('npc-simple-name').value.trim();
        const hpVal = Math.max(1, parseInt($('npc-simple-hp').value) || 1);
        const estVal = Math.max(0, parseInt($('npc-simple-est').value) || 0);
        const damage = $('npc-simple-damage').value.trim();
        const hasStatus = $('npc-simple-status').checked;
        if (!name) {
          formError = 'dê um nome pro NPC.';
          render();
          return;
        }
        try {
          if (editingId) {
            await updateSimpleNpc(editingId, { name, hpMaxVal: hpVal, estaminaMaxVal: estVal, damage, hasStatus });
            editingSimpleId = null;
          } else {
            await createSimpleNpc(campaignId, { name, hpMaxVal: hpVal, estaminaMaxVal: estVal, damage, hasStatus });
            createMode = null;
          }
          formError = '';
          await load();
        } catch (err) {
          formError = 'erro: ' + err.message;
          render();
        }
        return;
      }

      const openFichaBtn = e.target.closest('button[data-open-ficha]');
      if (openFichaBtn) {
        viewingFichaId = openFichaBtn.dataset.openFicha;
        render();
        return;
      }
      const openInvBtn = e.target.closest('button[data-open-inventory]');
      if (openInvBtn) {
        const npc = npcs.find((n) => n.id === openInvBtn.dataset.openInventory);
        renderCharacterScreen(topApp, { session, profile, campaign, characterId: openInvBtn.dataset.openInventory, ownerName: npc ? npc.name : 'NPC', onBack: backToTopApp });
        return;
      }
      const editSimpleBtn = e.target.closest('button[data-edit-simple]');
      if (editSimpleBtn) {
        editingSimpleId = editSimpleBtn.dataset.editSimple;
        formError = '';
        render();
        return;
      }
      const deleteBtn = e.target.closest('button[data-delete-npc]');
      if (deleteBtn) {
        const id = deleteBtn.dataset.deleteNpc;
        if (confirmingDelete !== id) {
          confirmingDelete = id;
          render();
          return;
        }
        confirmingDelete = null;
        await deleteNpc(id);
        await load();
        return;
      }
    });
  }

  load();
}
