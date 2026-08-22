import { signOut } from '../auth.js';

export function renderLoggedIn(app, onDone, { session, profile, campaign }) {
  app.innerHTML = `
    <div class="auth-shell">
      <div class="header" style="border:none; margin-bottom:24px;">
        <div class="title"><span class="dot"></span>LOGADO COM SUCESSO</div>
      </div>
      <div class="auth-card">
        <div class="auth-summary-row"><span>Jogador</span><b>${escapeHtml(profile.username)}</b></div>
        <div class="auth-summary-row"><span>Papel</span><b>${profile.role === 'master' ? 'MESTRE' : 'JOGADOR'}</b></div>
        <div class="auth-summary-row"><span>Campanha</span><b>${escapeHtml(campaign.name)}</b></div>
        <div class="auth-summary-row"><span>E-mail</span><b style="font-size:11px;">${escapeHtml(session.user.email)}</b></div>
        ${
          profile.role === 'master'
            ? `<p class="auth-hint" style="margin-bottom:0;">Código de convite (compartilhe com os jogadores)</p>
               <div class="auth-invite-code">${escapeHtml(campaign.invite_code)}</div>`
            : ''
        }
      </div>
      <p class="auth-hint">Fase 1 concluída. O inventário de verdade chega na Fase 2.</p>
      <p class="auth-hint"><a href="#" id="li-signout" style="color:var(--ink-faint);">sair da conta</a></p>
    </div>
  `;
  app.querySelector('#li-signout').addEventListener('click', async (e) => {
    e.preventDefault();
    await signOut();
    onDone();
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
