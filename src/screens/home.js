import { hpBarClass, sheetDataOf } from '../characterSheet.js';
import { displayNameOf } from '../accounts.js';
import { getRuleset } from '../systems/index.js';

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

const pct = (v, max) => (max > 0 ? Math.max(0, Math.min(100, Math.round((v / max) * 100))) : 0);

function characterCard(c, lastId) {
  const sheet = sheetDataOf(c);
  const level = Number(c.level) || 1;
  const rs = getRuleset(c.campaigns && c.campaigns.system); // cada personagem pelas regras da SUA mesa
  const maxHp = rs.hpMax(c);
  const hp = Math.max(0, Number(c.hp_current) || 0);
  const hpPct = pct(hp, maxHp);
  const need = rs.xpNeeded(level);
  const xpPct = pct(Number(c.xp) || 0, need);
  const subtitle = [sheet.raca, sheet.trabalho].filter(Boolean).join(' · ');
  const portrait = c.avatar_url
    ? `<img class="pk-img" src="${escapeHtml(c.avatar_url)}" alt="" loading="lazy">`
    : `<span class="pk-initial">${escapeHtml((c.name || '?').trim().charAt(0).toUpperCase())}</span>`;
  const isLast = c.id === lastId;
  return `
    <button type="button" class="pk-card ${isLast ? 'pk-card-last' : ''}" data-pick="${c.id}">
      <span class="pk-portrait">
        ${portrait}
        <span class="pk-shade"></span>
        <span class="pk-level">NV ${level}</span>
        ${isLast ? '<span class="pk-last">jogou por último</span>' : ''}
        <span class="pk-play">entrar →</span>
      </span>
      <span class="pk-body">
        <span class="pk-name">${escapeHtml(c.name || 'Personagem')}</span>
        ${subtitle ? `<span class="pk-sub">${escapeHtml(subtitle)}</span>` : ''}
        <span class="pk-bars">
          <span class="pk-bar" title="Vida ${hp}/${maxHp}"><span class="pk-bar-fill pk-hp ${hpBarClass(hpPct)}" style="width:${hpPct}%"></span></span>
          <span class="pk-bar" title="Experiência ${Number(c.xp) || 0}/${need}"><span class="pk-bar-fill pk-xp" style="width:${xpPct}%"></span></span>
        </span>
      </span>
    </button>`;
}

function masterCard(campaign) {
  return `
    <div class="pk-card pk-master">
      <button type="button" class="pk-master-open" data-master="${campaign.id}">
        <span class="pk-portrait pk-master-art">
          <span class="pk-crown">♛</span>
          <span class="pk-master-role">MESTRE</span>
          <span class="pk-play">abrir painel →</span>
        </span>
        <span class="pk-body">
          <span class="pk-name">Painel do mestre</span>
          <span class="pk-sub">combate · fichas · NPCs</span>
        </span>
      </button>
      <button type="button" class="pk-master-manage" data-manage-camp="${campaign.id}">⚙ gerenciar esta mesa</button>
    </div>`;
}

