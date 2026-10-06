import { signOut } from '../auth.js';
import { displayNameOf, updateMyProfile, uploadProfileAvatar, changeMyPassword, ACCOUNT_COLORS, setMyColor, accountColorOf } from '../accounts.js';

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

// Perfil da conta (jogador, mestre ou ADM): foto, nome de exibição, bio e senha.
// O apelido de LOGIN não muda (é ele que vira o identificador da conta); o nome de exibição é o que aparece pros outros.
export function renderProfileScreen(app, { session, profile, kinds = [], onBack }) {
  let current = { ...profile };
  let busy = false;

  const roleChips = kinds.map((k) => `<span class="pf-chip">${escapeHtml(k)}</span>`).join('');

  function avatarHtml() {
    return current.avatar_url
      ? `<img class="pf-avatar-img" src="${escapeHtml(current.avatar_url)}" alt="">`
      : `<span class="pf-avatar-ph">${escapeHtml(displayNameOf(current).charAt(0).toUpperCase() || '?')}</span>`;
  }

  function render() {
    app.innerHTML = `
      <div class="pf-wrap">
        <header class="pk-top">
          <div class="title"><span class="dot"></span>MEU PERFIL</div>
          <div class="pk-top-actions">
            <button type="button" class="campaign-strip-signout" id="pf-back">← voltar</button>
            <button type="button" class="campaign-strip-signout" id="pf-signout">sair</button>
          </div>
        </header>

        <section class="pf-card pf-hero">
          <div class="pf-avatar-wrap">
            <button type="button" class="pf-avatar" id="pf-avatar-btn" title="trocar foto">
              ${avatarHtml()}
              <span class="pf-avatar-edit">📷 trocar foto</span>
            </button>
            <input type="file" id="pf-avatar-input" accept="image/*" hidden>
          </div>
          <div class="pf-hero-text">
            <h1 class="pf-name">${escapeHtml(displayNameOf(current))}</h1>
            <p class="pf-login">login: <b>${escapeHtml(current.username || '')}</b></p>
            <div class="pf-chips">${roleChips}</div>
            ${current.bio ? `<p class="pf-bio">${escapeHtml(current.bio)}</p>` : ''}
          </div>
        </section>

        <section class="pf-card">
          <h2 class="pf-title">Cor da conta</h2>
          <p class="pf-hint" style="margin:0 0 12px;">Sua cor aparece no tabuleiro: borda dos seus tokens, ping, desenhos e o cursor que seus amigos veem.</p>
          <div class="pf-swatches">
            ${ACCOUNT_COLORS.map((c) => `<button type="button" class="pf-sw ${(accountColorOf(current) || '') === c ? 'on' : ''}" data-color="${c}" style="--c:${c}" title="${c}"></button>`).join('')}
            <label class="pf-sw pf-sw-custom ${accountColorOf(current) && !ACCOUNT_COLORS.includes(accountColorOf(current)) ? 'on' : ''}" title="outra cor" style="--c:${accountColorOf(current) || '#888888'}">
              <input type="color" id="pf-color-input" value="${accountColorOf(current) || '#5ad4ff'}">
              <span>+</span>
            </label>
          </div>
          <div class="pf-cursor-preview" style="--cc:${accountColorOf(current) || '#5ad4ff'}">
            <svg viewBox="0 0 24 24" width="22" height="22" style="fill:var(--cc);"><path d="M4 2l16 7.5-6.8 1.7L11 18z"/></svg>
            <span class="pf-cursor-who">
              ${current.avatar_url ? `<img class="pf-cursor-pic" src="${escapeHtml(current.avatar_url)}" alt="">` : `<span class="pf-cursor-pic pf-cursor-ph">${escapeHtml(displayNameOf(current).charAt(0).toUpperCase() || '?')}</span>`}
              <span class="pf-cursor-label">${escapeHtml(displayNameOf(current))}</span>
            </span>
            <span class="pf-cursor-note">assim seus amigos veem seu cursor <span class="pf-msg" id="pf-color-msg"></span></span>
          </div>
        </section>

        <section class="pf-card">
          <h2 class="pf-title">Sobre você</h2>
          <label class="pf-label" for="pf-display">Nome de exibição</label>
          <input type="text" id="pf-display" class="pf-input" maxlength="40" value="${escapeHtml(current.display_name || '')}" placeholder="${escapeHtml(current.username || '')}">
          <p class="pf-hint">É o nome que os outros veem. O apelido de login (<b>${escapeHtml(current.username || '')}</b>) continua o mesmo.</p>
          <label class="pf-label" for="pf-bio">Bio <span class="pf-count" id="pf-bio-count"></span></label>
          <textarea id="pf-bio" class="pf-input" rows="3" maxlength="280" placeholder="Fale um pouco sobre você, seus personagens favoritos...">${escapeHtml(current.bio || '')}</textarea>
          <div class="pf-actions">
            <button type="button" class="btn" id="pf-save">salvar perfil</button>
            <span class="pf-msg" id="pf-msg"></span>
          </div>
        </section>

        <section class="pf-card">
          <h2 class="pf-title">Trocar senha</h2>
          <label class="pf-label" for="pf-pass-now">Senha atual</label>
          <input type="password" id="pf-pass-now" class="pf-input" autocomplete="current-password">
          <label class="pf-label" for="pf-pass-new">Nova senha</label>
          <input type="password" id="pf-pass-new" class="pf-input" autocomplete="new-password">
          <label class="pf-label" for="pf-pass-new2">Repita a nova senha</label>
          <input type="password" id="pf-pass-new2" class="pf-input" autocomplete="new-password">
          <div class="pf-actions">
            <button type="button" class="btn" id="pf-pass-save">trocar senha</button>
            <span class="pf-msg" id="pf-pass-msg"></span>
          </div>
        </section>
      </div>`;

    const $ = (id) => app.querySelector('#' + id);
    const msg = (id, text, ok = true) => {
      const el = $(id);
      el.textContent = text;
      el.className = 'pf-msg ' + (ok ? 'pf-ok' : 'pf-err');
    };
    const bioEl = $('pf-bio');
    const updateCount = () => ($('pf-bio-count').textContent = `${bioEl.value.length}/280`);
    bioEl.addEventListener('input', updateCount);
    updateCount();

    $('pf-back').addEventListener('click', () => onBack(current));
    $('pf-signout').addEventListener('click', async () => {
      await signOut();
      window.location.reload();
    });

    async function pickColor(c) {
      try {
        await setMyColor(c);
        current.color = c.toLowerCase();
        render();
        const m = app.querySelector('#pf-color-msg');
        if (m) { m.textContent = 'cor salva ✓'; m.className = 'pf-msg pf-ok'; }
      } catch (err) {
        const m = app.querySelector('#pf-color-msg');
        if (m) { m.textContent = err.message; m.className = 'pf-msg pf-err'; }
      }
    }
    app.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => pickColor(b.dataset.color)));
    const colorInput = $('pf-color-input');
    if (colorInput) colorInput.addEventListener('change', () => pickColor(colorInput.value));

    $('pf-avatar-btn').addEventListener('click', () => $('pf-avatar-input').click());
    $('pf-avatar-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file || busy) return;
      const { openAvatarEditor } = await import('../avatarEditor.js');
      const blob = await openAvatarEditor(file);
      if (!blob) return;
      busy = true;
      try {
        const url = await uploadProfileAvatar(current.id, blob);
        await updateMyProfile(current.id, { avatar_url: url });
        current.avatar_url = url;
        render();
      } catch (err) {
        busy = false;
        window.alert('Erro ao enviar a foto: ' + err.message);
        return;
      }
      busy = false;
    });

    $('pf-save').addEventListener('click', async () => {
      try {
        const patch = await updateMyProfile(current.id, { display_name: $('pf-display').value, bio: bioEl.value });
        current = { ...current, ...patch };
        render();
        msg('pf-msg', 'perfil salvo ✓');
      } catch (err) {
        msg('pf-msg', err.message, false);
      }
    });

    $('pf-pass-save').addEventListener('click', async () => {
      const now = $('pf-pass-now').value;
      const next = $('pf-pass-new').value;
      if (!now || !next) return msg('pf-pass-msg', 'preencha a senha atual e a nova', false);
      if (next !== $('pf-pass-new2').value) return msg('pf-pass-msg', 'as senhas novas não são iguais', false);
      try {
        await changeMyPassword(session.user.email, now, next);
        $('pf-pass-now').value = $('pf-pass-new').value = $('pf-pass-new2').value = '';
        msg('pf-pass-msg', 'senha alterada ✓');
      } catch (err) {
        msg('pf-pass-msg', err.message, false);
      }
    });
  }

  render();
}
