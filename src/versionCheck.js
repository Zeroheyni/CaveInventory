// Aba aberta com uma versão ANTIGA do site (ex.: ficha do Cave Story aparecendo num personagem do Magic Learning porque o
// navegador guardou o código de antes): confere de tempos em tempos se saiu versão nova e mostra um aviso pra recarregar.
// Só roda no site publicado (no dev não existe version.json).
/* global __BUILD_ID__ */
const CHECK_EVERY_MS = 3 * 60 * 1000;

export function startVersionCheck() {
  if (typeof __BUILD_ID__ === 'undefined' || !import.meta.env.PROD) return;
  let shown = false;

  async function check() {
    if (shown) return;
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const { id } = await res.json();
      if (id && id !== __BUILD_ID__) showBanner();
    } catch (_) {
      /* sem rede / sem version.json: tenta de novo depois */
    }
  }

  function showBanner() {
    shown = true;
    const bar = document.createElement('div');
    bar.id = 'version-banner';
    bar.setAttribute('role', 'status');
    bar.style.cssText =
      'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:99999;display:flex;align-items:center;gap:12px;padding:10px 14px;' +
      'background:#1a1330;color:#fff;border:1px solid #a78bfa;border-radius:10px;font:13px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.5);max-width:calc(100vw - 24px)';
    const txt = document.createElement('span');
    txt.textContent = 'O site foi atualizado. Recarregue pra usar a versão nova.';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'recarregar';
    btn.style.cssText = 'padding:6px 12px;border-radius:8px;border:0;background:#a78bfa;color:#120a24;font-weight:700;cursor:pointer';
    btn.addEventListener('click', () => window.location.reload());
    bar.append(txt, btn);
    document.body.appendChild(bar);
  }

  setInterval(check, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  setTimeout(check, 15000);
}
