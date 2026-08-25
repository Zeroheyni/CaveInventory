import { signOut } from '../auth.js';
import { supabase } from '../supabaseClient.js';
import { padPassword } from '../nickname.js';
import {
  listAllCampaigns,
  listAllProfiles,
  listCharactersInCampaign,
  createCampaignAsAdmin,
  deleteCampaignAsAdmin,
  createPlayerAccount,
  listDiscordConfigs,
  setCampaignDiscordChannel,
  listCharacterDiscordConfigs,
  setCharacterDiscordChannel,
  deletePlayerAccount,
  setCampaignLiveSession,
} from '../admin.js';
import { renderCharacterScreen } from './character.js';
import { renderMasterCampaignHub } from './masterCampaignHub.js';

export function renderAdminScreen(app, { session, profile }) {
  let campaigns = [];
  let profilesById = new Map();
  let expanded = new Set(); // ids de campanhas com a lista de personagens aberta
  let charactersByCampaign = new Map();
  let confirmingDelete = null;
  let confirmingDeleteCharacter = null;
  let deleteStage = null; // { kind: 'campaign'|'character', id, campaignId, error } -- passo final (senha) antes de excluir de verdade
  let syncingLiveSession = null;
  let lastCreatedAccount = null;
  let discordChannelByCampaign = new Map();
  let discordChannelByCharacter = new Map();

  async function load() {
    const [camps, profs, discordConfigs] = await Promise.all([listAllCampaigns(), listAllProfiles(), listDiscordConfigs()]);
    campaigns = camps;
    profilesById = new Map(profs.map((p) => [p.id, p]));
    discordChannelByCampaign = new Map(discordConfigs.map((c) => [c.campaign_id, c.channel_id]));
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

  // último passo antes de excluir campanha/conta pra valer -- depois dos
  // 2 cliques, pede a senha do mestre global de novo (revalida contra o
  // Supabase Auth) e só exclui depois de confirmar aqui.
  function deleteGateBox(kind, id) {
    if (!deleteStage || deleteStage.kind !== kind || deleteStage.id !== id) return '';
    return `
      <div class="admin-delete-gate">
        <p class="admin-delete-gate-warn">⚠ essa ação não pode ser desfeita. digite sua senha de mestre pra confirmar.</p>
        <input type="password" class="admin-delete-gate-pass" data-delete-gate-pass="${kind}:${id}" placeholder="sua senha" autocomplete="current-password">
        ${deleteStage.error ? `<p class="admin-error" style="display:block;">${escapeHtml(deleteStage.error)}</p>` : ''}
        <div class="admin-delete-gate-actions">
          <button type="button" class="admin-danger-btn" data-delete-gate-confirm="${kind}:${id}">tenho certeza — excluir</button>
          <button type="button" class="btn btn-ghost" data-delete-gate-cancel="${kind}:${id}">cancelar</button>
        </div>
      </div>`;
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

        <div class="admin-card">
          <h3 class="admin-card-title">+ Nova conta de jogador</h3>
          ${
            lastCreatedAccount
              ? `
            <div class="admin-success">
              <p>Conta criada! Passe pro seu amigo:</p>
              <p><b>apelido:</b> ${escapeHtml(lastCreatedAccount.nickname)} &nbsp; <b>senha:</b> ${escapeHtml(lastCreatedAccount.password)}</p>
              <button type="button" class="btn btn-ghost" id="account-success-dismiss">ok, entendi</button>
            </div>
          `
              : ''
          }
          ${
            campaigns.length === 0
              ? '<p class="admin-empty">Crie uma campanha primeiro.</p>'
              : `
            <div class="form-grid" style="margin-bottom:12px;">
              <div class="field"><label>Apelido</label><input type="text" id="account-nickname" placeholder="ex: João" /></div>
              <div class="field"><label>Senha</label><input type="text" id="account-password" placeholder="ex: 1234" /></div>
              <div class="field">
                <label>Campanha</label>
                <select id="account-campaign">${campaigns.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</select>
              </div>
            </div>
            <button type="button" class="btn" id="account-create-btn">criar conta</button>
          `
          }
          <p class="admin-error" id="account-error" style="display:none;"></p>
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

    const accountSuccessDismiss = document.getElementById('account-success-dismiss');
    if (accountSuccessDismiss) {
      accountSuccessDismiss.addEventListener('click', () => {
        lastCreatedAccount = null;
        render();
      });
    }

    const accountCreateBtn = document.getElementById('account-create-btn');
    if (accountCreateBtn) {
      accountCreateBtn.addEventListener('click', async () => {
        const nicknameInput = document.getElementById('account-nickname');
        const passwordInput = document.getElementById('account-password');
        const campaignSelect = document.getElementById('account-campaign');
        const errorEl = document.getElementById('account-error');
        errorEl.style.display = 'none';

        const nickname = nicknameInput.value.trim();
        const password = passwordInput.value;
        if (!nickname || !password) {
          errorEl.textContent = 'Preencha apelido e senha.';
          errorEl.style.display = 'block';
          return;
        }
        try {
          await createPlayerAccount(nickname, password, campaignSelect.value);
          charactersByCampaign.delete(campaignSelect.value);
          lastCreatedAccount = { nickname, password };
          await load();
        } catch (err) {
          errorEl.textContent = err.message;
          errorEl.style.display = 'block';
        }
      });
    }

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
                <button type="button" class="btn btn-ghost" data-open-combat="${c.id}">⚔ combate</button>
                <button type="button" class="btn btn-ghost" data-open-ficha-campaign="${c.id}">📋 fichas</button>
                <button type="button" class="btn btn-ghost" data-view-campaign="${c.id}">${isOpen ? 'fechar' : 'ver personagens'}</button>
                <button type="button" class="admin-danger-btn ${isConfirming ? 'confirm-pending' : ''}" data-delete-campaign="${c.id}">${isConfirming ? 'confirmar?' : 'excluir'}</button>
              </div>
            </div>
            ${deleteGateBox('campaign', c.id)}
            <div class="admin-discord-row">
              <label>🤖 Canal do Discord (transporte público)</label>
              <input type="text" class="admin-discord-input" data-discord-campaign="${c.id}" placeholder="ID do canal" value="${escapeHtml(discordChannelByCampaign.get(c.id) || '')}" />
              <button type="button" class="btn btn-ghost" data-save-discord-campaign="${c.id}">vincular</button>
              <span class="admin-discord-feedback" data-discord-feedback-campaign="${c.id}"></span>
            </div>
            <div class="admin-discord-row">
              <label>🎲 Sessão do Discord</label>
              <button type="button" class="btn ${c.discord_live_session ? 'btn-live-session' : 'btn-ghost'}" data-toggle-live-session="${c.id}" data-live="${c.discord_live_session}" ${syncingLiveSession === c.id ? 'disabled' : ''} title="em sessão, o Discord atualiza em tempo real a cada mudança; fora de sessão, só atualiza quando alguém clica em 🔄 atualizar">
                ${syncingLiveSession === c.id ? 'sincronizando tudo...' : (c.discord_live_session ? '🟢 em sessão (tempo real)' : '⚪ fora de sessão (só no 🔄 atualizar)')}
              </button>
              <span class="admin-discord-feedback" data-live-session-feedback="${c.id}"></span>
            </div>
            ${isOpen ? `<div class="admin-character-list" id="admin-chars-${c.id}"><p class="admin-empty">Carregando...</p></div>` : ''}
          </div>
        `;
      })
      .join('');

    listEl.querySelectorAll('button[data-open-combat]').forEach((btn) => {
      btn.addEventListener('click', () => onOpenCombat(btn.dataset.openCombat));
    });
    listEl.querySelectorAll('button[data-open-ficha-campaign]').forEach((btn) => {
      btn.addEventListener('click', () => onOpenFicha(btn.dataset.openFichaCampaign));
    });
    listEl.querySelectorAll('button[data-view-campaign]').forEach((btn) => {
      btn.addEventListener('click', () => toggleCampaign(btn.dataset.viewCampaign));
    });
    listEl.querySelectorAll('button[data-delete-campaign]').forEach((btn) => {
      btn.addEventListener('click', () => onDeleteClick(btn.dataset.deleteCampaign));
    });
    listEl.querySelectorAll('button[data-delete-gate-confirm]').forEach((btn) => {
      btn.addEventListener('click', () => onDeleteGateConfirm(btn.dataset.deleteGateConfirm));
    });
    listEl.querySelectorAll('button[data-delete-gate-cancel]').forEach((btn) => {
      btn.addEventListener('click', () => {
        deleteStage = null;
        renderList();
      });
    });
    listEl.querySelectorAll('button[data-save-discord-campaign]').forEach((btn) => {
      btn.addEventListener('click', () => onSaveCampaignDiscord(btn.dataset.saveDiscordCampaign));
    });
    listEl.querySelectorAll('button[data-toggle-live-session]').forEach((btn) => {
      btn.addEventListener('click', () => onToggleLiveSession(btn.dataset.toggleLiveSession, btn.dataset.live !== 'true'));
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

    const discordConfigs = await listCharacterDiscordConfigs(characters.map((ch) => ch.id));
    discordConfigs.forEach((c) => discordChannelByCharacter.set(c.character_id, c.channel_id));

    el.innerHTML = characters
      .map((ch) => {
        const owner = profilesById.get(ch.owner_id);
        const ownerLabel = owner ? owner.username : 'jogador desconhecido';
        const isConfirmingChar = confirmingDeleteCharacter === ch.id;
        return `
          <div class="admin-character-row">
            <span>${escapeHtml(ch.name || 'Personagem')} <span class="admin-owner-tag">(${escapeHtml(ownerLabel)})</span></span>
            <div style="display:flex; gap:6px;">
              <button type="button" class="btn btn-ghost" data-open-character="${ch.id}" data-owner-name="${escapeHtml(ownerLabel)}">abrir inventário</button>
              <button type="button" class="admin-danger-btn ${isConfirmingChar ? 'confirm-pending' : ''}" data-delete-character="${ch.id}" title="excluir a conta de ${escapeHtml(ownerLabel)} (apelido, senha e personagem — não dá pra desfazer)">${isConfirmingChar ? 'confirmar?' : 'excluir conta'}</button>
            </div>
          </div>
          ${deleteGateBox('character', ch.id)}
          <div class="admin-discord-row">
            <label>🤖 Canal do Discord (inventário)</label>
            <input type="text" class="admin-discord-input" data-discord-character="${ch.id}" placeholder="ID do canal" value="${escapeHtml(discordChannelByCharacter.get(ch.id) || '')}" />
            <button type="button" class="btn btn-ghost" data-save-discord-character="${ch.id}">vincular</button>
            <span class="admin-discord-feedback" data-discord-feedback-character="${ch.id}"></span>
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
    el.querySelectorAll('button[data-save-discord-character]').forEach((btn) => {
      btn.addEventListener('click', () => onSaveCharacterDiscord(btn.dataset.saveDiscordCharacter));
    });
    el.querySelectorAll('button[data-delete-character]').forEach((btn) => {
      btn.addEventListener('click', () => onDeleteCharacterClick(campaignId, btn.dataset.deleteCharacter));
    });
    el.querySelectorAll('button[data-delete-gate-confirm]').forEach((btn) => {
      btn.addEventListener('click', () => onDeleteGateConfirm(btn.dataset.deleteGateConfirm));
    });
    el.querySelectorAll('button[data-delete-gate-cancel]').forEach((btn) => {
      btn.addEventListener('click', () => {
        deleteStage = null;
        renderCharacterList(campaignId);
      });
    });
  }

  function onOpenCombat(campaignId) {
    const campaign = campaigns.find((c) => c.id === campaignId);
    if (!campaign) return;
    renderMasterCampaignHub(app, { session, profile, campaign, initialMode: 'combat', onBack: () => renderAdminScreen(app, { session, profile }) });
  }

  function onOpenFicha(campaignId) {
    const campaign = campaigns.find((c) => c.id === campaignId);
    if (!campaign) return;
    renderMasterCampaignHub(app, { session, profile, campaign, initialMode: 'ficha', onBack: () => renderAdminScreen(app, { session, profile }) });
  }

  async function onToggleLiveSession(campaignId, live) {
    const feedback = document.querySelector(`span[data-live-session-feedback="${campaignId}"]`);
    if (live) {
      syncingLiveSession = campaignId;
      renderList();
    }
    try {
      await setCampaignLiveSession(campaignId, live);
      const c = campaigns.find((camp) => camp.id === campaignId);
      if (c) c.discord_live_session = live;
      syncingLiveSession = null;
      renderList();
      if (live) {
        const freshFeedback = document.querySelector(`span[data-live-session-feedback="${campaignId}"]`);
        if (freshFeedback) freshFeedback.textContent = 'sincronizado ✓';
      }
    } catch (err) {
      syncingLiveSession = null;
      renderList();
      if (feedback) feedback.textContent = 'erro: ' + err.message;
      else window.alert('Erro ao mudar sessão do Discord: ' + err.message);
    }
  }

  async function onSaveCampaignDiscord(campaignId) {
    const input = document.querySelector(`input[data-discord-campaign="${campaignId}"]`);
    const feedback = document.querySelector(`span[data-discord-feedback-campaign="${campaignId}"]`);
    const channelId = input.value.trim();
    if (!channelId) { input.focus(); return; }
    feedback.textContent = 'vinculando...';
    try {
      await setCampaignDiscordChannel(campaignId, channelId);
      discordChannelByCampaign.set(campaignId, channelId);
      feedback.textContent = 'vinculado ✓';
    } catch (err) {
      feedback.textContent = 'erro: ' + err.message;
    }
  }

  async function onSaveCharacterDiscord(characterId) {
    const input = document.querySelector(`input[data-discord-character="${characterId}"]`);
    const feedback = document.querySelector(`span[data-discord-feedback-character="${characterId}"]`);
    const channelId = input.value.trim();
    if (!channelId) { input.focus(); return; }
    feedback.textContent = 'vinculando...';
    try {
      await setCharacterDiscordChannel(characterId, channelId);
      discordChannelByCharacter.set(characterId, channelId);
      feedback.textContent = 'vinculado ✓';
    } catch (err) {
      feedback.textContent = 'erro: ' + err.message;
    }
  }

  let deleteConfirmTimeout = null;
  function onDeleteClick(campaignId) {
    if (confirmingDelete === campaignId) {
      clearTimeout(deleteConfirmTimeout);
      confirmingDelete = null;
      deleteStage = { kind: 'campaign', id: campaignId, error: '' };
      renderList();
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

  let deleteCharacterConfirmTimeout = null;
  function onDeleteCharacterClick(campaignId, characterId) {
    if (confirmingDeleteCharacter === characterId) {
      clearTimeout(deleteCharacterConfirmTimeout);
      confirmingDeleteCharacter = null;
      deleteStage = { kind: 'character', id: characterId, campaignId, error: '' };
      renderCharacterList(campaignId);
      return;
    }
    confirmingDeleteCharacter = characterId;
    renderCharacterList(campaignId);
    clearTimeout(deleteCharacterConfirmTimeout);
    deleteCharacterConfirmTimeout = setTimeout(() => {
      confirmingDeleteCharacter = null;
      renderCharacterList(campaignId);
    }, 3000);
  }

  async function onDeleteGateConfirm(encoded) {
    const sepIndex = encoded.indexOf(':');
    const kind = encoded.slice(0, sepIndex);
    const id = encoded.slice(sepIndex + 1);
    if (!deleteStage || deleteStage.kind !== kind || deleteStage.id !== id) return;
    const passInput = document.querySelector(`input[data-delete-gate-pass="${kind}:${id}"]`);
    const password = passInput ? passInput.value : '';
    const rerenderGate = () => (kind === 'campaign' ? renderList() : renderCharacterList(deleteStage.campaignId));

    if (!password) {
      deleteStage = { ...deleteStage, error: 'digite sua senha.' };
      rerenderGate();
      return;
    }
    const { error: authError } = await supabase.auth.signInWithPassword({ email: session.user.email, password: padPassword(password) });
    if (authError) {
      deleteStage = { ...deleteStage, error: 'senha incorreta.' };
      rerenderGate();
      return;
    }

    const campaignIdForChar = deleteStage.campaignId;
    deleteStage = null;
    try {
      if (kind === 'campaign') {
        await deleteCampaignAsAdmin(id);
      } else {
        await deletePlayerAccount(id);
        charactersByCampaign.delete(campaignIdForChar);
      }
      await load();
    } catch (err) {
      window.alert('Erro ao excluir: ' + err.message);
    }
  }

  load();
}
