import { signOut } from '../auth.js';
import { supabase } from '../supabaseClient.js';
import { padPassword } from '../nickname.js';
import {
  listAllCampaigns,
  listAllProfiles,
  listCharactersInCampaign,
  createCampaignAsAdmin,
  deleteCampaignAsAdmin,
  listDiscordConfigs,
  setCampaignDiscordChannel,
  setCampaignCombatChannel,
  listCharacterDiscordConfigs,
  setCharacterDiscordChannel,
  setPlayerDiscordUserId,
  setCampaignLiveSession,
  countMembersByCampaign,
} from '../admin.js';
import {
  listCampaignMembers,
  effectiveProfile,
  setMemberFlags,
  createCharacterFor,
  assignCharacterOwner,
  deleteCharacterRpc,
  setCampaignMaster,
  createMasterAccount,
  createPlayerAccountFn,
  resetAccountPassword,
  setAccountKind,
  deleteAccount,
  listMyMemberships,
  listPlayerAccounts,
} from '../accounts.js';
import { renderCharacterScreen } from './character.js';
import { renderMasterCampaignHub } from './masterCampaignHub.js';

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

// Painel do ADM (vê e mexe em tudo) e do MESTRE (só as mesas dele -- o banco já filtra o que cada um enxerga).
// opts: { session, profile, memberships, characters, onPlayCharacter }
export function renderAdminScreen(app, opts) {
  const { session, profile, characters = [], onPlayCharacter } = opts;
  const isAdmin = !!profile.is_superadmin;
  const myId = profile.id;
  const reopen = () => renderAdminScreen(app, opts);

  let memberships = opts.memberships || [];
  let campaigns = []; // só as mesas que ESSA conta administra
  let accounts = []; // ADM: todas as contas
  let playerAccounts = []; // contas de jogador (não pertencem a mesa; o personagem é que vincula)
  let memberCounts = new Map();
  let expanded = new Set();
  let membersByCampaign = new Map();
  let charactersByCampaign = new Map();
  let discordChannelByCampaign = new Map();
  let combatChannelByCampaign = new Map();
  let discordChannelByCharacter = new Map();
  let confirming = null; // 'kind:id' no 1º clique de excluir
  let confirmingTimer = null;
  let deleteStage = null; // { kind: 'campaign'|'character'|'account', id, campaignId, error } -- passo da senha
  let syncingLiveSession = null;
  let lastCreatedAccount = null; // { nickname, password, kind }
  let banner = null; // { text, error }

  const isMasterOf = (c) => isAdmin || c.master_id === myId || memberships.some((m) => m.campaign_id === c.id && m.role === 'master');
  const effFor = (campaign) => effectiveProfile(profile, campaign, memberships.find((m) => m.campaign_id === campaign.id) || null);
  const ownerNameOf = (campaign) => {
    const a = accounts.find((x) => x.id === campaign.master_id);
    return a ? a.username : null;
  };

  async function load() {
    const [camps, discordConfigs, counts] = await Promise.all([listAllCampaigns(), listDiscordConfigs(), countMembersByCampaign()]);
    if (!isAdmin) memberships = await listMyMemberships(myId);
    campaigns = camps.filter(isMasterOf);
    if (isAdmin) accounts = await listAllProfiles();
    playerAccounts = await listPlayerAccounts();
    memberCounts = counts;
    discordChannelByCampaign = new Map(discordConfigs.map((c) => [c.campaign_id, c.channel_id]));
    combatChannelByCampaign = new Map(discordConfigs.map((c) => [c.campaign_id, c.combat_channel_id]));
    membersByCampaign.clear();
    charactersByCampaign.clear();
    for (const id of expanded) if (!campaigns.some((c) => c.id === id)) expanded.delete(id);
    await Promise.all([...expanded].map(loadCampaignDetails));
    render();
  }

  async function loadCampaignDetails(campaignId) {
    const [members, chars] = await Promise.all([listCampaignMembers(campaignId), listCharactersInCampaign(campaignId)]);
    membersByCampaign.set(campaignId, members);
    charactersByCampaign.set(campaignId, chars);
    const cfgs = chars.length ? await listCharacterDiscordConfigs(chars.map((c) => c.id)) : [];
    cfgs.forEach((c) => discordChannelByCharacter.set(c.character_id, c.channel_id));
  }

  function flash(text, error = false) {
    banner = { text, error };
    render();
  }

  // ---------- HTML ----------

  function deleteGateBox(kind, id) {
    if (!deleteStage || deleteStage.kind !== kind || deleteStage.id !== id) return '';
    return `
      <div class="admin-delete-gate">
        <p class="admin-delete-gate-warn">⚠ essa ação não pode ser desfeita. digite a sua senha pra confirmar.</p>
        <input type="password" class="admin-delete-gate-pass" data-gate-pass="${kind}:${id}" placeholder="sua senha" autocomplete="current-password">
        ${deleteStage.error ? `<p class="admin-error" style="display:block;">${escapeHtml(deleteStage.error)}</p>` : ''}
        <div class="admin-delete-gate-actions">
          <button type="button" class="admin-danger-btn" data-act="gate-confirm" data-key="${kind}:${id}">tenho certeza — excluir</button>
          <button type="button" class="btn btn-ghost" data-act="gate-cancel">cancelar</button>
        </div>
      </div>`;
  }

  function dangerBtn(kind, id, label, title = '') {
    const pending = confirming === `${kind}:${id}`;
    return `<button type="button" class="admin-danger-btn ${pending ? 'confirm-pending' : ''}" data-act="arm" data-kind="${kind}" data-id="${id}" ${title ? `title="${escapeHtml(title)}"` : ''}>${pending ? 'confirmar?' : label}</button>`;
  }

  function masterOptions(selectedId) {
    const masters = accounts.filter((a) => a.role === 'master' || a.is_superadmin || a.id === selectedId);
    return masters.map((a) => `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${escapeHtml(a.username)}${a.is_superadmin ? ' (ADM)' : ''}</option>`).join('');
  }

  function accountsCard() {
    if (!isAdmin) return '';
    const rows = accounts
      .slice()
      .sort((a, b) => (b.is_superadmin ? 1 : 0) - (a.is_superadmin ? 1 : 0) || (a.username || '').localeCompare(b.username || ''))
      .map((a) => {
        const isMe = a.id === myId;
        const tag = a.is_superadmin ? '<span class="acc-tag acc-tag-master">ADM</span>' : a.role === 'master' ? '<span class="acc-tag acc-tag-master">mestre</span>' : '<span class="acc-tag">jogador</span>';
        return `
          <div class="acc-row">
            <span>${escapeHtml(a.username)} ${tag}${isMe ? '<span class="acc-tag">você</span>' : ''}</span>
            <div class="acc-row-actions">
              <button type="button" class="btn btn-ghost" data-act="reset-pw" data-uid="${a.id}" data-name="${escapeHtml(a.username)}">nova senha</button>
              ${!isMe && !a.is_superadmin ? `<button type="button" class="btn btn-ghost" data-act="set-kind" data-uid="${a.id}" data-kind="${a.role === 'master' ? 'player' : 'master'}">virar ${a.role === 'master' ? 'jogador' : 'mestre'}</button>${dangerBtn('account', a.id, 'excluir conta', 'só funciona se a conta não tiver personagens nem campanhas')}` : ''}
            </div>
          </div>
          ${deleteGateBox('account', a.id)}`;
      })
      .join('');
    return `
      <div class="admin-card">
        <h3 class="admin-card-title">CONTAS (ADM)</h3>
        <div class="acc-inline" style="margin-top:0;">
          <input type="text" id="master-nick" placeholder="apelido do novo mestre" />
          <input type="text" id="master-pass" placeholder="senha" />
          <button type="button" class="btn" data-act="create-master">+ conta de mestre</button>
        </div>
        <div style="margin-top:10px;">${rows}</div>
      </div>`;
  }

  // contas que podem ser dono de um personagem: todas as de jogador (+ o dono atual, se for outro tipo de conta)
  function ownerChoices(currentId, members) {
    const list = playerAccounts.slice();
    if (currentId && !list.some((a) => a.id === currentId)) {
      const m = members.find((x) => x.id === currentId);
      list.push({ id: currentId, username: m ? m.username : 'conta atual' });
    }
    return list;
  }

  function playersCard() {
    const list = isAdmin
      ? ''
      : `<div style="margin-top:10px;">${
          playerAccounts
            .map(
              (a) => `<div class="acc-row"><span>${escapeHtml(a.username)}</span><div class="acc-row-actions"><button type="button" class="btn btn-ghost" data-act="reset-pw" data-uid="${a.id}" data-name="${escapeHtml(a.username)}">nova senha</button></div></div>`
            )
            .join('') || '<p class="admin-empty">Nenhuma conta de jogador ainda.</p>'
        }</div>`;
    return `
      <div class="admin-card">
        <h3 class="admin-card-title">CONTAS DE JOGADOR</h3>
        <p class="admin-empty" style="margin:0 0 8px;">A conta não pertence a mesa nenhuma: depois de criar, é só atribuir personagens a ela em cada campanha.</p>
        <div class="acc-inline" style="margin-top:0;">
          <input type="text" id="pl-nick" placeholder="apelido do jogador" />
          <input type="text" id="pl-pass" placeholder="senha" />
          <button type="button" class="btn" data-act="create-player-acct">+ conta de jogador</button>
        </div>
        ${list}
      </div>`;
  }

  function memberRow(c, m) {
    const isM = m.role === 'master';
    const perms = isM
      ? ''
      : `<button type="button" class="acc-perm ${m.can_see_others_hp ? 'granted' : ''}" data-act="perm" data-cid="${c.id}" data-uid="${m.id}" data-field="can_see_others_hp" data-current="${m.can_see_others_hp}">vê HP dos outros</button>
         <button type="button" class="acc-perm ${m.can_see_hidden_initiative ? 'granted' : ''}" data-act="perm" data-cid="${c.id}" data-uid="${m.id}" data-field="can_see_hidden_initiative" data-current="${m.can_see_hidden_initiative}">vê iniciativas ocultas</button>
         <button type="button" class="acc-perm ${m.is_transport_admin ? 'granted' : ''}" data-act="perm" data-cid="${c.id}" data-uid="${m.id}" data-field="is_transport_admin" data-current="${m.is_transport_admin}">admin do baú</button>`;
    return `
      <div class="acc-row">
        <span>${escapeHtml(m.username)} <span class="acc-tag ${isM ? 'acc-tag-master' : ''}">${isM ? 'mestre' : 'jogador'}</span></span>
        <div class="acc-row-actions">
          ${perms}
          ${!isM ? `<button type="button" class="btn btn-ghost" data-act="reset-pw" data-uid="${m.id}" data-name="${escapeHtml(m.username)}">nova senha</button>` : ''}
        </div>
      </div>
      ${!isM ? `<div class="admin-discord-row">
        <label>🎮 Discord user ID de ${escapeHtml(m.username)}</label>
        <input type="text" class="admin-discord-input" data-player-discord="${m.id}" placeholder="ID numérico da conta" value="${escapeHtml(m.discord_user_id || '')}" />
        <button type="button" class="btn btn-ghost" data-act="save-player-discord" data-uid="${m.id}">vincular</button>
        <span class="admin-discord-feedback" data-player-discord-fb="${m.id}"></span>
      </div>` : ''}`;
  }

  function characterRow(c, ch, members) {
    const owner = members.find((m) => m.id === ch.owner_id);
    const ownerLabel = owner ? owner.username : 'sem dono';
    const players = ownerChoices(ch.owner_id, members);
    return `
      <div class="admin-character-row">
        <span>${escapeHtml(ch.name || 'Personagem')} <span class="admin-owner-tag">(${escapeHtml(ownerLabel)})</span></span>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button type="button" class="btn btn-ghost" data-act="open-char" data-cid="${c.id}" data-chid="${ch.id}" data-owner="${escapeHtml(ownerLabel)}">abrir inventário</button>
          ${dangerBtn('character', ch.id, 'excluir personagem', 'apaga o personagem (a conta do jogador continua)')}
        </div>
      </div>
      ${deleteGateBox('character', ch.id)}
      <div class="admin-discord-row">
        <label>👤 Dono</label>
        <select data-assign="${ch.id}">${players.map((m) => `<option value="${m.id}" ${m.id === ch.owner_id ? 'selected' : ''}>${escapeHtml(m.username)}</option>`).join('')}</select>
        <button type="button" class="btn btn-ghost" data-act="assign-char" data-chid="${ch.id}">atribuir</button>
      </div>
      <div class="admin-discord-row">
        <label>🤖 Canal do Discord (inventário)</label>
        <input type="text" class="admin-discord-input" data-discord-character="${ch.id}" placeholder="ID do canal" value="${escapeHtml(discordChannelByCharacter.get(ch.id) || '')}" />
        <button type="button" class="btn btn-ghost" data-act="save-char-discord" data-chid="${ch.id}">vincular</button>
        <span class="admin-discord-feedback" data-discord-character-fb="${ch.id}"></span>
      </div>`;
  }

  function campaignDetails(c) {
    const members = membersByCampaign.get(c.id);
    const chars = charactersByCampaign.get(c.id);
    if (!members || !chars) return '<div class="acc-sub"><p class="admin-empty">Carregando...</p></div>';
    const players = playerAccounts;
    const seated = members.filter((m) => m.role !== 'master');
    return `
      <div class="acc-sub">
        <h4>JOGADORES DESTA MESA</h4>
        ${seated.map((m) => memberRow(c, m)).join('') || '<p class="admin-empty">Ninguém tem personagem aqui ainda -- crie um personagem abaixo e escolha a conta do jogador.</p>'}
      </div>
      <div class="acc-sub">
        <h4>PERSONAGENS</h4>
        ${chars.length ? chars.map((ch) => characterRow(c, ch, members)).join('') : '<p class="admin-empty">Nenhum personagem nessa campanha ainda.</p>'}
        ${
          players.length
            ? `<div class="acc-inline">
          <input type="text" id="ncp-name-${c.id}" placeholder="nome do personagem" />
          <select id="ncp-owner-${c.id}">${players.map((m) => `<option value="${m.id}">${escapeHtml(m.username)}</option>`).join('')}</select>
          <button type="button" class="btn" data-act="create-char" data-cid="${c.id}">+ criar e atribuir</button>
        </div>`
            : '<p class="admin-empty">Crie uma conta de jogador (card "Contas de jogador", lá em cima) pra poder criar personagens.</p>'
        }
      </div>
      ${
        isAdmin
          ? `<div class="acc-sub"><h4>DONO DA CAMPANHA (ADM)</h4>
        <div class="acc-inline" style="margin-top:0;">
          <select id="owner-${c.id}">${masterOptions(c.master_id)}</select>
          <button type="button" class="btn btn-ghost" data-act="set-owner" data-cid="${c.id}">passar a campanha</button>
        </div></div>`
          : ''
      }`;
  }

  function campaignCard(c) {
    const isOpen = expanded.has(c.id);
    const created = new Date(c.created_at).toLocaleDateString('pt-BR');
    const ownerName = isAdmin ? ownerNameOf(c) : null;
    return `
      <div class="admin-campaign-card">
        <div class="admin-campaign-head">
          <div>
            <div class="admin-campaign-name">${escapeHtml(c.name)}</div>
            <div class="admin-campaign-meta">${memberCounts.get(c.id) || 0} membro(s) · criada em ${created}${ownerName ? ` · mestre <b>${escapeHtml(ownerName)}</b>` : ''}</div>
          </div>
          <div class="admin-campaign-actions">
            <button type="button" class="btn btn-ghost" data-act="open-hub" data-cid="${c.id}" data-mode="combat">⚔ combate</button>
            <button type="button" class="btn btn-ghost" data-act="open-hub" data-cid="${c.id}" data-mode="ficha">📋 fichas</button>
            <button type="button" class="btn btn-ghost" data-act="toggle-camp" data-cid="${c.id}">${isOpen ? 'fechar' : 'gerenciar mesa'}</button>
            ${dangerBtn('campaign', c.id, 'excluir')}
          </div>
        </div>
        ${deleteGateBox('campaign', c.id)}
        <div class="admin-discord-row">
          <label>🤖 Canal do Discord (transporte público)</label>
          <input type="text" class="admin-discord-input" data-discord-campaign="${c.id}" placeholder="ID do canal" value="${escapeHtml(discordChannelByCampaign.get(c.id) || '')}" />
          <button type="button" class="btn btn-ghost" data-act="save-camp-discord" data-cid="${c.id}">vincular</button>
          <span class="admin-discord-feedback" data-discord-campaign-fb="${c.id}"></span>
        </div>
        <div class="admin-discord-row">
          <label>⚔ Canal do Discord (aviso de turno)</label>
          <input type="text" class="admin-discord-input" data-combat-discord-campaign="${c.id}" placeholder="ID do canal" value="${escapeHtml(combatChannelByCampaign.get(c.id) || '')}" />
          <button type="button" class="btn btn-ghost" data-act="save-combat-discord" data-cid="${c.id}">vincular</button>
          <span class="admin-discord-feedback" data-combat-discord-fb="${c.id}"></span>
        </div>
        <div class="admin-discord-row">
          <label>🎲 Sessão do Discord</label>
          <button type="button" class="btn ${c.discord_live_session ? 'btn-live-session' : 'btn-ghost'}" data-act="toggle-live" data-cid="${c.id}" data-live="${c.discord_live_session}" ${syncingLiveSession === c.id ? 'disabled' : ''} title="em sessão, o Discord atualiza em tempo real a cada mudança; fora de sessão, só atualiza quando alguém clica em 🔄 atualizar">
            ${syncingLiveSession === c.id ? 'sincronizando tudo...' : c.discord_live_session ? '🟢 em sessão (tempo real)' : '⚪ fora de sessão (só no 🔄 atualizar)'}
          </button>
          <span class="admin-discord-feedback" data-live-fb="${c.id}"></span>
        </div>
        ${isOpen ? campaignDetails(c) : ''}
      </div>`;
  }

  function myCharactersCard() {
    if (!characters.length || !onPlayCharacter) return '';
    return `
      <div class="admin-card">
        <h3 class="admin-card-title">JOGAR COM UM PERSONAGEM</h3>
        ${characters
          .map(
            (c) => `<div class="acc-row"><span>${escapeHtml(c.name || 'Personagem')} <span class="admin-owner-tag">${escapeHtml(c.campaigns ? c.campaigns.name : '')} · nível ${Number(c.level) || 1}</span></span>
            <button type="button" class="btn btn-ghost" data-act="play" data-chid="${c.id}">jogar</button></div>`
          )
          .join('')}
      </div>`;
  }

  function render() {
    const scrollY = window.scrollY;
    const success = lastCreatedAccount
      ? `<div class="admin-success">
          <p>Conta criada! Passe pra pessoa:</p>
          <p><b>apelido:</b> ${escapeHtml(lastCreatedAccount.nickname)} &nbsp; <b>senha:</b> ${escapeHtml(lastCreatedAccount.password)}</p>
          <button type="button" class="btn btn-ghost" data-act="dismiss-account">ok, entendi</button>
        </div>`
      : '';
    app.innerHTML = `
      <div class="wrap admin-wrap" data-admin-root>
        <div class="admin-header">
          <div class="title"><span class="dot"></span>${isAdmin ? 'PAINEL DO ADM' : 'MINHAS MESAS'}</div>
          <button type="button" class="campaign-strip-signout" data-act="signout">sair</button>
        </div>
        ${banner ? `<p class="admin-error" style="display:block; ${banner.error ? '' : 'color:var(--accent-core);'}">${escapeHtml(banner.text)}</p>` : ''}
        ${success}
        ${myCharactersCard()}
        <div class="admin-card">
          <h3 class="admin-card-title">+ Nova campanha</h3>
          <div class="admin-new-row">
            <input type="text" id="new-camp-name" placeholder="Nome da campanha" />
            ${isAdmin ? `<select id="new-camp-owner" class="acc-inline-select">${masterOptions(myId)}</select>` : ''}
            <button type="button" class="btn" data-act="create-campaign">criar</button>
          </div>
        </div>
        ${playersCard()}
        ${accountsCard()}
        <div class="admin-list">
          ${campaigns.length ? campaigns.map(campaignCard).join('') : '<p class="admin-empty">Nenhuma campanha ainda.</p>'}
        </div>
      </div>`;
    window.scrollTo(0, scrollY);
  }

  // ---------- ações ----------

  const $ = (sel) => app.querySelector(sel);
  const campaignById = (id) => campaigns.find((c) => c.id === id);

  async function guarded(fn, okText) {
    try {
      await fn();
      if (okText) banner = { text: okText, error: false };
      else banner = null;
      await load();
    } catch (err) {
      flash(err.message || String(err), true);
    }
  }

  function setFeedback(selector, text) {
    const el = $(selector);
    if (el) el.textContent = text;
  }

  async function reauth(password) {
    const { error } = await supabase.auth.signInWithPassword({ email: session.user.email, password: padPassword(password) });
    return !error;
  }

  const actions = {
    signout: async () => {
      await signOut();
      window.location.reload();
    },
    'dismiss-account': () => {
      lastCreatedAccount = null;
      render();
    },
    play: (el) => {
      app.onclick = null;
      const c = characters.find((x) => x.id === el.dataset.chid);
      if (c) onPlayCharacter(c);
    },

    'create-campaign': () => {
      const name = $('#new-camp-name').value.trim();
      if (!name) return $('#new-camp-name').focus();
      const ownerSel = $('#new-camp-owner');
      return guarded(() => createCampaignAsAdmin(name, ownerSel ? ownerSel.value : null), 'campanha criada ✓');
    },
    'create-master': () => {
      const nickname = $('#master-nick').value.trim();
      const password = $('#master-pass').value;
      if (!nickname || !password) return flash('Preencha apelido e senha do mestre.', true);
      return guarded(async () => {
        await createMasterAccount(nickname, password);
        lastCreatedAccount = { nickname, password, kind: 'master' };
      });
    },
    'create-player-acct': () => {
      const nickname = $('#pl-nick').value.trim();
      const password = $('#pl-pass').value;
      if (!nickname || !password) return flash('Preencha apelido e senha.', true);
      return guarded(async () => {
        await createPlayerAccountFn(nickname, password);
        lastCreatedAccount = { nickname, password, kind: 'player' };
      });
    },
    perm: async (el) => {
      try {
        await setMemberFlags(el.dataset.cid, el.dataset.uid, { [el.dataset.field]: el.dataset.current !== 'true' });
        await loadCampaignDetails(el.dataset.cid);
        render();
      } catch (err) {
        flash(err.message, true);
      }
    },
    'reset-pw': (el) => {
      const pw = window.prompt(`Nova senha para ${el.dataset.name} (4 a 64 caracteres):`);
      if (!pw) return;
      return guarded(() => resetAccountPassword(el.dataset.uid, pw), `senha de ${el.dataset.name} alterada ✓`);
    },
    'set-kind': (el) => {
      const toMaster = el.dataset.kind === 'master';
      if (!window.confirm(toMaster ? 'Transformar em conta de MESTRE (pode criar campanhas)?' : 'Voltar essa conta pra JOGADOR?')) return;
      return guarded(() => setAccountKind(el.dataset.uid, el.dataset.kind), 'tipo da conta alterado ✓');
    },
    'set-owner': (el) => {
      const cid = el.dataset.cid;
      const sel = $(`#owner-${cid}`);
      if (!window.confirm('Passar essa campanha pra outra conta de mestre?')) return;
      return guarded(() => setCampaignMaster(cid, sel.value), 'dono da campanha alterado ✓');
    },

    'create-char': (el) => {
      const cid = el.dataset.cid;
      const name = $(`#ncp-name-${cid}`).value.trim();
      const owner = $(`#ncp-owner-${cid}`).value;
      if (!name) return $(`#ncp-name-${cid}`).focus();
      return guarded(() => createCharacterFor(cid, name, owner), 'personagem criado ✓');
    },
    'assign-char': (el) => {
      const sel = $(`select[data-assign="${el.dataset.chid}"]`);
      return guarded(() => assignCharacterOwner(el.dataset.chid, sel.value), 'personagem atribuído ✓');
    },
    'open-char': (el) => {
      const campaign = campaignById(el.dataset.cid);
      if (!campaign) return;
      app.onclick = null;
      renderCharacterScreen(app, {
        session,
        profile: effFor(campaign),
        campaign,
        characterId: el.dataset.chid,
        ownerName: el.dataset.owner,
        onBack: reopen,
      });
    },
    'open-hub': (el) => {
      const campaign = campaignById(el.dataset.cid);
      if (!campaign) return;
      app.onclick = null;
      renderMasterCampaignHub(app, { session, profile: effFor(campaign), campaign, initialMode: el.dataset.mode, onBack: reopen });
    },
    'toggle-camp': async (el) => {
      const cid = el.dataset.cid;
      if (expanded.has(cid)) {
        expanded.delete(cid);
        return render();
      }
      expanded.add(cid);
      render();
      try {
        await loadCampaignDetails(cid);
      } catch (err) {
        flash(err.message, true);
        return;
      }
      render();
    },

    arm: (el) => {
      const key = `${el.dataset.kind}:${el.dataset.id}`;
      clearTimeout(confirmingTimer);
      if (confirming === key) {
        confirming = null;
        deleteStage = { kind: el.dataset.kind, id: el.dataset.id, error: '' };
        return render();
      }
      confirming = key;
      render();
      confirmingTimer = setTimeout(() => {
        confirming = null;
        render();
      }, 3000);
    },
    'gate-cancel': () => {
      deleteStage = null;
      render();
    },
    'gate-confirm': async (el) => {
      const key = el.dataset.key;
      const sep = key.indexOf(':');
      const kind = key.slice(0, sep);
      const id = key.slice(sep + 1);
      if (!deleteStage || deleteStage.kind !== kind || deleteStage.id !== id) return;
      const input = $(`input[data-gate-pass="${key}"]`);
      const password = input ? input.value : '';
      if (!password) {
        deleteStage = { ...deleteStage, error: 'digite sua senha.' };
        return render();
      }
      if (!(await reauth(password))) {
        deleteStage = { ...deleteStage, error: 'senha incorreta.' };
        return render();
      }
      deleteStage = null;
      const run = { campaign: deleteCampaignAsAdmin, character: deleteCharacterRpc, account: deleteAccount }[kind];
      return guarded(() => run(id), 'excluído ✓');
    },

    'save-camp-discord': async (el) => {
      const cid = el.dataset.cid;
      const input = $(`input[data-discord-campaign="${cid}"]`);
      const v = input.value.trim();
      if (!v) return input.focus();
      setFeedback(`[data-discord-campaign-fb="${cid}"]`, 'vinculando...');
      try {
        await setCampaignDiscordChannel(cid, v);
        discordChannelByCampaign.set(cid, v);
        setFeedback(`[data-discord-campaign-fb="${cid}"]`, 'vinculado ✓');
      } catch (err) {
        setFeedback(`[data-discord-campaign-fb="${cid}"]`, 'erro: ' + err.message);
      }
    },
    'save-combat-discord': async (el) => {
      const cid = el.dataset.cid;
      const input = $(`input[data-combat-discord-campaign="${cid}"]`);
      const v = input.value.trim();
      if (!v) return input.focus();
      setFeedback(`[data-combat-discord-fb="${cid}"]`, 'vinculando...');
      try {
        await setCampaignCombatChannel(cid, v);
        combatChannelByCampaign.set(cid, v);
        setFeedback(`[data-combat-discord-fb="${cid}"]`, 'vinculado ✓');
      } catch (err) {
        setFeedback(`[data-combat-discord-fb="${cid}"]`, 'erro: ' + err.message);
      }
    },
    'save-char-discord': async (el) => {
      const chid = el.dataset.chid;
      const input = $(`input[data-discord-character="${chid}"]`);
      const v = input.value.trim();
      if (!v) return input.focus();
      setFeedback(`[data-discord-character-fb="${chid}"]`, 'vinculando...');
      try {
        await setCharacterDiscordChannel(chid, v);
        discordChannelByCharacter.set(chid, v);
        setFeedback(`[data-discord-character-fb="${chid}"]`, 'vinculado ✓');
      } catch (err) {
        setFeedback(`[data-discord-character-fb="${chid}"]`, 'erro: ' + err.message);
      }
    },
    'save-player-discord': async (el) => {
      const uid = el.dataset.uid;
      const input = $(`input[data-player-discord="${uid}"]`);
      const v = input.value.trim();
      if (!v) return input.focus();
      setFeedback(`[data-player-discord-fb="${uid}"]`, 'vinculando...');
      try {
        await setPlayerDiscordUserId(uid, v);
        setFeedback(`[data-player-discord-fb="${uid}"]`, 'vinculado ✓');
      } catch (err) {
        setFeedback(`[data-player-discord-fb="${uid}"]`, 'erro: ' + err.message);
      }
    },
    'toggle-live': async (el) => {
      const cid = el.dataset.cid;
      const live = el.dataset.live !== 'true';
      if (live) {
        syncingLiveSession = cid;
        render();
      }
      try {
        await setCampaignLiveSession(cid, live);
        const c = campaignById(cid);
        if (c) c.discord_live_session = live;
        syncingLiveSession = null;
        render();
        if (live) setFeedback(`[data-live-fb="${cid}"]`, 'sincronização pedida ✓');
      } catch (err) {
        syncingLiveSession = null;
        render();
        setFeedback(`[data-live-fb="${cid}"]`, 'erro: ' + err.message);
      }
    },
  };

  app.onclick = (e) => {
    const el = e.target.closest('[data-act]');
    // o mesmo #app serve as outras telas: só age enquanto o painel é o que está na tela
    if (!el || !app.contains(el) || !app.querySelector('[data-admin-root]')) return;
    const fn = actions[el.dataset.act];
    if (fn) fn(el);
  };

  load().catch((err) => {
    app.innerHTML = `<div class="wrap admin-wrap"><div class="auth-card"><p class="auth-error" style="display:block;">Erro ao carregar o painel: ${escapeHtml(err.message)}</p></div></div>`;
  });
}
