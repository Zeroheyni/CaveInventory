import { signOut } from '../auth.js';

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

// Tela de escolha de personagem: a conta joga qualquer personagem dela, de qualquer campanha.
// onPick(character) abre o personagem; onOpenPanel (opcional) só aparece pra quem também é mestre.
export function renderCharacterPicker(app, { profile, characters, lastId, onPick, onOpenPanel }) {
  const cards = characters
    .map((c) => {
      const campName = c.campaigns ? c.campaigns.name : '—';
      const avatar = c.avatar_url
        ? `<img class="picker-avatar" src="${escapeHtml(c.avatar_url)}" alt="">`
        : `<span class="picker-avatar picker-avatar-ph">${escapeHtml((c.name || '?').charAt(0).toUpperCase())}</span>`;
      return `
        <button type="button" class="picker-card ${c.id === lastId ? 'picker-card-last' : ''}" data-pick="${c.id}">
          ${avatar}
          <span class="picker-info">
            <span class="picker-name">${escapeHtml(c.name || 'Personagem')}</span>
            <span class="picker-meta">${escapeHtml(campName)} · nível ${Number(c.level) || 1}</span>
          </span>
          ${c.id === lastId ? '<span class="picker-last-tag">último</span>' : ''}
        </button>`;
    })
    .join('');

  app.innerHTML = `
    <div class="wrap admin-wrap">
      <div class="admin-header">
        <div class="title"><span class="dot"></span>ESCOLHA SEU PERSONAGEM</div>
        <div style="display:flex; gap:8px;">
          ${onOpenPanel ? '<button type="button" class="campaign-strip-signout" id="picker-panel">painel do mestre</button>' : ''}
          <button type="button" class="campaign-strip-signout" id="picker-signout">sair</button>
        </div>
      </div>
      <p class="admin-empty" style="margin-top:0;">Conta: <b>${escapeHtml(profile.username || '')}</b></p>
      ${
        characters.length === 0
          ? '<div class="admin-card"><p class="admin-empty">Nenhum personagem nessa conta ainda. Peça ao mestre da sua mesa pra criar um e atribuir a você.</p></div>'
          : `<div class="picker-list">${cards}</div>`
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
