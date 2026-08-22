import { signIn, signUp } from '../auth.js';

export function renderLogin(app, onDone) {
  let mode = 'signin'; // 'signin' | 'signup'

  function html() {
    return `
      <div class="auth-shell">
        <div class="header" style="border:none; margin-bottom:24px;">
          <div class="title"><span class="dot"></span>INVENTÁRIO // TERMINAL DE CAMPO</div>
        </div>
        <div class="auth-card">
          <div class="auth-tabs">
            <button class="auth-tab ${mode === 'signin' ? 'active' : ''}" data-mode="signin">ENTRAR</button>
            <button class="auth-tab ${mode === 'signup' ? 'active' : ''}" data-mode="signup">CRIAR CONTA</button>
          </div>
          <form id="auth-form">
            <div class="auth-field">
              <label>E-MAIL</label>
              <input type="email" id="auth-email" required autocomplete="email" />
            </div>
            <div class="auth-field">
              <label>SENHA</label>
              <input type="password" id="auth-password" required minlength="6" autocomplete="${mode === 'signin' ? 'current-password' : 'new-password'}" />
            </div>
            <button type="submit" class="btn auth-submit">${mode === 'signin' ? 'ENTRAR' : 'CRIAR CONTA'}</button>
            <p class="auth-error" id="auth-error" style="display:none;"></p>
          </form>
          ${mode === 'signup' ? '<p class="auth-hint">Depois de criar a conta, confirme o e-mail (se seu projeto Supabase exigir) e entre normalmente.</p>' : ''}
        </div>
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
    app.querySelector('#auth-form').addEventListener('submit', handleSubmit);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const email = app.querySelector('#auth-email').value.trim();
    const password = app.querySelector('#auth-password').value;
    const errorEl = app.querySelector('#auth-error');
    errorEl.style.display = 'none';

    const { error } = mode === 'signin' ? await signIn(email, password) : await signUp(email, password);

    if (error) {
      errorEl.textContent = error.message;
      errorEl.style.display = 'block';
      return;
    }

    if (mode === 'signup') {
      errorEl.style.color = 'var(--accent)';
      errorEl.textContent = 'Conta criada. Se a confirmação por e-mail estiver ativa no projeto, confirme antes de entrar.';
      errorEl.style.display = 'block';
      return;
    }

    onDone();
  }

  render();
}
