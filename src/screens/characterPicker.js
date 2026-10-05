import { signOut } from '../auth.js';
import { hpMax, hpBarClass, xpNeeded, sheetDataOf } from '../characterSheet.js';

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

const pct = (v, max) => (max > 0 ? Math.max(0, Math.min(100, Math.round((v / max) * 100))) : 0);

function card(c, lastId) {
  const sheet = sheetDataOf(c);
  const level = Number(c.level) || 1;
  const maxHp = hpMax(c);
  const hp = Math.max(0, Number(c.hp_current) || 0);
  const hpPct = pct(hp, maxHp);
  const need = xpNeeded(level);
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

// Tela inicial da conta de jogador: a conta não pertence a mesa nenhuma, quem pertence são os personagens.
// Mostra todos os personagens da conta, agrupados pela mesa em que jogam.
// onPick(character) abre o personagem; onOpenPanel (opcional) só aparece pra quem também é mestre.
export function renderCharacterPicker(app, { profile, characters, lastId, onPick, onOpenPanel }) {
  const groups = new Map();
  for (const c of characters) {
    const key = c.campaign_id;
    if (!groups.has(key)) groups.set(key, { name: c.campaigns ? c.campaigns.name : 'Sem mesa', list: [] });
    groups.get(key).list.push(c);
  }

  const sections = [...groups.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (g) => `
      <section class="pk-group">
        <h2 class="pk-group-title"><span class="pk-group-dot"></span>${escapeHtml(g.name)}<span class="pk-group-count">${g.list.length} personagem${g.list.length > 1 ? 's' : ''}</span></h2>
        <div class="pk-grid">${g.list.map((c) => card(c, lastId)).join('')}</div>
      </section>`
    )
    .join('');

  app.innerHTML = `
    <div class="pk-wrap">
      <header class="pk-top">
        <div class="title"><span class="dot"></span>PERSONAGENS</div>
        <div class="pk-top-actions">
          ${onOpenPanel ? '<button type="button" class="campaign-strip-signout" id="picker-panel">painel do mestre</button>' : ''}
          <button type="button" class="campaign-strip-signout" id="picker-signout">sair</button>
        </div>
      </header>

      <div class="pk-hero">
        <p class="pk-hello">Bem-vindo(a),</p>
        <h1 class="pk-account">${escapeHtml(profile.username || 'aventureiro')}</h1>
        <p class="pk-lead">${
          characters.length
            ? 'Escolha com quem você joga hoje.'
            : 'Você ainda não tem personagens.'
        }</p>
      </div>

      ${
        characters.length
          ? sections
          : `<div class="pk-empty">
              <span class="pk-empty-icon">✦</span>
              <p>Quando o mestre de uma mesa criar um personagem e atribuir à sua conta, ele aparece aqui, com a foto e a mesa onde joga.</p>
            </div>`
      }
    </div>`;

  app.querySelectorAll('button[data-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const c = characters.find((x) => x.id === btn.dataset.pick);
      if (c) onPick(c);
    });
  });
  const panel = app.querySelector('#picker-panel');
  if (panel) panel.addEventListener('click', onOpenPanel);
  app.querySelector('#picker-signout').addEventListener('click', async () => {
    await signOut();
    window.location.reload();
  });
}