// Tela inicial de TODA conta (jogador, mestre ou ADM): a conta não pertence a mesa nenhuma, quem pertence são os
// personagens. Mostra os personagens agrupados pela mesa em que jogam; nas mesas em que a conta é mestre aparece
// também o cartão "Painel do mestre".
//   onPick(character)       joga com o personagem
//   onOpenMaster(campaign)  abre o painel de mestre daquela mesa
//   onOpenManage()          gestão (mestre: as mesas dele; ADM: tudo) -- só pra mestre/ADM
//   onOpenProfile()         perfil da conta
export function renderHome(app, { profile, characters, masterCampaigns = [], isAdmin = false, lastId, onPick, onOpenMaster, onOpenManage, onOpenProfile }) {
  const manageBanner = () => `
    <button type="button" class="pk-banner" id="home-manage">
      <span class="pk-banner-icon">⚙</span>
      <span class="pk-banner-text">
        <b>${isAdmin ? 'Painel do ADM' : 'Gerenciar mesas'}</b>
        <span>${isAdmin ? 'Mesas, mestres, jogadores e contas de todo o site' : 'Crie mesas, contas de jogadores e personagens; configure o Discord'}</span>
      </span>
      <span class="pk-banner-go">abrir →</span>
    </button>`;
  const groups = new Map();
  const ensure = (id, name) => {
    if (!groups.has(id)) groups.set(id, { name, master: null, list: [] });
    return groups.get(id);
  };
  for (const c of masterCampaigns) ensure(c.id, c.name).master = c;
  for (const c of characters) ensure(c.campaign_id, c.campaigns ? c.campaigns.name : 'Sem mesa').list.push(c);

  const sections = [...groups.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((g) => {
      const n = g.list.length;
      return `
      <section class="pk-group">
        <h2 class="pk-group-title"><span class="pk-group-dot"></span>${escapeHtml(g.name)}<span class="pk-group-count">${g.master ? 'você é o mestre · ' : ''}${n} personagem${n === 1 ? '' : 's'}</span></h2>
        <div class="pk-grid">${g.master ? masterCard(g.master) : ''}${g.list.map((c) => characterCard(c, lastId)).join('')}</div>
      </section>`;
    })
    .join('');

  const name = displayNameOf(profile) || 'aventureiro';
  const chip = profile.avatar_url
    ? `<img class="pk-chip-img" src="${escapeHtml(profile.avatar_url)}" alt="">`
    : `<span class="pk-chip-ph">${escapeHtml(name.charAt(0).toUpperCase())}</span>`;
  const isMasterish = isAdmin || masterCampaigns.length > 0 || profile.role === 'master';
  const hasAny = characters.length > 0 || masterCampaigns.length > 0;

  const lead = hasAny
    ? 'Escolha com quem você joga hoje.'
    : isMasterish
      ? 'Você ainda não tem mesas nem personagens.'
      : 'Você ainda não tem personagens.';
  const emptyText = isMasterish
    ? `Crie uma mesa em "${isAdmin ? 'painel do ADM' : 'gerenciar mesas'}". Personagens que outros mestres atribuírem à sua conta também aparecem aqui.`
    : 'Quando o mestre de uma mesa criar um personagem e atribuir à sua conta, ele aparece aqui, com a foto e a mesa onde joga.';

  app.innerHTML = `
    <div class="pk-wrap">
      <header class="pk-top">
        <div class="title"><span class="dot"></span>INÍCIO</div>
        <div class="pk-top-actions">
          <button type="button" class="pk-chipbtn" id="home-profile" title="meu perfil">${chip}<span class="pk-chip-name">${escapeHtml(name)}</span></button>
        </div>
      </header>

      ${isMasterish ? manageBanner() : ''}

      <div class="pk-hero">
        <p class="pk-hello">Bem-vindo(a),</p>
        <h1 class="pk-account">${escapeHtml(name)}</h1>
        <p class="pk-lead">${lead}</p>
      </div>

      ${sections || `<div class="pk-empty"><span class="pk-empty-icon">✦</span><p>${emptyText}</p></div>`}
    </div>`;

  app.querySelectorAll('button[data-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const c = characters.find((x) => x.id === btn.dataset.pick);
      if (c) onPick(c);
    });
  });
  app.querySelectorAll('button[data-manage-camp]').forEach((btn) => {
    btn.addEventListener('click', () => onOpenManage(btn.dataset.manageCamp));
  });
  app.querySelectorAll('button[data-master]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const c = masterCampaigns.find((x) => x.id === btn.dataset.master);
      if (c) onOpenMaster(c);
    });
  });
  const manage = app.querySelector('#home-manage');
  if (manage) manage.addEventListener('click', () => onOpenManage());
  app.querySelector('#home-profile').addEventListener('click', onOpenProfile);
}
