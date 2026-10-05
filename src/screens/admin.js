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
  displayNameOf,
  listGameSystems,
  setCampaignSystem,
} from '../accounts.js';
import { renderCharacterScreen } from './character.js';
import { renderMasterCampaignHub } from './masterCampaignHub.js';
import { knownSystemIds } from '../systems/index.js';

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

function avatar(url, name, cls = '') {
  return url
    ? `<img class="mg-av ${cls}" src="${escapeHtml(url)}" alt="">`
    : `<span class="mg-av mg-av-ph ${cls}">${escapeHtml((name || '?').trim().charAt(0).toUpperCase())}</span>`;
}

// Gestão: o ADM vê e mexe em tudo; o mestre só nas mesas dele (o banco já filtra o que cada um enxerga).
// opts: { session, profile, memberships, characters, onHome, onOpenProfile }
export function renderAdminScreen(app, opts) {
  const { session, profile, onHome, onOpenProfile } = opts;
  const isAdmin = !!profile.is_superadmin;
  const myId = profile.id;
  const reopen = () => renderAdminScreen(app, { ...opts, focusCampaignId: null });

  let memberships = opts.memberships || [];
  let campaigns = []; // só as mesas que ESSA conta administra
  let accounts = []; // ADM: todas as contas
  let gameSystems = []; // sistemas de regras liberados (e que este cliente sabe usar)
  let playerAccounts = []; // contas de jogador (não pertencem a mesa; o personagem é que vincula)
  let memberCounts = new Map();
  let view = 'mesas'; // 'mesas' | 'jogadores' | 'contas'
  let newCampOpen = false;
  let expanded = new Set(opts.focusCampaignId ? [opts.focusCampaignId] : []); // vindo de "gerenciar esta mesa" no início, a mesa já abre
  let campTab = new Map(); // campaignId -> 'personagens' | 'jogadores' | 'discord' | 'mais'
  let membersByCampaign = new Map();
  let charactersByCampaign = new Map();
  let discordChannelByCampaign = new Map();
  let combatChannelByCampaign = new Map();
  let discordChannelByCharacter = new Map();
  let confirming = null; // 'kind:id' no 1º clique de excluir
  let confirmingTimer = null;
  let deleteStage = null; // { kind: 'campaign'|'character'|'account', id, error } -- passo da senha
  let syncingLiveSession = null;
  let lastCreatedAccount = null; // { nickname, password, kind }
  let banner = null; // { text, error }
  let focusPending = !!opts.focusCampaignId;

  const isMasterOf = (c) => isAdmin || c.master_id === myId || memberships.some((m) => m.campaign_id === c.id && m.role === 'master');
  const effFor = (campaign) => effectiveProfile(profile, campaign, memberships.find((m) => m.campaign_id === campaign.id) || null);
  const accountName = (id) => {
    const a = accounts.find((x) => x.id === id);
    return a ? displayNameOf(a) : null;
  };

  async function load() {
    const [camps, discordConfigs, counts] = await Promise.all([listAllCampaigns(), listDiscordConfigs(), countMembersByCampaign()]);
    if (!isAdmin) memberships = await listMyMemberships(myId);
    campaigns = camps.filter(isMasterOf);
    if (isAdmin) accounts = await listAllProfiles();
    playerAccounts = await listPlayerAccounts();
    gameSystems = (await listGameSystems()).filter((s) => knownSystemIds().includes(s.id));
    memberCounts = counts;
    discordChannelByCampaign = new Map(discordConfigs.map((c) => [c.campaign_id, c.channel_id]));
    combatChannelByCampaign = new Map(discordConfigs.map((c) => [c.campaign_id, c.combat_channel_id]));
    membersByCampaign.clear();
    charactersByCampaign.clear();
    for (const id of expanded) if (!campaigns.some((c) => c.id === id)) expanded.delete(id);
    await Promise.all([...expanded].map(loadCampaignDetails));
    render();
    if (focusPending) {
      focusPending = false;
      const el = app.querySelector(`[data-camp="${opts.focusCampaignId}"]`);
      if (el) el.scrollIntoView({ block: 'start' });
    }
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
      <div class="mg-gate">
        <p class="mg-gate-warn">⚠ Essa ação não pode ser desfeita. Digite a sua senha para confirmar.</p>
        <input type="password" class="pf-input" data-gate-pass="${kind}:${id}" placeholder="sua senha" autocomplete="current-password">
        ${deleteStage.error ? `<p class="mg-err">${escapeHtml(deleteStage.error)}</p>` : ''}
        <div class="mg-row-actions" style="margin-top:10px;">
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
    return masters
      .map((a) => `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${escapeHtml(displayNameOf(a))}${a.is_superadmin ? ' (ADM)' : ''}</option>`)
      .join('');
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

  const systemLabel = (id) => (gameSystems.find((s) => s.id === id) || { label: id || 'Cave Story' }).label;

  function topBar() {
    const name = displayNameOf(profile);
    return `
      <header class="mg-top">
        <button type="button" class="campaign-strip-signout" data-act="home">← início</button>
        <div class="mg-top-title"><span class="dot"></span>${isAdmin ? 'PAINEL DO ADM' : 'MINHAS MESAS'}</div>
        <div class="mg-top-right">
          <button type="button" class="pk-chipbtn" data-act="profile" title="meu perfil">${avatar(profile.avatar_url, name, 'mg-av-chip')}<span class="pk-chip-name">${escapeHtml(name)}</span></button>
          <button type="button" class="campaign-strip-signout" data-act="signout">sair</button>
        </div>
      </header>`;
  }

  function tabsBar() {
    const tabs = [
      ['mesas', `Mesas <span class="mg-badge">${campaigns.length}</span>`],
      ['jogadores', `Jogadores <span class="mg-badge">${playerAccounts.length}</span>`],
    ];
    if (isAdmin) tabs.push(['contas', `Contas <span class="mg-badge">${accounts.length}</span>`]);
    return `<nav class="mg-tabs">${tabs.map(([k, label]) => `<button type="button" class="mg-tab ${view === k ? 'on' : ''}" data-act="view" data-view="${k}">${label}</button>`).join('')}</nav>`;
  }

  // ----- aba: Mesas -----
  function newCampaignCard() {
    if (!newCampOpen) {
      return `<button type="button" class="mg-add" data-act="toggle-new-camp"><span>＋</span> Nova mesa</button>`;
    }
    return `
      <div class="mg-card mg-newcamp">
        <h3 class="mg-card-title">Nova mesa</h3>
        <label class="pf-label" for="new-camp-name">Nome da mesa</label>
        <input type="text" id="new-camp-name" class="pf-input" placeholder="Ex.: Crônicas de Verdemar" maxlength="60" />
        <label class="pf-label" for="new-camp-system">Sistema de regras</label>
        <select id="new-camp-system" class="pf-input">${gameSystems.map((s) => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('')}</select>
        <p class="pf-hint">${escapeHtml((gameSystems[0] && gameSystems[0].description) || '')} O sistema não muda depois que a mesa tem personagens.</p>
        ${
          isAdmin
            ? `<label class="pf-label" for="new-camp-owner">Mestre da mesa</label>
               <select id="new-camp-owner" class="pf-input">${masterOptions(myId)}</select>
               <p class="pf-hint">Quem vai mestrar essa mesa. Para ter outro mestre na lista, crie uma conta de mestre na aba <b>Contas</b>.</p>`
            : ''
        }
        <div class="pf-actions">
          <button type="button" class="btn" data-act="create-campaign">criar mesa</button>
          <button type="button" class="btn btn-ghost" data-act="toggle-new-camp">cancelar</button>
        </div>
      </div>`;
  }

  function charactersTab(c, members, chars) {
    const players = playerAccounts;
    const create = players.length
      ? `<div class="mg-form">
          <input type="text" id="ncp-name-${c.id}" class="pf-input" placeholder="Nome do novo personagem" />
          <select id="ncp-owner-${c.id}" class="pf-input">${players.map((m) => `<option value="${m.id}">${escapeHtml(m.username)}</option>`).join('')}</select>
          <button type="button" class="btn" data-act="create-char" data-cid="${c.id}">＋ criar e atribuir</button>
        </div>`
      : `<p class="mg-empty">Crie uma conta de jogador na aba <b>Jogadores</b> para poder atribuir personagens.</p>`;
    const rows = chars
      .map((ch) => {
        const owner = members.find((m) => m.id === ch.owner_id);
        const ownerLabel = owner ? owner.username : 'sem dono';
        return `
        <div class="mg-char">
          <div class="mg-char-main">
            ${avatar(ch.avatar_url, ch.name, 'mg-av-lg')}
            <div class="mg-char-info">
              <div class="mg-char-name">${escapeHtml(ch.name || 'Personagem')}</div>
              <div class="mg-char-sub">jogador: <b>${escapeHtml(ownerLabel)}</b> · nível ${Number(ch.level) || 1}</div>
            </div>
            <div class="mg-row-actions">
              <button type="button" class="btn btn-ghost" data-act="open-char" data-cid="${c.id}" data-chid="${ch.id}" data-owner="${escapeHtml(ownerLabel)}">inventário</button>
              ${dangerBtn('character', ch.id, 'excluir', 'apaga o personagem (a conta do jogador continua)')}
            </div>
          </div>
          ${deleteGateBox('character', ch.id)}
          <div class="mg-char-opts">
            <label>dono</label>
            <select class="pf-input" data-assign="${ch.id}">${ownerChoices(ch.owner_id, members).map((m) => `<option value="${m.id}" ${m.id === ch.owner_id ? 'selected' : ''}>${escapeHtml(m.username)}</option>`).join('')}</select>
            <button type="button" class="btn btn-ghost" data-act="assign-char" data-chid="${ch.id}">passar</button>
            <label>canal Discord</label>
            <input type="text" class="pf-input" data-discord-character="${ch.id}" placeholder="ID do canal" value="${escapeHtml(discordChannelByCharacter.get(ch.id) || '')}" />
            <button type="button" class="btn btn-ghost" data-act="save-char-discord" data-chid="${ch.id}">vincular</button>
            <span class="mg-fb" data-discord-character-fb="${ch.id}"></span>
          </div>
        </div>`;
      })
      .join('');
    return `${create}<div class="mg-chars">${rows || '<p class="mg-empty">Nenhum personagem nessa mesa ainda.</p>'}</div>`;
  }

  function playersTab(c, members) {
    const seated = members.filter((m) => m.role !== 'master');
    if (!seated.length) return '<p class="mg-empty">Ninguém tem personagem nessa mesa ainda. Crie um personagem na aba <b>Personagens</b> e escolha o jogador.</p>';
    return seated
      .map(
        (m) => `
      <div class="mg-player">
        <div class="mg-player-head">${avatar(m.avatar_url, m.username, 'mg-av-lg')}<b>${escapeHtml(m.username)}</b></div>
        <div class="mg-perms">
          <button type="button" class="acc-perm ${m.can_see_others_hp ? 'granted' : ''}" data-act="perm" data-cid="${c.id}" data-uid="${m.id}" data-field="can_see_others_hp" data-current="${m.can_see_others_hp}">vê HP dos outros</button>
          <button type="button" class="acc-perm ${m.can_see_hidden_initiative ? 'granted' : ''}" data-act="perm" data-cid="${c.id}" data-uid="${m.id}" data-field="can_see_hidden_initiative" data-current="${m.can_see_hidden_initiative}">vê iniciativas ocultas</button>
          <button type="button" class="acc-perm ${m.is_transport_admin ? 'granted' : ''}" data-act="perm" data-cid="${c.id}" data-uid="${m.id}" data-field="is_transport_admin" data-current="${m.is_transport_admin}">admin do baú</button>
        </div>
        <div class="mg-char-opts">
          <label>Discord do jogador</label>
          <input type="text" class="pf-input" data-player-discord="${m.id}" placeholder="ID numérico da conta" value="${escapeHtml(m.discord_user_id || '')}" />
          <button type="button" class="btn btn-ghost" data-act="save-player-discord" data-uid="${m.id}">vincular</button>
          <span class="mg-fb" data-player-discord-fb="${m.id}"></span>
        </div>
      </div>`
      )
      .join('');
  }

  function discordTab(c) {
    return `
      <div class="mg-char-opts mg-stack">
        <label>🤖 Canal do transporte público</label>
        <input type="text" class="pf-input" data-discord-campaign="${c.id}" placeholder="ID do canal" value="${escapeHtml(discordChannelByCampaign.get(c.id) || '')}" />
        <button type="button" class="btn btn-ghost" data-act="save-camp-discord" data-cid="${c.id}">vincular</button>
        <span class="mg-fb" data-discord-campaign-fb="${c.id}"></span>
      </div>
      <div class="mg-char-opts mg-stack">
        <label>⚔ Canal do aviso de turno</label>
        <input type="text" class="pf-input" data-combat-discord-campaign="${c.id}" placeholder="ID do canal" value="${escapeHtml(combatChannelByCampaign.get(c.id) || '')}" />
        <button type="button" class="btn btn-ghost" data-act="save-combat-discord" data-cid="${c.id}">vincular</button>
        <span class="mg-fb" data-combat-discord-fb="${c.id}"></span>
      </div>
      <div class="mg-char-opts mg-stack">
        <label>🎲 Sessão do Discord</label>
        <button type="button" class="btn ${c.discord_live_session ? 'btn-live-session' : 'btn-ghost'}" data-act="toggle-live" data-cid="${c.id}" data-live="${c.discord_live_session}" ${syncingLiveSession === c.id ? 'disabled' : ''} title="em sessão, o Discord atualiza em tempo real; fora de sessão, só quando alguém clica em 🔄 atualizar">
          ${syncingLiveSession === c.id ? 'sincronizando tudo...' : c.discord_live_session ? '🟢 em sessão (tempo real)' : '⚪ fora de sessão'}
        </button>
        <span class="mg-fb" data-live-fb="${c.id}"></span>
      </div>`;
  }

  function moreTab(c) {
    return `
      ${
        isAdmin
          ? `<div class="mg-char-opts mg-stack"><label>Sistema de regras</label>
          <select class="pf-input" id="system-${c.id}">${gameSystems.map((s) => `<option value="${s.id}" ${s.id === c.system ? 'selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}</select>
          <button type="button" class="btn btn-ghost" data-act="set-system" data-cid="${c.id}">trocar sistema</button>
          <span class="mg-fb">só funciona em mesa sem personagens</span></div>`
          : ''
      }
      ${
        isAdmin
          ? `<div class="mg-char-opts mg-stack"><label>Mestre da mesa</label>
          <select class="pf-input" id="owner-${c.id}">${masterOptions(c.master_id)}</select>
          <button type="button" class="btn btn-ghost" data-act="set-owner" data-cid="${c.id}">passar a mesa</button></div>`
          : ''
      }
      <div class="mg-danger">
        <div><b>Excluir a mesa</b><p class="mg-char-sub">Apaga a mesa e tudo que está nela (personagens, tabuleiro, diário...). As contas dos jogadores continuam.</p></div>
        ${dangerBtn('campaign', c.id, 'excluir mesa')}
      </div>
      ${deleteGateBox('campaign', c.id)}`;
  }

  function campaignCard(c) {
    const isOpen = expanded.has(c.id);
    const tab = campTab.get(c.id) || 'personagens';
    const created = new Date(c.created_at).toLocaleDateString('pt-BR');
    const owner = isAdmin ? accountName(c.master_id) || '—' : null;
    const members = membersByCampaign.get(c.id);
    const chars = charactersByCampaign.get(c.id);
    let detail = '';
    if (isOpen) {
      if (!members || !chars) detail = '<p class="mg-empty">Carregando...</p>';
      else {
        const panes = { personagens: charactersTab(c, members, chars), jogadores: playersTab(c, members), discord: discordTab(c), mais: moreTab(c) };
        const labels = [['personagens', `Personagens (${chars.length})`], ['jogadores', 'Jogadores'], ['discord', 'Discord'], ['mais', 'Mais']];
        detail = `
          <div class="mg-subtabs">${labels.map(([k, l]) => `<button type="button" class="mg-subtab ${tab === k ? 'on' : ''}" data-act="camp-tab" data-cid="${c.id}" data-tab="${k}">${l}</button>`).join('')}</div>
          <div class="mg-pane">${panes[tab]}</div>`;
      }
    }
    return `
      <article class="mg-card mg-camp ${isOpen ? 'open' : ''}" data-camp="${c.id}">
        <div class="mg-camp-head">
          <span class="mg-camp-icon">${escapeHtml((c.name || '?').charAt(0).toUpperCase())}</span>
          <div class="mg-camp-id">
            <h3 class="mg-camp-name">${escapeHtml(c.name)}</h3>
            <div class="mg-chips">
              <span class="mg-chip">👥 ${Math.max(0, (memberCounts.get(c.id) || 1) - 1)} jogador(es)</span>
              ${owner ? `<span class="mg-chip">♛ ${escapeHtml(owner)}</span>` : ''}
              <span class="mg-chip">🎲 ${escapeHtml(systemLabel(c.system))}</span>
              <span class="mg-chip">criada em ${created}</span>
              ${c.discord_live_session ? '<span class="mg-chip mg-chip-live">🟢 em sessão</span>' : ''}
            </div>
          </div>
        </div>
        <div class="mg-camp-actions">
          <button type="button" class="btn" data-act="open-hub" data-cid="${c.id}" data-mode="ficha">Abrir painel da mesa</button>
          <button type="button" class="btn btn-ghost" data-act="open-hub" data-cid="${c.id}" data-mode="combat">⚔ Combate</button>
          <button type="button" class="btn btn-ghost" data-act="open-hub" data-cid="${c.id}" data-mode="ficha">📋 Fichas</button>
          <button type="button" class="btn btn-ghost mg-manage" data-act="toggle-camp" data-cid="${c.id}">${isOpen ? 'fechar ▴' : '⚙ gerenciar ▾'}</button>
        </div>
        ${detail}
      </article>`;
  }

  function mesasView() {
    return `
      ${newCampaignCard()}
      <div class="mg-list">
        ${campaigns.length ? campaigns.map(campaignCard).join('') : '<p class="mg-empty mg-empty-big">Nenhuma mesa ainda. Crie a primeira em “Nova mesa”.</p>'}
      </div>`;
  }

  // ----- aba: Jogadores -----
  function jogadoresView() {
    const rows = playerAccounts
      .map(
        (a) => `
      <div class="mg-acc">
        ${avatar(a.avatar_url, a.username, 'mg-av-lg')}
        <div class="mg-acc-info"><b>${escapeHtml(a.username)}</b>${a.login && a.login !== a.username ? `<span class="mg-char-sub">login: ${escapeHtml(a.login)}</span>` : ''}</div>
        <button type="button" class="btn btn-ghost" data-act="reset-pw" data-uid="${a.id}" data-name="${escapeHtml(a.username)}">nova senha</button>
      </div>`
      )
      .join('');
    return `
      <div class="mg-card">
        <h3 class="mg-card-title">Nova conta de jogador</h3>
        <p class="mg-char-sub">A conta não pertence a mesa nenhuma. Depois de criar, atribua personagens a ela em cada mesa.</p>
        <div class="mg-form">
          <input type="text" id="pl-nick" class="pf-input" placeholder="apelido (login)" />
          <input type="text" id="pl-pass" class="pf-input" placeholder="senha" />
          <button type="button" class="btn" data-act="create-player-acct">＋ criar conta</button>
        </div>
      </div>
      <div class="mg-list">${rows || '<p class="mg-empty mg-empty-big">Nenhuma conta de jogador ainda.</p>'}</div>`;
  }

  // ----- aba: Contas (ADM) -----
  function contasView() {
    const rows = accounts
      .slice()
      .sort((a, b) => (b.is_superadmin ? 1 : 0) - (a.is_superadmin ? 1 : 0) || displayNameOf(a).localeCompare(displayNameOf(b)))
      .map((a) => {
        const isMe = a.id === myId;
        const tag = a.is_superadmin ? '<span class="acc-tag acc-tag-master">ADM</span>' : a.role === 'master' ? '<span class="acc-tag acc-tag-master">mestre</span>' : '<span class="acc-tag">jogador</span>';
        return `
        <div class="mg-acc">
          ${avatar(a.avatar_url, displayNameOf(a), 'mg-av-lg')}
          <div class="mg-acc-info"><b>${escapeHtml(displayNameOf(a))}</b>${tag}${isMe ? '<span class="acc-tag">você</span>' : ''}<span class="mg-char-sub">login: ${escapeHtml(a.username)}</span></div>
          <div class="mg-row-actions">
            <button type="button" class="btn btn-ghost" data-act="reset-pw" data-uid="${a.id}" data-name="${escapeHtml(displayNameOf(a))}">nova senha</button>
            ${!isMe && !a.is_superadmin ? `<button type="button" class="btn btn-ghost" data-act="set-kind" data-uid="${a.id}" data-kind="${a.role === 'master' ? 'player' : 'master'}">virar ${a.role === 'master' ? 'jogador' : 'mestre'}</button>${dangerBtn('account', a.id, 'excluir conta', 'só funciona se a conta não tiver personagens nem mesas')}` : ''}
          </div>
        </div>
        ${deleteGateBox('account', a.id)}`;
      })
      .join('');
    return `
      <div class="mg-card">
        <h3 class="mg-card-title">Nova conta de mestre</h3>
        <p class="mg-char-sub">Mestres criam e administram as próprias mesas. Depois de criar, atribua mesas a ele na aba <b>Mesas</b> (“Mestre da mesa”) ou ao criar uma mesa nova.</p>
        <div class="mg-form">
          <input type="text" id="master-nick" class="pf-input" placeholder="apelido (login)" />
          <input type="text" id="master-pass" class="pf-input" placeholder="senha" />
          <button type="button" class="btn" data-act="create-master">＋ criar mestre</button>
        </div>
      </div>
      <div class="mg-list">${rows}</div>`;
  }

  function render() {
    const scrollY = window.scrollY;
    const success = lastCreatedAccount
      ? `<div class="mg-success">
          <p><b>Conta criada!</b> Passe para a pessoa:</p>
          <p>apelido: <b>${escapeHtml(lastCreatedAccount.nickname)}</b> &nbsp;·&nbsp; senha: <b>${escapeHtml(lastCreatedAccount.password)}</b></p>
          <button type="button" class="btn btn-ghost" data-act="dismiss-account">ok, entendi</button>
        </div>`
      : '';
    const content = view === 'jogadores' ? jogadoresView() : view === 'contas' && isAdmin ? contasView() : mesasView();
    app.innerHTML = `
      <div class="mg-wrap" data-admin-root>
        ${topBar()}
        ${banner ? `<p class="${banner.error ? 'mg-err' : 'mg-ok'}">${escapeHtml(banner.text)}</p>` : ''}
        ${success}
        ${tabsBar()}
        ${content}
      </div>`;
    window.scrollTo(0, scrollY);
  }

  // ---------- ações ----------

  const $ = (sel) => app.querySelector(sel);
  const campaignById = (id) => campaigns.find((c) => c.id === id);

  async function guarded(fn, okText) {
    try {
      await fn();
      banner = okText ? { text: okText, error: false } : null;
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

  function leave() {
    app.onclick = null;
  }

  const actions = {
    signout: async () => {
      await signOut();
      window.location.reload();
    },
    home: () => {
      leave();
      onHome();
    },
    profile: () => {
      leave();
      onOpenProfile();
    },
    view: (el) => {
      view = el.dataset.view;
      banner = null;
      render();
    },
    'dismiss-account': () => {
      lastCreatedAccount = null;
      render();
    },
    'toggle-new-camp': () => {
      newCampOpen = !newCampOpen;
      render();
    },

    'create-campaign': () => {
      const name = $('#new-camp-name').value.trim();
      if (!name) return $('#new-camp-name').focus();
      const ownerSel = $('#new-camp-owner');
      return guarded(async () => {
        const sysSel = $('#new-camp-system');
        await createCampaignAsAdmin(name, ownerSel ? ownerSel.value : null, sysSel ? sysSel.value : 'cave-story');
        newCampOpen = false;
      }, 'mesa criada ✓');
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
      if (!window.confirm(toMaster ? 'Transformar em conta de MESTRE (pode criar mesas)?' : 'Voltar essa conta pra JOGADOR?')) return;
      return guarded(() => setAccountKind(el.dataset.uid, el.dataset.kind), 'tipo da conta alterado ✓');
    },
    'set-system': (el) => {
      const cid = el.dataset.cid;
      const sel = $(`#system-${cid}`);
      return guarded(() => setCampaignSystem(cid, sel.value), 'sistema da mesa alterado ✓');
    },
    'set-owner': (el) => {
      const cid = el.dataset.cid;
      const sel = $(`#owner-${cid}`);
      if (!window.confirm('Passar essa mesa para outro mestre?')) return;
      return guarded(() => setCampaignMaster(cid, sel.value), 'mestre da mesa alterado ✓');
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
      leave();
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
      leave();
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
    'camp-tab': (el) => {
      campTab.set(el.dataset.cid, el.dataset.tab);
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
    app.innerHTML = `<div class="mg-wrap"><div class="auth-card"><p class="auth-error" style="display:block;">Erro ao carregar o painel: ${escapeHtml(err.message)}</p></div></div>`;
  });
}
