import { createCampaign, joinCampaign } from '../campaign.js';
import { signOut } from '../auth.js';

export function renderOnboarding(app, onDone) {
  let mode = 'create'; // 'create' | 'join'

  function html() {
    return `
      <div class="auth-shell">
        <div class="header" style="border:none; margin-bottom:24px;">
          <div class="title"><span class="dot"></span>NOVO OPERADOR // SEM CAMPANHA</div>
        </div>
        <div class="auth-card">
          <div class="auth-tabs">
            <button class="auth-tab ${mode === 'create' ? 'active' : ''}" data-mode="create">CRIAR CAMPANHA</button>
            <button class="auth-tab ${mode === 'join' ? 'active' : ''}" data-mode="join">ENTRAR COM CÓDIGO</button>
          </div>
          <form id="onboard-form">
            <div class="auth-field">
              <label>SEU NOME DE JOGADOR</label>
              <input type="text" id="ob-username" required maxlength="40" />
            </div>
            ${
              mode === 'create'
                ? `<div class="auth-field">
                     <label>NOME DA CAMPANHA</label>
                     <input type="text" id="ob-campaign-name" required maxlength="60" />
                   </div>`
                : `<div class="auth-field">
                     <label>CÓDIGO DE CONVITE</label>
                     <input type="text" id="ob-invite-code" required maxlength="16" style="text-transform:uppercase;" />
                   </div>`
            }
            <button type="submit" class="btn auth-submit">${mode === 'create' ? 'CRIAR E VIRAR MESTRE' : 'ENTRAR NA CAMPANHA'}</button>
            <p class="auth-error" id="ob-error" style="display:none;"></p>
          </form>
        </div>
        <p class="auth-hint"><a href="#" id="ob-signout" style="color:var(--ink-faint);">sair da conta</a></p>
      </div>
    `;
  }

  function render() {
    app.innerHTML = html();
    app.querySelectorAll('.auth-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        mode = btn.dataset.mode;
        render();
      });
    });
    app.querySelector('#onboard-form').addEventListener('submit', handleSubmit);
    app.querySelector('#ob-signout').addEventListener('click', async (e) => {
      e.preventDefault();
      await signOut();
      onDone();
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const username = app.querySelector('#ob-username').value.trim();
    const errorEl = app.querySelector('#ob-error');
    errorEl.style.display = 'none';

    try {
      if (mode === 'create') {
        const name = app.querySelector('#ob-campaign-name').value.trim();
        await createCampaign(name, username);
      } else {
        const inviteCode = app.querySelector('#ob-invite-code').value.trim();
        await joinCampaign(inviteCode, username);
      }
      onDone();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
    }
  }

  render();
}
