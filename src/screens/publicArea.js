import { supabase } from '../supabaseClient.js';
import { TAG_ICONS, TAGS, TAG_ORDER, escapeHtml, round } from '../shared/gameData.js';
import {
  fetchPublicArea,
  subscribePublicArea,
  createPublicItem,
  updatePublicItem,
  deletePublicItem,
  createPublicContainer,
  updatePublicContainer,
  deletePublicContainer,
  createCompartment,
  updateCompartment,
  deleteCompartment,
  updatePublicCurrency,
  updateCampaignMaxCarga,
  grantCompartmentPermission,
  revokeCompartmentPermission,
  setTransportAdmin,
  getMyCharacter,
  updateCharacterData,
} from '../publicArea.js';

let activeChannel = null;

// Embutida como aba "PÚBLICO" dentro do Baú do Veículo (character.js) — não é
// mais uma tela cheia à parte, então não desenha wrap/header/footer/campaign-strip
// próprios (o character.js já tem os dele em volta).
export function renderPublicAreaScreen(app, { session, profile, campaign }) {
  const campaignId = campaign.id;
  const userId = session.user.id;
  let maxCarga = campaign.max_carga_publico;
  // Embutida na MESMA página que character.js, que usa muitos dos mesmos IDs
  // (f-name, search-input, currency-transfer-btn, etc. — os dois telas
  // compartilham o mesmo formulário de item/recipiente). document.getElementById
  // sempre pegaria o elemento de character.js (primeiro no documento), então
  // toda busca por ID aqui precisa ficar restrita à própria subárvore do embed.
  const $ = (id) => app.querySelector('#' + id);

  if (activeChannel) {
    supabase.removeChannel(activeChannel);
    activeChannel = null;
  }

  let items = [];
  let containers = [];
  let compartments = [];
  let currency = { bronze: 0, silver: 0, gold: 0, platinum: 0 };
  let permissions = [];
  let members = [];
  let myCharacter = null;

  let addMode = null; // 'item' | 'container' | null
  let selectedItemTag = 'outro';
  let selectedContainerTag = 'bolsa';
  let editingItemId = null;
  let editingContainerId = null;
  let openCompartmentForm = false;
  let searchQuery = '';
  let activeTagFilter = null;
  const selectedEntries = new Set();
  const confirmingDeletes = new Set();
  const collapsedContainers = new Set();
  const collapsedCompartments = new Set();
  let accessPanelFor = null;
  let dragSource = null;
  let transferMenuOpen = false;
  let outsideClickBound = false;

  function canManage() {
    return profile.role === 'master' || profile.is_transport_admin;
  }
  function hasCompartmentAccess(compartmentId) {
    if (!compartmentId) return true;
    if (canManage()) return true;
    return permissions.some((p) => p.compartment_id === compartmentId && p.user_id === userId);
  }
  function isLocked(entry) {
    return entry.compartment_id ? !hasCompartmentAccess(entry.compartment_id) : false;
  }

  async function load() {
    const data = await fetchPublicArea(campaignId);
    items = data.items;
    containers = data.containers;
    compartments = data.compartments;
    currency = data.currency;
    permissions = data.permissions;
    members = data.profiles;
    try {
      myCharacter = await getMyCharacter(campaignId, userId);
    } catch (e) {
      myCharacter = null;
    }
    render();
  }

  function itemsById() {
    return new Map(items.map((i) => [i.id, i]));
  }
  function containersById() {
    return new Map(containers.map((c) => [c.id, c]));
  }

  function childrenOf({ containerId = null, compartmentId = null }) {
    const its = items.filter((i) =>
      containerId ? i.container_id === containerId : i.container_id === null && i.compartment_id === compartmentId
    );
    const cts = containers.filter((c) =>
      containerId ? c.parent_container_id === containerId : c.parent_container_id === null && c.compartment_id === compartmentId
    );
    const merged = [
      ...its.map((i) => ({ type: 'item', id: i.id, position: i.position, obj: i })),
      ...cts.map((c) => ({ type: 'container', id: c.id, position: c.position, obj: c })),
    ];
    merged.sort((a, b) => a.position - b.position);
    return merged;
  }

  function effectiveUnitWeight(item) {
    return item.container_id ? Math.floor(item.weight / 2) : item.weight;
  }
  function itemSubtotal(item) {
    return effectiveUnitWeight(item) * item.qty;
  }
  function containerIntrinsicTotal(container) {
    let total = container.own_weight;
    childrenOf({ containerId: container.id }).forEach((entry) => {
      if (entry.type === 'item') total += itemSubtotal(entry.obj);
      else total += Math.floor(containerIntrinsicTotal(entry.obj) / 2);
    });
    return total;
  }
  function scopeWeight(compartmentId) {
    return childrenOf({ containerId: null, compartmentId }).reduce((sum, entry) => {
      if (entry.type === 'item') return sum + itemSubtotal(entry.obj);
      return sum + containerIntrinsicTotal(entry.obj);
    }, 0);
  }
  function publicTotalWeight() {
    let total = scopeWeight(null);
    compartments.forEach((c) => {
      total += scopeWeight(c.id);
    });
    return total;
  }
  function containerUsedSlots(container) {
    return childrenOf({ containerId: container.id }).reduce(
      (sum, entry) => sum + (entry.type === 'item' ? entry.obj.qty : 1),
      0
    );
  }
  function collectDescendantContainerIds(containerId, acc) {
    acc = acc || [];
    containers.filter((c) => c.parent_container_id === containerId).forEach((c) => {
      acc.push(c.id);
      collectDescendantContainerIds(c.id, acc);
    });
    return acc;
  }
  function wouldCreateCycle(draggedContainerId, targetContainerId) {
    if (draggedContainerId === targetContainerId) return true;
    return collectDescendantContainerIds(draggedContainerId).includes(targetContainerId);
  }

  function passesFilter(name, tag) {
    const q = searchQuery.trim().toLowerCase();
    let matchQuery = true;
    if (q) {
      const tagLabel = (TAGS[tag] || TAGS.outro).label.toLowerCase();
      matchQuery = name.toLowerCase().includes(q) || tagLabel.includes(q) || (tag || '').toLowerCase().includes(q);
    }
    let matchTag = true;
    if (activeTagFilter) matchTag = tag === activeTagFilter;
    return matchQuery && matchTag;
  }
  function isFilterActive() {
    return !!(searchQuery.trim() || activeTagFilter);
  }
  function isEntryVisible(entry) {
    if (!isFilterActive()) return true;
    if (entry.type === 'item') return passesFilter(entry.obj.name, entry.obj.tag);
    if (passesFilter(entry.obj.name, entry.obj.tag)) return true;
    return childrenOf({ containerId: entry.obj.id }).some(isEntryVisible);
  }

  // ---- ações de mutação ----
  async function nextPosition({ containerId = null, compartmentId = null }) {
    const entries = childrenOf({ containerId, compartmentId });
    return entries.length === 0 ? 0 : Math.max(...entries.map((e) => e.position)) + 1;
  }

  async function cascadeCompartment(containerId, newCompartmentId) {
    const childItems = items.filter((i) => i.container_id === containerId);
    const childContainers = containers.filter((c) => c.parent_container_id === containerId);
    for (const it of childItems) {
      await updatePublicItem(it.id, { compartment_id: newCompartmentId });
    }
    for (const ct of childContainers) {
      await updatePublicContainer(ct.id, { compartment_id: newCompartmentId });
      await cascadeCompartment(ct.id, newCompartmentId);
    }
  }

  async function moveEntry(type, id, dest) {
    // dest: {containerId} | {compartmentId} | {avulso:true}
    const targetContainerId = dest.containerId || null;
    const targetCompartmentId = dest.containerId
      ? (containersById().get(dest.containerId) || {}).compartment_id || null
      : dest.compartmentId || null;
    const position = await nextPosition({ containerId: targetContainerId, compartmentId: targetCompartmentId });
    if (type === 'item') {
      await updatePublicItem(id, { container_id: targetContainerId, compartment_id: targetCompartmentId, position });
    } else {
      await updatePublicContainer(id, { parent_container_id: targetContainerId, compartment_id: targetCompartmentId, position });
      await cascadeCompartment(id, targetCompartmentId);
    }
    await load();
  }

  async function moveToPersonal(type, id) {
    if (!myCharacter) {
      window.alert('Você precisa ter um personagem nesta campanha pra guardar no Espaço Pessoal.');
      return;
    }
    if (type === 'item') {
      const it = itemsById().get(id);
      const data = myCharacter.data || {};
      const newItem = {
        id: 'pub' + it.id, name: it.name, weight: it.weight, qty: it.qty, tag: it.tag,
        maxUses: it.max_uses, uses: it.uses, durability: it.durability, maxDurability: it.max_durability,
        description: it.description, ammoLinked: false, ammoItemId: null, damage: it.damage, range: it.range,
        pinned: false,
      };
      const newData = {
        ...data,
        items: [...(data.items || []), newItem],
        transportPersonal: [...(data.transportPersonal || []), { type: 'item', id: newItem.id }],
      };
      await updateCharacterData(myCharacter.id, newData);
      await deletePublicItem(id);
    } else {
      // recipientes com filhos não são movidos pro pessoal por enquanto (evita mesclar duas árvores)
      const used = containerUsedSlots(containersById().get(id));
      if (used > 0) {
        window.alert('Esvazie o recipiente antes de devolvê-lo ao Espaço Pessoal.');
        return;
      }
      const c = containersById().get(id);
      const newContainer = {
        id: 'pub' + c.id, name: c.name, ownWeight: c.own_weight, maxSlots: c.max_slots,
        collapsed: false, tag: c.tag, contents: [],
      };
      const data = myCharacter.data || {};
      const newData = {
        ...data,
        containers: [...(data.containers || []), newContainer],
        transportPersonal: [...(data.transportPersonal || []), { type: 'container', id: newContainer.id }],
      };
      await updateCharacterData(myCharacter.id, newData);
      await deletePublicContainer(id);
    }
    await load();
  }

  // ---- render ----
  function render() {
    const maxCargaHtml =
      profile.role === 'master'
        ? `<div class="gauge-bottom"><div class="gauge-max"><label for="public-maxcarga-input">CAPACIDADE MÁX.</label><input type="number" id="public-maxcarga-input" min="0" step="0.5" value="${maxCarga}"></div></div>`
        : '';
    const bodyHtml = `
        ${canManage() ? '<div class="members-panel" id="members-panel"></div>' : ''}

        <div class="currency-wrap" id="currency-wrap" style="display:flex; align-items:flex-start; gap:8px;">
          <button class="currency-strip" id="currency-strip" title="clique para editar as moedas avulsas do público">
            <span class="coin-badge coin-bronze">${coinSvg()}<b id="coin-bronze-val">${currency.bronze}</b></span>
            <span class="coin-badge coin-silver">${coinSvg()}<b id="coin-silver-val">${currency.silver}</b></span>
            <span class="coin-badge coin-gold">${coinSvg()}<b id="coin-gold-val">${currency.gold}</b></span>
            <span class="coin-badge coin-platinum">${coinSvg()}<b id="coin-platinum-val">${currency.platinum}</b></span>
          </button>
          <div class="currency-edit-menu" id="currency-edit-menu" style="display:none;">
            <div class="currency-edit-row"><span class="coin-badge coin-bronze">${coinSvg()}</span><input type="number" id="currency-input-bronze" min="0" step="1" value="${currency.bronze}"></div>
            <div class="currency-edit-row"><span class="coin-badge coin-silver">${coinSvg()}</span><input type="number" id="currency-input-silver" min="0" step="1" value="${currency.silver}"></div>
            <div class="currency-edit-row"><span class="coin-badge coin-gold">${coinSvg()}</span><input type="number" id="currency-input-gold" min="0" step="1" value="${currency.gold}"></div>
            <div class="currency-edit-row"><span class="coin-badge coin-platinum">${coinSvg()}</span><input type="number" id="currency-input-platinum" min="0" step="1" value="${currency.platinum}"></div>
            <div class="currency-hint">100 bronze = 1 prata · 100 prata = 1 ouro · 100 ouro = 1 platina</div>
            <button class="btn" id="currency-save-btn">salvar</button>
          </div>
          <button class="currency-transfer-btn" id="currency-transfer-btn" title="transferir moedas">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 7h13M17 4l3 3-3 3"/><path d="M17 17H4M7 20l-3-3 3-3"/></svg>
          </button>
          <div class="currency-transfer-menu" id="currency-transfer-menu" style="display:${transferMenuOpen ? 'flex' : 'none'};">
            <button type="button" class="icon-btn" id="currency-transfer-close" title="fechar" style="align-self:flex-end;">✕</button>
            <div class="field" style="margin-bottom:8px;"><label style="font-size:9px;">De</label><select class="transfer-select" id="transfer-from-select">${transferOptions()}</select></div>
            <div class="field" style="margin-bottom:8px;"><label style="font-size:9px;">Para</label><select class="transfer-select" id="transfer-to-select">${transferOptions()}</select></div>
            <div class="currency-edit-row"><span class="coin-badge coin-bronze">${coinSvg()}</span><input type="number" id="transfer-input-bronze" min="0" step="1" value="0"></div>
            <div class="currency-edit-row"><span class="coin-badge coin-silver">${coinSvg()}</span><input type="number" id="transfer-input-silver" min="0" step="1" value="0"></div>
            <div class="currency-edit-row"><span class="coin-badge coin-gold">${coinSvg()}</span><input type="number" id="transfer-input-gold" min="0" step="1" value="0"></div>
            <div class="currency-edit-row"><span class="coin-badge coin-platinum">${coinSvg()}</span><input type="number" id="transfer-input-platinum" min="0" step="1" value="0"></div>
            <div class="currency-hint">se faltar de uma moeda específica, quebra as maiores automaticamente.</div>
            <div class="transfer-balance" id="transfer-balance"></div>
            <p class="admin-error" id="transfer-error" style="display:none;"></p>
            <button class="btn" id="currency-transfer-confirm">transferir</button>
          </div>
        </div>

        <div class="gauge-panel" id="gauge-panel">
          <div class="gauge-top">
            <span class="gauge-label">CARGA PÚBLICA TOTAL</span>
            <span class="gauge-readout" id="gauge-readout">${round(publicTotalWeight())} / ${maxCarga} CARGA</span>
          </div>
          ${maxCargaHtml}
        </div>

        <div class="search-toggle-wrap">
          <button class="search-toggle-btn" id="search-toggle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.5-4.5"/></svg>
            <span>Pesquisar / filtrar</span>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <div class="search-panel" id="search-panel">
            <div class="search-panel-inner">
              <div class="search-bar">
                <input type="text" id="search-input" placeholder="pesquisar por nome ou tag..." value="${escapeHtml(searchQuery)}">
                <button class="icon-btn search-clear-btn" id="search-clear" title="limpar pesquisa" style="display:${searchQuery ? 'flex' : 'none'};">✕</button>
              </div>
              <div class="tag-chip-row" id="tag-chip-row"></div>
            </div>
          </div>
        </div>

        <div class="add-trigger-wrap" id="add-trigger-wrap">
          <button class="btn add-trigger-btn" id="add-trigger">+ adicionar</button>
          <div class="add-menu" id="add-menu" style="display:none;">
            <button type="button" data-addmode="item">+ novo item</button>
            <button type="button" data-addmode="container">+ novo recipiente</button>
          </div>
        </div>

        <div id="item-form-slot"></div>
        <div id="container-form-slot"></div>

        <div class="section-hint">Arraste (⋮⋮) pra reordenar, guardar num recipiente, ou mover pra dentro de um compartimento. Compartimentos trancados (🔒) só quem tem acesso mexe.</div>

        <div class="unified-list" id="avulso-list"></div>

        <div class="add-trigger-wrap" id="compartment-trigger-wrap" style="margin-top:20px; ${canManage() ? '' : 'display:none;'}">
          <button class="btn add-trigger-btn" id="compartment-trigger">+ novo compartimento</button>
        </div>
        <div class="add-card" id="compartment-form-wrap" style="display:${openCompartmentForm ? 'block' : 'none'};">
          <div class="add-card-head">
            <h3>// NOVO COMPARTIMENTO</h3>
            <button class="icon-btn" id="compartment-form-close" title="fechar">✕</button>
          </div>
          <div class="field" style="margin-bottom:14px;"><label for="compartment-name-input">Nome</label><input type="text" id="compartment-name-input" placeholder="ex: Ala médica"></div>
          <div class="form-actions"><button class="btn" id="compartment-submit-btn">criar compartimento</button></div>
        </div>

        <div id="compartments-list"></div>
    `;

    app.innerHTML = `
        ${bodyHtml}
        <div class="selection-bar" id="selection-bar" style="display:${selectedEntries.size > 0 ? 'flex' : 'none'};">
          <span class="selection-count" id="selection-count">${selectedEntries.size} selecionado(s)</span>
          <button class="selection-btn" id="batch-move-avulso">→ Avulso</button>
          <button class="selection-btn" id="batch-move-personal">→ Pessoal</button>
          <button class="selection-btn danger" id="batch-delete-btn">Excluir</button>
          <button class="selection-btn cancel-btn" id="batch-cancel-btn">✕</button>
        </div>
      `;

    if (canManage()) renderMembersPanel();
    renderTagChips();
    renderAvulsoList();
    renderCompartmentsList();
    if (addMode === 'item') renderItemForm();
    if (addMode === 'container') renderContainerForm();
    wireStaticHandlers();
    const maxCargaInput = $('public-maxcarga-input');
    if (maxCargaInput) {
      maxCargaInput.addEventListener('change', async () => {
        const value = Math.max(0, parseFloat(maxCargaInput.value) || 0);
        maxCarga = value;
        await updateCampaignMaxCarga(campaignId, value);
        $('gauge-readout').textContent = `${round(publicTotalWeight())} / ${maxCarga} CARGA`;
      });
    }
  }

  function coinSvg() {
    return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/><circle cx="12" cy="12" r="9" fill="none" stroke="rgba(0,0,0,0.28)" stroke-width="1"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="rgba(0,0,0,0.2)" stroke-width="1"/></svg>';
  }

  function transferOptions() {
    const opts = [
      { value: 'avulso', label: 'Avulso' },
      ...(myCharacter ? [{ value: 'personal', label: 'Pessoal' }] : []),
      ...compartments.filter((c) => hasCompartmentAccess(c.id)).map((c) => ({ value: 'comp:' + c.id, label: c.name })),
    ];
    return opts.map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join('');
  }

  function renderMembersPanel() {
    const el = $('members-panel');
    if (!el) return;
    el.innerHTML = `
      <div class="members-panel-head">MEMBROS DA CAMPANHA</div>
      ${members
        .map(
          (m) => `
        <div class="member-row">
          <span>${escapeHtml(m.username)}<span class="member-role-tag">${m.role === 'master' ? 'MESTRE' : 'JOGADOR'}</span></span>
          ${
            m.role === 'master'
              ? ''
              : profile.role === 'master'
              ? `<button type="button" class="access-toggle-btn ${m.is_transport_admin ? 'granted' : ''}" data-toggle-transport-admin="${m.id}" data-current="${m.is_transport_admin}">${m.is_transport_admin ? 'admin do baú ✓' : 'tornar admin do baú'}</button>`
              : m.is_transport_admin
              ? '<span class="member-role-tag">admin do baú</span>'
              : ''
          }
        </div>`
        )
        .join('')}
    `;
    el.querySelectorAll('button[data-toggle-transport-admin]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.toggleTransportAdmin;
        const current = btn.dataset.current === 'true';
        await setTransportAdmin(id, !current);
        await load();
      });
    });
  }

  function renderTagChips() {
    const row = $('tag-chip-row');
    if (!row) return;
    row.innerHTML = TAG_ORDER.map(
      (k) => `<button type="button" class="tag-chip ${activeTagFilter === k ? 'active' : ''}" data-tagfilter="${k}">${TAG_ICONS[k]}<span>${TAGS[k].label}</span></button>`
    ).join('');
  }

  function itemBorderClass(it) {
    if (it.qty <= 0) return 'qty-zero';
    if (it.max_durability !== null && it.max_durability !== undefined) {
      const pct = it.max_durability > 0 ? (it.durability / it.max_durability) * 100 : 0;
      if (pct <= 15) return 'dur-critical';
      if (pct <= 50) return 'dur-warn';
    }
    return '';
  }

  function renderItemInner(it, opts) {
    opts = opts || {};
    const locked = isLocked({ compartment_id: it.compartment_id });
    const unitEff = effectiveUnitWeight(it);
    const subtotal = round(itemSubtotal(it));
    const reducedNote = it.container_id ? ` <span class="reduced">(reduzida de ${round(it.weight)})</span>` : '';
    const hasUses = it.max_uses !== null && it.max_uses !== undefined;
    let usesBadge = '';
    if (hasUses) {
      const usesPct = it.max_uses > 0 ? (it.uses / it.max_uses) * 100 : 0;
      const usesLevel = usesPct <= 15 ? 'critical-level' : usesPct <= 50 ? 'warn-level' : '';
      usesBadge = `
        <div class="ammo-wrap" title="${it.uses}/${it.max_uses} usos">
          <button class="icon-btn" data-action="use-dec" data-id="${it.id}" title="usar 1 carga" ${it.uses <= 0 || locked ? 'disabled' : ''}>−</button>
          <span class="durability-label ${usesLevel}"><b>${it.uses}</b>/${it.max_uses}</span>
          <button class="icon-btn" data-action="use-inc" data-id="${it.id}" title="+1 carga" ${it.uses >= it.max_uses || locked ? 'disabled' : ''}>+</button>
        </div>`;
    }
    const hasDurability = it.max_durability !== null && it.max_durability !== undefined;
    let durabilityHtml = '';
    if (hasDurability) {
      const durPct = it.max_durability > 0 ? Math.max(0, Math.min(100, (it.durability / it.max_durability) * 100)) : 0;
      const durLevel = durPct <= 15 ? 'critical-level' : durPct <= 50 ? 'warn-level' : '';
      durabilityHtml = `
        <div class="durability-wrap" title="durabilidade">
          <button class="durability-btn" data-action="dur-dec" data-id="${it.id}" title="-1 durabilidade" ${it.durability <= 0 || locked ? 'disabled' : ''}>−</button>
          <div class="durability-track"><div class="durability-fill ${durLevel}" style="width:${durPct}%"></div></div>
          <button class="durability-btn" data-action="dur-inc" data-id="${it.id}" title="+1 durabilidade" ${it.durability >= it.max_durability || locked ? 'disabled' : ''}>+</button>
          <span class="durability-label ${durLevel}"><b>${it.durability}</b>/${it.max_durability}</span>
        </div>`;
    }
    const tagIcon = TAG_ICONS[it.tag] || TAG_ICONS.outro;
    const isBroken = hasDurability && it.durability <= 0;
    const descHtml = it.description
      ? `<div class="item-desc-wrap"><div class="item-desc-body open"><div class="item-desc-inner"><div class="item-desc-text">${escapeHtml(it.description)}</div></div></div></div>`
      : '';
    const weaponStatsHtml =
      it.tag === 'arma' && (it.damage || it.range)
        ? `<div class="weapon-stats">
             ${it.damage ? `<span class="weapon-stat-badge" title="dano">${escapeHtml(it.damage)}</span>` : ''}
             ${it.range ? `<span class="weapon-stat-badge" title="alcance">${escapeHtml(it.range)}</span>` : ''}
           </div>`
        : '';
    const itemDeleteConfirming = confirmingDeletes.has('item:' + it.id);
    const lockBadge = locked ? '<span class="locked-badge">🔒 trancado</span>' : '';
    const guardarHtml = opts.nested || locked ? '' : renderGuardarMenu('item', it);
    const extractBtn =
      opts.nested && !locked
        ? `<button class="icon-btn" data-extract data-extract-type="item" data-extract-id="${it.id}" title="tirar do recipiente"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 7l10 10M17 7v6M17 7h-6"/></svg></button>`
        : '';
    const returnBtn =
      !opts.nested && !locked
        ? `<button class="icon-btn" data-return-personal data-return-type="item" data-return-id="${it.id}" title="devolver ao Espaço Pessoal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M7 8V6a5 5 0 0110 0v2"/><rect x="5" y="8" width="14" height="13" rx="2"/></svg></button>`
        : '';

    return `
      <div class="item-main">
        <div class="item-name-row"><span class="tag-icon" title="${TAGS[it.tag] ? TAGS[it.tag].label : ''}">${tagIcon}</span><span class="item-name ${isBroken ? 'item-broken' : ''}">${escapeHtml(it.name)}${isBroken ? ' (quebrado)' : ''}</span>${lockBadge}</div>
        <div class="item-meta"><b>${round(unitEff)}</b> carga cada${reducedNote} &nbsp;·&nbsp; subtotal <b>${subtotal}</b> carga &nbsp;·&nbsp; ${it.qty} slot${it.qty > 1 ? 's' : ''}</div>
        ${weaponStatsHtml}
      </div>
      <div class="item-controls">
        <div class="qty-stepper"><button data-action="dec" data-id="${it.id}" ${locked ? 'disabled' : ''}>−</button><span class="qty-val">${it.qty}</span><button data-action="inc" data-id="${it.id}" ${locked ? 'disabled' : ''}>+</button></div>
        ${usesBadge}${durabilityHtml}${guardarHtml}${extractBtn}${returnBtn}
        ${!locked ? `<button class="icon-btn" data-action="edit" data-id="${it.id}" title="editar">✎</button>` : ''}
        ${!locked ? `<button class="icon-btn danger ${itemDeleteConfirming ? 'confirm-pending' : ''}" data-action="remove" data-id="${it.id}" title="remover">${itemDeleteConfirming ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l4 4L19 6"/></svg>' : '✕'}</button>` : ''}
      </div>
      ${descHtml}`;
  }

  function renderGuardarMenu(type, obj) {
    const compartmentId = obj.compartment_id;
    const available = containers.filter((c) => c.compartment_id === compartmentId && c.id !== (type === 'container' ? obj.id : null));
    const validAvailable =
      type === 'container' ? available.filter((c) => !wouldCreateCycle(obj.id, c.id)) : available;
    if (validAvailable.length === 0) return '';
    const cost = type === 'item' ? obj.qty : 1;
    const options = validAvailable
      .map((c) => {
        const full = containerUsedSlots(c) + cost > c.max_slots;
        return `<button data-guardaraction data-guardar-type="${type}" data-guardar-id="${obj.id}" data-container-id="${c.id}" ${full ? 'disabled' : ''}>${escapeHtml(c.name)}${full ? ' (cheio)' : ''}</button>`;
      })
      .join('');
    const menuKey = type + ':' + obj.id;
    return `<div class="guardar-menu-wrap"><button class="guardar-btn" data-toggle-menu="${menuKey}">guardar em ▾</button>${openMenuFor === menuKey ? `<div class="guardar-menu">${options}</div>` : ''}</div>`;
  }
  let openMenuFor = null;

  function renderEntry(entry, ctx) {
    if (!isEntryVisible(entry)) return '';
    if (entry.type === 'item') {
      return renderItemCard(entry.obj, ctx);
    }
    return renderContainerCard(entry.obj, ctx);
  }

  function renderItemCard(it, ctx) {
    ctx = ctx || {};
    const sel = selectedEntries.has('item:' + it.id) ? 'is-selected' : '';
    if (ctx.nested) {
      return `<div class="nested-item-row ${itemBorderClass(it)} ${sel}" draggable="true" data-entry data-entry-type="item" data-id="${it.id}" data-list="${ctx.listKey}">${renderItemInner(it, { nested: true })}</div>`;
    }
    return `<div class="top-card" draggable="true" data-entry data-entry-type="item" data-id="${it.id}" data-list="${ctx.listKey}"><div class="item-card ${itemBorderClass(it)} ${sel}"><div class="drag-handle" title="arraste">⋮⋮</div>${renderItemInner(it, {})}</div></div>`;
  }

  function renderContainerCard(c, ctx) {
    ctx = ctx || {};
    const nested = !!ctx.nested;
    const locked = isLocked(c);
    const used = containerUsedSlots(c);
    const pct = c.max_slots > 0 ? Math.min(100, (used / c.max_slots) * 100) : 0;
    const total = round(containerIntrinsicTotal(c));
    const children = childrenOf({ containerId: c.id });
    const visibleChildren = children.filter(isEntryVisible);
    let contentsHtml;
    if (children.length === 0) contentsHtml = '<div class="container-empty-txt">vazio — arraste itens ou recipientes para cá</div>';
    else if (isFilterActive() && visibleChildren.length === 0) contentsHtml = '<div class="container-empty-txt">sem resultados aqui</div>';
    else contentsHtml = visibleChildren.map((e) => renderEntry(e, { nested: true, listKey: c.id })).join('');

    const collapsed = collapsedContainers.has(c.id);
    const tagIcon = TAG_ICONS[c.tag] || TAG_ICONS.bolsa;
    const containerDeleteConfirming = confirmingDeletes.has('container:' + c.id);
    const sel = selectedEntries.has('container:' + c.id) ? 'is-selected' : '';
    const lockBadge = locked ? '<span class="locked-badge">🔒 trancado</span>' : '';
    const guardarHtml = nested || locked ? '' : renderGuardarMenu('container', c);
    const extractBtn = nested && !locked
      ? `<button class="icon-btn" data-extract data-extract-type="container" data-extract-id="${c.id}" title="tirar do recipiente pai"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 7l10 10M17 7v6M17 7h-6"/></svg></button>`
      : '';
    const returnBtn = !nested && !locked
      ? `<button class="icon-btn" data-return-personal data-return-type="container" data-return-id="${c.id}" title="devolver ao Espaço Pessoal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M7 8V6a5 5 0 0110 0v2"/><rect x="5" y="8" width="14" height="13" rx="2"/></svg></button>`
      : '';
    const wrapClass = nested ? 'nested-container-card' : 'top-card container-top';
    const headerAttrs = `data-entry data-entry-type="container" data-id="${c.id}" data-list="${ctx.listKey}"`;

    return `
      <div class="${wrapClass}" ${headerAttrs}>
        <div class="container-card ${sel}">
          <div class="container-header" draggable="true" ${headerAttrs}>
            <button class="collapse-toggle ${collapsed ? 'is-collapsed' : ''}" data-caction="toggle" data-id="${c.id}" title="${collapsed ? 'expandir' : 'recolher'}">▾</button>
            <div class="drag-handle">⋮⋮</div>
            <div class="container-name-row"><span class="tag-icon" title="${TAGS[c.tag] ? TAGS[c.tag].label : ''}">${tagIcon}</span><span class="container-name">${escapeHtml(c.name)}</span>${lockBadge}</div>
            <div class="container-actions">${guardarHtml}${extractBtn}${returnBtn}
              ${!locked ? `<button class="icon-btn" data-caction="edit" data-id="${c.id}" title="editar">✎</button>` : ''}
              ${!locked ? `<button class="icon-btn danger ${containerDeleteConfirming ? 'confirm-pending' : ''}" data-caction="remove" data-id="${c.id}" title="remover">${containerDeleteConfirming ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l4 4L19 6"/></svg>' : '✕'}</button>` : ''}
            </div>
          </div>
          <div class="mini-track"><div class="mini-fill" style="width:${pct}%"></div></div>
          <div class="container-meta"><span>${used}/${c.max_slots} slots</span><span><b>${total}</b> carga total</span></div>
          <div class="container-dropzone ${collapsed ? 'is-collapsed' : ''}" data-container-id="${c.id}"><div class="dropzone-inner">${contentsHtml}</div></div>
        </div>
      </div>`;
  }

  function renderAvulsoList() {
    const list = $('avulso-list');
    if (!list) return;
    const entries = childrenOf({ containerId: null, compartmentId: null });
    if (entries.length === 0) {
      list.innerHTML = '<div class="empty-state">NENHUM ITEM OU RECIPIENTE AVULSO<br>use o botão "+ adicionar" acima</div>';
      return;
    }
    const visible = entries.filter(isEntryVisible);
    if (isFilterActive() && visible.length === 0) {
      list.innerHTML = `<div class="filter-empty">NENHUM RESULTADO PARA "${escapeHtml(searchQuery)}"</div>`;
      return;
    }
    list.innerHTML = visible.map((e) => renderEntry(e, { listKey: 'avulso' })).join('');
  }

  function renderCompartmentCard(comp) {
    const collapsed = collapsedCompartments.has(comp.id);
    const locked = !hasCompartmentAccess(comp.id);
    const total = round(scopeWeight(comp.id));
    const entries = childrenOf({ containerId: null, compartmentId: comp.id });
    const visible = entries.filter(isEntryVisible);
    let contentsHtml;
    if (entries.length === 0) contentsHtml = '<div class="container-empty-txt">vazio</div>';
    else if (isFilterActive() && visible.length === 0) contentsHtml = '<div class="container-empty-txt">sem resultados aqui</div>';
    else contentsHtml = visible.map((e) => renderEntry(e, { nested: true, listKey: 'comp:' + comp.id })).join('');

    const deleteKey = 'comp:' + comp.id;
    const deleteConfirming = confirmingDeletes.has(deleteKey);
    const accessOpen = accessPanelFor === comp.id;
    const accessPanel = accessOpen
      ? `<div class="access-panel">
          ${members
            .filter((m) => m.role !== 'master' && !m.is_transport_admin)
            .map((m) => {
              const has = permissions.some((p) => p.compartment_id === comp.id && p.user_id === m.id);
              return `<div class="access-row"><span>${escapeHtml(m.username)}</span><button type="button" class="access-toggle-btn ${has ? 'granted' : ''}" data-toggle-access="${comp.id}" data-user="${m.id}" data-current="${has}">${has ? 'acesso ✓' : 'conceder acesso'}</button></div>`;
            })
            .join('') || '<div class="admin-empty">nenhum jogador comum na campanha</div>'}
        </div>`
      : '';

    return `
      <div class="compartment-card ${locked ? 'is-locked' : ''}" data-compartment-id="${comp.id}">
        <div class="compartment-header">
          <button class="collapse-toggle ${collapsed ? 'is-collapsed' : ''}" data-comp-toggle="${comp.id}" title="${collapsed ? 'expandir' : 'recolher'}">▾</button>
          <div class="compartment-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 11h18"/></svg></div>
          <div class="compartment-name">${escapeHtml(comp.name)}</div>
          ${locked ? '<span class="locked-badge">🔒 trancado</span>' : ''}
          <div class="compartment-actions">
            ${canManage() ? `<button class="icon-btn" data-toggle-access-panel="${comp.id}" title="gerenciar acesso"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="3.2"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/></svg></button>` : ''}
            ${!locked ? `<button class="icon-btn danger ${deleteConfirming ? 'confirm-pending' : ''}" data-comp-remove="${comp.id}" title="excluir compartimento">${deleteConfirming ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l4 4L19 6"/></svg>' : '✕'}</button>` : ''}
          </div>
        </div>
        ${accessPanel}
        <div class="compartment-meta">
          <span><b>${total}</b> carga total dentro</span>
          <span class="compartment-currency" title="moedas deste compartimento (transfira pelo botão de transferir moedas)">
            ${coinSvg()}<b>${comp.currency.bronze}</b>·${coinSvg()}<b>${comp.currency.silver}</b>·${coinSvg()}<b>${comp.currency.gold}</b>·${coinSvg()}<b>${comp.currency.platinum}</b>
          </span>
        </div>
        <div class="container-dropzone ${collapsed ? 'is-collapsed' : ''}" data-container-id="comp:${comp.id}" data-compartment-target="${comp.id}"><div class="dropzone-inner">${contentsHtml}</div></div>
      </div>`;
  }

  function renderCompartmentsList() {
    const el = $('compartments-list');
    if (!el) return;
    el.innerHTML = compartments.map(renderCompartmentCard).join('');
    if (!el.dataset.bound) {
      attachDropHandlers(el);
      bindItemEntryHandlers(el);
      el.dataset.bound = '1';
    }
    el.querySelectorAll('button[data-comp-toggle]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const id = btn.dataset.compToggle;
        collapsedCompartments.has(id) ? collapsedCompartments.delete(id) : collapsedCompartments.add(id);
        renderCompartmentsList();
      })
    );
    el.querySelectorAll('button[data-toggle-access-panel]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const id = btn.dataset.toggleAccessPanel;
        accessPanelFor = accessPanelFor === id ? null : id;
        renderCompartmentsList();
      })
    );
    el.querySelectorAll('button[data-toggle-access]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const compId = btn.dataset.toggleAccess;
        const userIdTarget = btn.dataset.user;
        const has = btn.dataset.current === 'true';
        if (has) await revokeCompartmentPermission(compId, userIdTarget);
        else await grantCompartmentPermission(compId, userIdTarget, userId);
        await load();
      })
    );
    el.querySelectorAll('button[data-comp-remove]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const id = btn.dataset.compRemove;
        const key = 'comp:' + id;
        if (!requestDeleteConfirm(key)) return;
        // devolve conteúdo direto pro avulso
        const directItems = items.filter((i) => i.compartment_id === id && i.container_id === null);
        const directContainers = containers.filter((c) => c.compartment_id === id && c.parent_container_id === null);
        for (const it of directItems) await updatePublicItem(it.id, { compartment_id: null });
        for (const ct of directContainers) {
          await updatePublicContainer(ct.id, { compartment_id: null });
          await cascadeCompartment(ct.id, null);
        }
        const comp = compartments.find((c) => c.id === id);
        if (comp && (comp.currency.bronze || comp.currency.silver || comp.currency.gold || comp.currency.platinum)) {
          const newCur = {
            bronze: currency.bronze + comp.currency.bronze,
            silver: currency.silver + comp.currency.silver,
            gold: currency.gold + comp.currency.gold,
            platinum: currency.platinum + comp.currency.platinum,
          };
          normalizeCurrency(newCur);
          await updatePublicCurrency(campaignId, newCur);
        }
        await deleteCompartment(id);
        await load();
      })
    );
  }

  function requestDeleteConfirm(key) {
    if (confirmingDeletes.has(key)) {
      confirmingDeletes.delete(key);
      return true;
    }
    confirmingDeletes.add(key);
    setTimeout(() => {
      if (confirmingDeletes.has(key)) {
        confirmingDeletes.delete(key);
        renderAvulsoList();
        renderCompartmentsList();
      }
    }, 3000);
    renderAvulsoList();
    renderCompartmentsList();
    return false;
  }

  function normalizeCurrency(c) {
    ['bronze', 'silver', 'gold', 'platinum'].forEach((k) => {
      if (c[k] < 0) c[k] = 0;
    });
    c.silver += Math.floor(c.bronze / 100);
    c.bronze %= 100;
    c.gold += Math.floor(c.silver / 100);
    c.silver %= 100;
    c.platinum += Math.floor(c.gold / 100);
    c.gold %= 100;
  }

  // ---- helpers de moeda compartilhados entre o preview de saldo e a confirmação da transferência ----
  function coinsToBronze(c) {
    return (c?.bronze || 0) + (c?.silver || 0) * 100 + (c?.gold || 0) * 10000 + (c?.platinum || 0) * 1000000;
  }
  function bronzeToCoins(total) {
    total = Math.max(0, Math.round(total));
    const platinum = Math.floor(total / 1000000);
    total %= 1000000;
    const gold = Math.floor(total / 10000);
    total %= 10000;
    const silver = Math.floor(total / 100);
    total %= 100;
    return { bronze: total, silver, gold, platinum };
  }
  function coinsLabel(c) {
    return `${c.bronze}b ${c.silver}s ${c.gold}g ${c.platinum}p`;
  }
  function resolveCurrencyByKey(key) {
    if (key === 'avulso') return currency;
    if (key === 'personal') return myCharacter ? myCharacter.currency : null;
    const comp = compartments.find((c) => 'comp:' + c.id === key);
    return comp ? comp.currency : null;
  }
  // Embutida na mesma página do character.js, que já tem o indicador de
  // status no header (#save-status) — reaproveita em vez de criar outro.
  let flashStatusTimer = null;
  function flashStatus(msg) {
    const el = document.getElementById('save-status');
    if (!el) return;
    el.textContent = 'TERMINAL DE CAMPO // ' + msg;
    clearTimeout(flashStatusTimer);
    flashStatusTimer = setTimeout(() => { el.textContent = 'TERMINAL DE CAMPO // sincronizado'; }, 1800);
  }

  // ---- formulário de item ----
  function renderItemForm() {
    const editing = editingItemId ? itemsById().get(editingItemId) : null;
    const slot = $('item-form-slot');
    slot.innerHTML = `
      <div class="add-card" id="item-form-wrap">
        <div class="add-card-head">
          <h3>${editing ? '// EDITANDO ITEM' : '// REGISTRAR ITEM'}</h3>
          <button class="icon-btn" id="item-form-close" title="fechar">✕</button>
        </div>
        <div class="form-grid">
          <div class="field"><label>Nome</label><input type="text" id="f-name" value="${editing ? escapeHtml(editing.name) : ''}" placeholder="ex: Lanterna de sinal"></div>
          <div class="field"><label>Carga (un.)</label><input type="number" id="f-weight" min="0" step="0.1" value="${editing ? editing.weight : 1}"></div>
          <div class="field"><label>Qtd.</label><input type="number" id="f-qty" min="1" step="1" value="${editing ? editing.qty : 1}"></div>
        </div>
        <div class="field" style="margin-bottom:6px;"><label>Categoria</label></div>
        <div class="tag-picker" id="item-tag-picker"></div>
        <div class="weapon-stats-form-wrap ${selectedItemTag === 'arma' ? 'show' : ''}" id="weapon-stats-form-wrap">
          <div class="field"><label>Dano</label><input type="text" id="f-damage" value="${editing ? editing.damage || '' : ''}" placeholder="ex: 2d6+1"></div>
          <div class="field"><label>Alcance</label><input type="text" id="f-range" value="${editing ? editing.range || '' : ''}" placeholder="ex: 30m"></div>
        </div>
        <div class="uses-row">
          <label class="checkbox-wrap"><input type="checkbox" id="f-has-uses" ${editing && editing.max_uses != null ? 'checked' : ''}> Consumível / com carga de usos</label>
          <div class="uses-input ${editing && editing.max_uses != null ? 'show' : ''}" id="uses-input-wrap"><input type="number" id="f-uses" min="1" step="1" value="${editing && editing.max_uses != null ? editing.max_uses : 1}"><span>usos máx.</span></div>
        </div>
        <div class="uses-row">
          <label class="checkbox-wrap"><input type="checkbox" id="f-has-durability" ${editing && editing.max_durability != null ? 'checked' : ''}> Tem durabilidade</label>
          <div class="uses-input ${editing && editing.max_durability != null ? 'show' : ''}" id="durability-input-wrap">
            <input type="number" id="f-durability-current" min="0" step="1" value="${editing && editing.max_durability != null ? editing.durability : 70}" style="width:56px;">
            <span>/</span>
            <input type="number" id="f-durability-max" min="1" step="1" value="${editing && editing.max_durability != null ? editing.max_durability : 70}" style="width:56px;">
            <span>durabilidade</span>
          </div>
        </div>
        <div class="uses-row">
          <label class="checkbox-wrap"><input type="checkbox" id="f-has-description" ${editing && editing.description ? 'checked' : ''}> Tem descrição</label>
        </div>
        <textarea id="f-description" class="description-textarea" rows="3" placeholder="Descreva o item..." style="display:${editing && editing.description ? 'block' : 'none'}; width:100%; margin-bottom:14px; background:var(--stone-900); border:1px solid var(--stone-line); color:var(--ink); font-family:var(--font-mono); font-size:12.5px; padding:9px 10px; border-radius:5px; resize:vertical;">${editing ? escapeHtml(editing.description || '') : ''}</textarea>
        <div class="form-actions">
          <button class="btn btn-ghost" id="cancel-edit" style="display:${editing ? 'inline-block' : 'none'};">cancelar edição</button>
          <button class="btn" id="submit-item">${editing ? 'salvar alterações' : 'adicionar item'}</button>
        </div>
      </div>
    `;
    if (editing) selectedItemTag = editing.tag;
    renderTagPicker('item-tag-picker', selectedItemTag, (tag) => {
      selectedItemTag = tag;
      $('weapon-stats-form-wrap').classList.toggle('show', tag === 'arma');
    });

    $('item-form-close').addEventListener('click', () => {
      addMode = null;
      editingItemId = null;
      render();
    });
    $('cancel-edit').addEventListener('click', () => {
      editingItemId = null;
      renderItemForm();
    });
    $('f-has-uses').addEventListener('change', (e) => {
      $('uses-input-wrap').classList.toggle('show', e.target.checked);
    });
    $('f-has-durability').addEventListener('change', (e) => {
      $('durability-input-wrap').classList.toggle('show', e.target.checked);
    });
    $('f-has-description').addEventListener('change', (e) => {
      $('f-description').style.display = e.target.checked ? 'block' : 'none';
    });
    $('submit-item').addEventListener('click', async () => {
      const name = $('f-name').value.trim();
      if (!name) return;
      const weight = Math.max(0, parseFloat($('f-weight').value) || 0);
      const qty = Math.max(1, parseInt($('f-qty').value) || 1);
      const hasUses = $('f-has-uses').checked;
      const maxUses = hasUses ? Math.max(1, parseInt($('f-uses').value) || 1) : null;
      const hasDurability = $('f-has-durability').checked;
      const durMax = hasDurability ? Math.max(1, parseInt($('f-durability-max').value) || 1) : null;
      const durCur = hasDurability
        ? Math.max(0, Math.min(durMax, parseInt($('f-durability-current').value) || 0))
        : null;
      const hasDescription = $('f-has-description').checked;
      const description = hasDescription ? $('f-description').value.trim() || null : null;
      const isWeapon = selectedItemTag === 'arma';
      const damage = isWeapon ? $('f-damage').value.trim() || null : null;
      const range = isWeapon ? $('f-range').value.trim() || null : null;

      if (editingItemId) {
        await updatePublicItem(editingItemId, {
          name, weight, qty, tag: selectedItemTag, max_uses: maxUses,
          uses: hasUses ? Math.min(editing.uses ?? maxUses, maxUses) : null,
          max_durability: durMax, durability: durCur, description, damage, range,
        });
        editingItemId = null;
      } else {
        const position = await nextPosition({ containerId: null, compartmentId: null });
        await createPublicItem({
          campaign_id: campaignId, name, weight, qty, tag: selectedItemTag,
          max_uses: maxUses, uses: maxUses, max_durability: durMax, durability: durCur,
          description, damage, range, container_id: null, compartment_id: null, position, updated_by: userId,
        });
      }
      addMode = null;
      await load();
    });
  }

  function renderTagPicker(elId, selected, onPick) {
    const wrap = $(elId);
    wrap.innerHTML = TAG_ORDER.map(
      (k) => `<button type="button" class="tag-pick-btn ${k === selected ? 'selected' : ''}" data-tag="${k}">${TAG_ICONS[k]}<span>${TAGS[k].label}</span></button>`
    ).join('');
    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-tag]');
      if (!btn) return;
      renderTagPicker(elId, btn.dataset.tag, onPick);
      onPick(btn.dataset.tag);
    });
  }

  function renderContainerForm() {
    const editing = editingContainerId ? containersById().get(editingContainerId) : null;
    const slot = $('container-form-slot');
    slot.innerHTML = `
      <div class="add-card" id="container-form-wrap">
        <div class="add-card-head">
          <h3>${editing ? '// EDITANDO RECIPIENTE' : '// NOVO RECIPIENTE'}</h3>
          <button class="icon-btn" id="container-form-close" title="fechar">✕</button>
        </div>
        <div class="form-grid">
          <div class="field"><label>Nome</label><input type="text" id="c-name" value="${editing ? escapeHtml(editing.name) : ''}" placeholder="ex: Baú de ferramentas"></div>
          <div class="field"><label>Carga própria</label><input type="number" id="c-weight" min="0" step="0.1" value="${editing ? editing.own_weight : 1}"></div>
          <div class="field"><label>Slots</label><input type="number" id="c-slots" min="1" step="1" value="${editing ? editing.max_slots : 4}"></div>
        </div>
        <div class="field" style="margin-bottom:6px;"><label>Categoria</label></div>
        <div class="tag-picker" id="container-tag-picker"></div>
        <div class="form-actions">
          <button class="btn btn-ghost" id="cancel-container-edit" style="display:${editing ? 'inline-block' : 'none'};">cancelar edição</button>
          <button class="btn" id="submit-container">${editing ? 'salvar alterações' : 'adicionar recipiente'}</button>
        </div>
      </div>
    `;
    if (editing) selectedContainerTag = editing.tag;
    renderTagPicker('container-tag-picker', selectedContainerTag, (tag) => {
      selectedContainerTag = tag;
    });
    $('container-form-close').addEventListener('click', () => {
      addMode = null;
      editingContainerId = null;
      render();
    });
    $('cancel-container-edit').addEventListener('click', () => {
      editingContainerId = null;
      renderContainerForm();
    });
    $('submit-container').addEventListener('click', async () => {
      const name = $('c-name').value.trim();
      if (!name) return;
      const ownWeight = Math.max(0, parseFloat($('c-weight').value) || 0);
      const maxSlots = Math.max(1, parseInt($('c-slots').value) || 1);
      if (editingContainerId) {
        await updatePublicContainer(editingContainerId, { name, own_weight: ownWeight, max_slots: maxSlots, tag: selectedContainerTag });
        editingContainerId = null;
      } else {
        const position = await nextPosition({ containerId: null, compartmentId: null });
        await createPublicContainer({
          campaign_id: campaignId, name, own_weight: ownWeight, max_slots: maxSlots, tag: selectedContainerTag,
          parent_container_id: null, compartment_id: null, position, updated_by: userId,
        });
      }
      addMode = null;
      await load();
    });
  }

  // ---- handlers estáticos (fora das listas) ----
  function wireStaticHandlers() {
    const addTriggerBtn = $('add-trigger');
    const addMenu = $('add-menu');
    addTriggerBtn.addEventListener('click', () => {
      addMenu.style.display = addMenu.style.display === 'none' ? 'flex' : 'none';
    });
    addMenu.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-addmode]');
      if (!btn) return;
      addMode = btn.dataset.addmode;
      editingItemId = null;
      editingContainerId = null;
      addMenu.style.display = 'none';
      if (addMode === 'item') {
        selectedItemTag = 'outro';
        renderItemForm();
      } else {
        selectedContainerTag = 'bolsa';
        renderContainerForm();
      }
    });

    $('search-toggle').addEventListener('click', () => {
      $('search-panel').classList.toggle('open');
      $('search-toggle').classList.toggle('open');
    });
    const searchInput = $('search-input');
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value;
      renderAvulsoList();
      renderCompartmentsList();
    });
    $('search-clear').addEventListener('click', () => {
      searchQuery = '';
      searchInput.value = '';
      renderAvulsoList();
      renderCompartmentsList();
    });
    $('tag-chip-row').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-tagfilter]');
      if (!btn) return;
      activeTagFilter = activeTagFilter === btn.dataset.tagfilter ? null : btn.dataset.tagfilter;
      renderTagChips();
      renderAvulsoList();
      renderCompartmentsList();
    });

    // moedas avulsas
    const currencyStrip = $('currency-strip');
    const currencyMenu = $('currency-edit-menu');
    currencyStrip.addEventListener('click', () => {
      currencyMenu.style.display = currencyMenu.style.display === 'none' ? 'flex' : 'none';
    });
    $('currency-save-btn').addEventListener('click', async () => {
      const newCur = {
        bronze: Math.max(0, parseInt($('currency-input-bronze').value) || 0),
        silver: Math.max(0, parseInt($('currency-input-silver').value) || 0),
        gold: Math.max(0, parseInt($('currency-input-gold').value) || 0),
        platinum: Math.max(0, parseInt($('currency-input-platinum').value) || 0),
      };
      normalizeCurrency(newCur);
      await updatePublicCurrency(campaignId, newCur);
      await load();
    });

    const transferBtn = $('currency-transfer-btn');
    const transferMenuEl = $('currency-transfer-menu');
    const transferErrorEl = $('transfer-error');
    const transferBalanceEl = $('transfer-balance');
    function updateTransferBalance() {
      const fromKey = $('transfer-from-select').value;
      const from = resolveCurrencyByKey(fromKey);
      const balance = coinsToBronze(from);
      const requested = coinsToBronze({
        bronze: parseInt($('transfer-input-bronze').value) || 0,
        silver: parseInt($('transfer-input-silver').value) || 0,
        gold: parseInt($('transfer-input-gold').value) || 0,
        platinum: parseInt($('transfer-input-platinum').value) || 0,
      });
      const after = balance - requested;
      transferBalanceEl.innerHTML = `
        <span>saldo: <b>${coinsLabel(bronzeToCoins(balance))}</b></span>
        <span class="transfer-balance-arrow">→</span>
        <span class="transfer-balance-after ${after < 0 ? 'negative' : ''}"><b>${coinsLabel(bronzeToCoins(Math.max(0, after)))}</b>${after < 0 ? ' (insuficiente)' : ''}</span>
      `;
    }
    function closeTransferMenu() {
      transferMenuOpen = false;
      transferMenuEl.style.display = 'none';
    }
    transferBtn.addEventListener('click', () => {
      transferMenuOpen = !transferMenuOpen;
      transferMenuEl.style.display = transferMenuOpen ? 'flex' : 'none';
      if (transferMenuOpen) updateTransferBalance();
    });
    $('currency-transfer-close').addEventListener('click', closeTransferMenu);
    // document.addEventListener não é limpo entre renders (o botão/menu são
    // recriados a cada render, mas o document é o mesmo) — anexa só 1 vez
    if (!outsideClickBound) {
      outsideClickBound = true;
      document.addEventListener('click', (e) => {
        if (transferMenuOpen && !e.target.closest('#currency-transfer-menu') && !e.target.closest('#currency-transfer-btn')) closeTransferMenu();
      });
    }
    $('transfer-from-select').addEventListener('change', updateTransferBalance);
    ['bronze', 'silver', 'gold', 'platinum'].forEach((k) => {
      $('transfer-input-' + k).addEventListener('input', updateTransferBalance);
    });
    $('currency-transfer-confirm').addEventListener('click', () => onTransferConfirm(transferErrorEl));

    // compartimentos
    const compartmentTriggerBtn = $('compartment-trigger');
    if (compartmentTriggerBtn) {
      compartmentTriggerBtn.addEventListener('click', () => {
        openCompartmentForm = true;
        $('compartment-trigger-wrap').style.display = 'none';
        $('compartment-form-wrap').style.display = 'block';
        $('compartment-name-input').focus();
      });
    }
    const compartmentClose = $('compartment-form-close');
    if (compartmentClose) {
      compartmentClose.addEventListener('click', () => {
        openCompartmentForm = false;
        $('compartment-trigger-wrap').style.display = 'block';
        $('compartment-form-wrap').style.display = 'none';
      });
    }
    const compartmentSubmit = $('compartment-submit-btn');
    if (compartmentSubmit) {
      compartmentSubmit.addEventListener('click', async () => {
        const input = $('compartment-name-input');
        const name = input.value.trim();
        if (!name) return;
        await createCompartment(campaignId, name, userId);
        openCompartmentForm = false;
        await load();
      });
    }

    // seleção em lote
    $('batch-move-avulso').addEventListener('click', () => batchMove('avulso'));
    $('batch-move-personal').addEventListener('click', () => batchMove('personal'));
    $('batch-delete-btn').addEventListener('click', onBatchDeleteClick);
    $('batch-cancel-btn').addEventListener('click', () => {
      selectedEntries.clear();
      renderAvulsoList();
      renderCompartmentsList();
      updateSelectionBar();
    });

    attachDropHandlers($('avulso-list'));
    bindItemEntryHandlers($('avulso-list'));
    attachAvulsoDrop();
  }

  async function onTransferConfirm(transferErrorEl) {
    transferErrorEl.style.display = 'none';
    const amounts = {
      bronze: Math.max(0, parseInt($('transfer-input-bronze').value) || 0),
      silver: Math.max(0, parseInt($('transfer-input-silver').value) || 0),
      gold: Math.max(0, parseInt($('transfer-input-gold').value) || 0),
      platinum: Math.max(0, parseInt($('transfer-input-platinum').value) || 0),
    };
    const fromKey = $('transfer-from-select').value;
    const toKey = $('transfer-to-select').value;
    const fromLabel = $('transfer-from-select').options[$('transfer-from-select').selectedIndex].textContent;
    const toLabel = $('transfer-to-select').options[$('transfer-to-select').selectedIndex].textContent;
    const requested = coinsToBronze(amounts);

    function showError(msg) {
      transferErrorEl.textContent = msg;
      transferErrorEl.style.display = 'block';
    }

    if (fromKey === toKey) return showError('origem e destino não podem ser os mesmos.');
    if (requested <= 0) return showError('informe algum valor pra transferir.');

    const from = resolveCurrencyByKey(fromKey);
    const to = resolveCurrencyByKey(toKey);
    if (!from || !to) return showError('origem ou destino inválido.');
    if (coinsToBronze(from) < requested) return showError('saldo insuficiente na origem.');

    const newFrom = bronzeToCoins(coinsToBronze(from) - requested);
    const newTo = bronzeToCoins(coinsToBronze(to) + requested);

    async function writeCurrency(key, value) {
      if (key === 'personal') {
        const { error } = await supabase.from('characters').update({ currency: value }).eq('id', myCharacter.id);
        if (error) throw error;
      } else if (key === 'avulso') {
        await updatePublicCurrency(campaignId, value);
      } else {
        const comp = compartments.find((c) => 'comp:' + c.id === key);
        await updateCompartment(comp.id, { currency: value });
      }
    }

    try {
      await writeCurrency(fromKey, newFrom);
      await writeCurrency(toKey, newTo);
    } catch (err) {
      return showError('falha ao transferir (talvez você tenha perdido acesso a um dos dois destinos): ' + err.message);
    }

    transferMenuOpen = false;
    flashStatus(`MOEDAS TRANSFERIDAS: ${fromLabel} → ${toLabel}`);
    await load();
  }

  function updateSelectionBar() {
    const bar = $('selection-bar');
    const countEl = $('selection-count');
    if (!bar) return;
    bar.style.display = selectedEntries.size > 0 ? 'flex' : 'none';
    if (countEl) countEl.textContent = selectedEntries.size + ' selecionado(s)';
  }

  async function batchMove(target) {
    if (selectedEntries.size === 0) return;
    for (const key of selectedEntries) {
      const idx = key.indexOf(':');
      const type = key.slice(0, idx);
      const id = key.slice(idx + 1);
      if (target === 'personal') await moveToPersonal(type, id);
      else await moveEntry(type, id, { avulso: true });
    }
    selectedEntries.clear();
    await load();
  }

  let batchDeleteConfirming = false;
  let batchDeleteTimeout = null;
  function onBatchDeleteClick() {
    const btn = $('batch-delete-btn');
    if (!batchDeleteConfirming) {
      batchDeleteConfirming = true;
      btn.classList.add('confirm-pending');
      btn.textContent = 'confirmar?';
      clearTimeout(batchDeleteTimeout);
      batchDeleteTimeout = setTimeout(() => {
        batchDeleteConfirming = false;
        btn.classList.remove('confirm-pending');
        btn.textContent = 'Excluir';
      }, 3000);
      return;
    }
    clearTimeout(batchDeleteTimeout);
    batchDeleteConfirming = false;
    performBatchDelete();
  }
  async function performBatchDelete() {
    for (const key of selectedEntries) {
      const idx = key.indexOf(':');
      const type = key.slice(0, idx);
      const id = key.slice(idx + 1);
      if (type === 'item') await deletePublicItem(id);
      else await deletePublicContainer(id);
    }
    selectedEntries.clear();
    await load();
  }

  // ---- delegação de cliques (compartilhada entre avulso-list e compartments-list) ----
  function bindItemEntryHandlers(root) {
    root.addEventListener('click', async (e) => {
      if (e.ctrlKey || e.metaKey) {
        const entryEl = e.target.closest('[data-entry]');
        if (entryEl) {
          e.preventDefault();
          const key = entryEl.dataset.entryType + ':' + entryEl.dataset.id;
          selectedEntries.has(key) ? selectedEntries.delete(key) : selectedEntries.add(key);
          renderAvulsoList();
          renderCompartmentsList();
          updateSelectionBar();
          return;
        }
      }
      const returnBtn = e.target.closest('button[data-return-personal]');
      if (returnBtn) {
        await moveToPersonal(returnBtn.dataset.returnType, returnBtn.dataset.returnId);
        return;
      }
      const toggleMenuBtn = e.target.closest('button[data-toggle-menu]');
      if (toggleMenuBtn) {
        openMenuFor = openMenuFor === toggleMenuBtn.dataset.toggleMenu ? null : toggleMenuBtn.dataset.toggleMenu;
        renderAvulsoList();
        renderCompartmentsList();
        return;
      }
      const guardarBtn = e.target.closest('button[data-guardaraction]');
      if (guardarBtn) {
        openMenuFor = null;
        await moveEntry(guardarBtn.dataset.guardarType, guardarBtn.dataset.guardarId, { containerId: guardarBtn.dataset.containerId });
        return;
      }
      const toggleBtn = e.target.closest('button[data-caction="toggle"]');
      if (toggleBtn) {
        const id = toggleBtn.dataset.id;
        collapsedContainers.has(id) ? collapsedContainers.delete(id) : collapsedContainers.add(id);
        renderAvulsoList();
        renderCompartmentsList();
        return;
      }
      const cActionBtn = e.target.closest('button[data-caction]');
      if (cActionBtn) {
        const id = cActionBtn.dataset.id;
        const action = cActionBtn.dataset.caction;
        if (action === 'edit') {
          editingContainerId = id;
          addMode = 'container';
          render();
          return;
        }
        if (action === 'remove') {
          if (!requestDeleteConfirm('container:' + id)) return;
          await deletePublicContainer(id);
          await load();
        }
        return;
      }
      const extractBtn = e.target.closest('button[data-extract]');
      if (extractBtn) {
        const type = extractBtn.dataset.extractType;
        const id = extractBtn.dataset.extractId;
        const obj = type === 'item' ? itemsById().get(id) : containersById().get(id);
        const parentContainer = containersById().get(type === 'item' ? obj.container_id : obj.parent_container_id);
        const grandParentId = parentContainer ? parentContainer.parent_container_id : null;
        await moveEntry(type, id, grandParentId ? { containerId: grandParentId } : { compartmentId: obj.compartment_id });
        return;
      }
      const actionBtn = e.target.closest('button[data-action]');
      if (actionBtn) {
        const id = actionBtn.dataset.id;
        const action = actionBtn.dataset.action;
        const it = itemsById().get(id);
        if (!it) return;
        if (action === 'inc') {
          const parent = it.container_id ? containersById().get(it.container_id) : null;
          if (parent && containerUsedSlots(parent) + 1 > parent.max_slots) return;
          await updatePublicItem(id, { qty: it.qty + 1 });
        }
        if (action === 'dec') {
          if (it.qty - 1 <= 0) await deletePublicItem(id);
          else await updatePublicItem(id, { qty: it.qty - 1 });
        }
        if (action === 'use-dec' && it.uses > 0) await updatePublicItem(id, { uses: it.uses - 1 });
        if (action === 'use-inc' && it.uses < it.max_uses) await updatePublicItem(id, { uses: it.uses + 1 });
        if (action === 'dur-dec' && it.durability > 0) await updatePublicItem(id, { durability: it.durability - 1 });
        if (action === 'dur-inc' && it.durability < it.max_durability) await updatePublicItem(id, { durability: it.durability + 1 });
        if (action === 'edit') {
          editingItemId = id;
          addMode = 'item';
          render();
          return;
        }
        if (action === 'remove') {
          if (!requestDeleteConfirm('item:' + id)) return;
          await deletePublicItem(id);
        }
        await load();
      }
    });
  }

  // ---- drag and drop ----
  function attachDropHandlers(listEl) {
    if (!listEl) return;
    listEl.addEventListener('dragstart', (e) => {
      const draggableEl = e.target.closest('[draggable="true"]');
      if (!draggableEl) return;
      const entryEl = draggableEl.closest('[data-entry]');
      if (!entryEl) return;
      dragSource = { type: entryEl.dataset.entryType, id: entryEl.dataset.id };
      e.dataTransfer.effectAllowed = 'move';
      entryEl.classList.add('dragging');
    });
    listEl.addEventListener('dragend', () => {
      document.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
      document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
    });
    listEl.addEventListener('dragover', (e) => {
      if (!dragSource) return;
      const dropzone = e.target.closest('.container-dropzone');
      if (dropzone) {
        const containerId = dropzone.dataset.containerId;
        if (containerId && containerId.startsWith('comp:')) {
          const compId = dropzone.dataset.compartmentTarget;
          if (!hasCompartmentAccess(compId)) return;
        } else if (dragSource.type === 'container' && wouldCreateCycle(dragSource.id, containerId)) {
          return;
        }
        e.preventDefault();
        document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
        dropzone.classList.add('drag-over');
      }
    });
    listEl.addEventListener('drop', async (e) => {
      if (!dragSource) return;
      const dropzone = e.target.closest('.container-dropzone');
      if (!dropzone) return;
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      const containerId = dropzone.dataset.containerId;
      const { type, id } = dragSource;
      dragSource = null;
      if (containerId.startsWith('comp:')) {
        const compId = dropzone.dataset.compartmentTarget;
        if (!hasCompartmentAccess(compId)) return;
        await moveEntry(type, id, { compartmentId: compId });
      } else {
        if (type === 'container' && wouldCreateCycle(id, containerId)) return;
        const target = containersById().get(containerId);
        const cost = type === 'item' ? itemsById().get(id).qty : 1;
        if (containerUsedSlots(target) + cost > target.max_slots) {
          window.alert('Recipiente cheio.');
          return;
        }
        await moveEntry(type, id, { containerId });
      }
    });
  }

  // avulso também é um alvo de drop (mover pra fora de tudo)
  function attachAvulsoDrop() {
    const list = $('avulso-list');
    if (!list) return;
    list.addEventListener('dragover', (e) => {
      if (!dragSource) return;
      if (e.target.closest('.container-dropzone')) return;
      e.preventDefault();
    });
    list.addEventListener('drop', async (e) => {
      if (!dragSource || e.target.closest('.container-dropzone')) return;
      e.preventDefault();
      const { type, id } = dragSource;
      dragSource = null;
      await moveEntry(type, id, { avulso: true });
    });
  }

  // debounce: cada mutação nossa já chama load() diretamente (fica rápido pra
  // quem agiu); sem isso, o eco da própria escrita chegando pelo Realtime
  // dispara um SEGUNDO load()+render() completo logo em seguida, e se isso cair
  // no meio de alguém preenchendo um formulário (ex: transferir moeda pra um
  // compartimento), o DOM é reconstruído do zero e o que a pessoa tinha
  // digitado/selecionado some. Um atraso curto + coalescer rajadas resolve.
  let realtimeReloadTimer = null;
  load().then(() => {
    activeChannel = subscribePublicArea(campaignId, () => {
      clearTimeout(realtimeReloadTimer);
      realtimeReloadTimer = setTimeout(() => { load(); }, 700);
    });
  });
}
