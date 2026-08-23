import { signOut } from '../auth.js';

// Agora só o mestre cria mesas e vincula contas a elas (veja o painel do
// mestre). Se alguém logar sem estar vinculado a nenhuma mesa ainda, mostra
// esta tela de espera em vez do fluxo antigo de criar/entrar por conta própria.
export function renderOnboarding(app, onDone) {
  app.innerHTML = `
    <div class="auth-shell">
      <div class="header" style="border:none; margin-bottom:24px;">
        <div class="title"><span class="dot"></span>AGUARDANDO O MESTRE</div>
      </div>
      <div class="auth-card">
        <p class="auth-hint" style="margin-top:0;">Sua conta ainda não está vinculada a nenhuma mesa. Avise o mestre — ele vincula sua conta pelo painel dele.</p>
      </div>
      <p class="auth-hint"><a href="#" id="ob-signout" style="color:var(--ink-faint);">sair da conta</a></p>
    </div>
  `;
  app.querySelector('#ob-signout').addEventListener('click', async (e) => {
    e.preventDefault();
    await signOut();
    onDone();
  });
}
