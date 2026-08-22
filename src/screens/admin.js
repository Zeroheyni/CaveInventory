import { signOut } from '../auth.js';
import {
  listAllCampaigns,
  listAllProfiles,
  listCharactersInCampaign,
  createCampaignAsAdmin,
  deleteCampaignAsAdmin,
} from '../admin.js';
import { renderCharacterScreen } from './character.js';

export function renderAdminScreen(app, { session, profile }) {
  let campaigns = [];
  let profilesById = new Map();
  let expanded = new Set(); // ids de campanhas com a lista de personagens aberta
  let charactersByCampaign = new Map();
  let confirmingDelete = null;

  async function load() {
    const [camps, profs] = await Promise.all([listAllCampaigns(), listAllProfiles()]);
    campaigns = camps;
    profilesById = new Map(profs.map((p) => [p.id, p]));
    charactersByCampaign.clear();
    render();
  }

  function memberCount(campaignId) {
    let n = 0;
    for (const p of profilesById.values()) if (p.campaign_id === campaignId) n += 1;
    return n;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  function render() {
    app.innerHTML = `
      <div class="wrap admin-wrap">
        <div class="admin-header">
          <div class="title"><span class="dot"></span>PAINEL DO MESTRE GLOBAL</div>
          <button type="button" class="campaign-strip-signout" id="admin-signout">sair</button>
        </div>

        <div class="admin-card">
          <h3 class="admin-card-title">+ Nova campanha</h3>
          <div class="admin-new-row">
            <input type="text" id="admin-new-name" placeholder="Nome da campanha" />
            <button type="button" class="btn" id="admin-create-btn">criar</button>
          </div>
          <p class="admin-error" id="admin-error" style="display:none;"></p>
        </div>

        <div class="admin-list" id="admin-list"></div>
      </div>
    `;

    document.getElementById('admin-signout').addEventListener('click', async () => {
      await signOut();
      window.location.reload();
    });

    document.getElementById('admin-create-btn').addEventListener('click', async () => {
      const input = document.getElementById('admin-new-name');
      const name = input.value.trim();
      if (!name) {
        input.focus();
        return;
      }
      const errorEl = document.getElementById('admin-error');
      try {
        await createCampaignAsAdmin(name);
        input.value = '';
        errorEl.style.display = 'none';
        await load();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
      }
    });

    renderList();
  }

  function renderList() {
    const listEl = document.getElementById('admin-list');
    if (!listEl) return;

    if (campaigns.length === 0) {
      listEl.innerHTML = '<p class="admin-empty">Nenhuma campanha criada ainda.</p>';
      return;
    }

    listEl.innerHTML = campaigns
      .map((c) => {
        const isOpen = expanded.has(c.id);
        const isConfirming = confirmingDelete === c.id;
        const created = new Date(c.created_at).toLocaleDateString('pt-BR');
        return `
          <div class="admin-campaign-card">
            <div class="admin-campaign-head">
              <div>
                <div class="admin-campaign-name">${escapeHtml(c.name)}</div>
                <div class="admin-campaign-meta">código <b>${escapeHtml(c.invite_code)}</b> · ${memberCount(c.id)} membro(s) · criada em ${created}</div>
              </div>
              <div class="admin-campaign-actions">
                <button type="button" class="btn btn-ghost" data-view-campaign="${c.id}">${isOpen ? 'fechar' : 'ver personagens'}</button>
                <button type="button" class="admin-danger-btn ${isConfirming ? 'confirm-pending' : ''}" data-delete-campaign="${c.id}">${isConfirming ? 'confirmar?' : 'excluir'}</button>
              </div>
            </div>
            ${isOpen ? `<div class="admin-character-list" id="admin-chars-${c.id}"><p class="admin-empty">Carregando...</p></div>` : ''}
          </div>
        `;
      })
      .join('');

    listEl.querySelectorAll('button[data-view-campaign]').forEach((btn) => {
      btn.addEventListener('click', () => toggleCampaign(btn.dataset.viewCampaign));
    });
    listEl.querySelectorAll('button[data-delete-campaign]').forEach((btn) => {
      btn.addEventListener('click', () => onDeleteClick(btn.dataset.deleteCampaign));
    });

    expanded.forEach((campaignId) => {
      if (campaigns.some((c) => c.id === campaignId)) renderCharacterList(campaignId);
    });
  }

  async function toggleCampaign(campaignId) {
    if (expanded.has(campaignId)) {
      expanded.delete(campaignId);
      renderList();
      return;
    }
    expanded.add(campaignId);
    renderList();
    await renderCharacterList(campaignId);
  }

  async function renderCharacterList(campaignId) {
    let characters = charactersByCampaign.get(campaignId);
    if (!characters) {
      characters = await listCharactersInCampaign(campaignId);
      charactersByCampaign.set(campaignId, characters);
    }
    const el = document.getElementById('admin-chars-' + campaignId);
    if (!el) return;
    const campaign = campaigns.find((c) => c.id === campaignId);

    if (characters.length === 0) {
      el.innerHTML = '<p class="admin-empty">Ninguém criou personagem nesta campanha ainda.</p>';
      return;
    }

    el.innerHTML = characters
      .map((ch) => {
        const owner = profilesById.get(ch.owner_id);
        const ownerLabel = owner ? owner.username : 'jogador desconhecido';
        return `
          <div class="admin-character-row">
            <span>${escapeHtml(ch.name || 'Personagem')} <span class="admin-owner-tag">(${escapeHtml(ownerLabel)})</span></span>
            <button type="button" class="btn btn-ghost" data-open-character="${ch.id}" data-owner-name="${escapeHtml(ownerLabel)}">abrir inventário</button>
          </div>
        `;
      })
      .join('');

    el.querySelectorAll('button[data-open-character]').forEach((btn) => {
      btn.addEventListener('click', () => {
        renderCharacterScreen(app, {
          session,
          profile,
          campaign,
          characterId: btn.dataset.openCharacter,
          ownerName: btn.dataset.ownerName,
          onBack: () => load(),
        });
      });
    });
  }

  let deleteConfirmTimeout = null;
  function onDeleteClick(campaignId) {
    if (confirmingDelete === campaignId) {
      clearTimeout(deleteConfirmTimeout);
      confirmingDelete = null;
      deleteCampaignAsAdmin(campaignId)
        .then(load)
        .catch((err) => window.alert('Erro ao excluir: ' + err.message));
      return;
    }
    confirmingDelete = campaignId;
    renderList();
    clearTimeout(deleteConfirmTimeout);
    deleteConfirmTimeout = setTimeout(() => {
      confirmingDelete = null;
      renderList();
    }, 3000);
  }

  load();
}
