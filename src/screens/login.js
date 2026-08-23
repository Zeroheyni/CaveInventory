import { signIn } from '../auth.js';

export function renderLogin(app, onDone) {
  function html() {
    return `
      <div class="auth-shell">
        <div class="header" style="border:none; margin-bottom:24px;">
          <div class="title"><span class="dot"></span>INVENTÁRIO // TERMINAL DE CAMPO</div>
        </div>
        <div class="auth-card">
          <form id="auth-form">
            <div class="auth-field">
              <label>APELIDO</label>
              <input type="text" id="auth-nickname" required autocomplete="username" autocapitalize="off" />
            </div>
            <div class="auth-field">
              <label>SENHA</label>
              <input type="password" id="auth-password" required autocomplete="current-password" />
            </div>
            <button type="submit" class="btn auth-submit">ENTRAR</button>
            <p class="auth-error" id="auth-error" style="display:none;"></p>
          </form>
          <p class="auth-hint">Não tem apelido e senha ainda? Peça pro mestre da sua mesa criar sua conta.</p>
        </div>
      </div>
    `;
  }

  function render() {
    app.innerHTML = html();
    app.querySelector('#auth-form').addEventListener('submit', handleSubmit);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const nickname = app.querySelector('#auth-nickname').value.trim();
    const password = app.querySelector('#auth-password').value;
    const errorEl = app.querySelector('#auth-error');
    errorEl.style.display = 'none';

    const { error } = await signIn(nickname, password);

    if (error) {
      errorEl.textContent = 'Apelido ou senha incorretos.';
      errorEl.style.display = 'block';
      return;
    }

    onDone();
  }

  render();
}
