// Fase 5 — dashboard do mestre: cartão rápido (foto + nome + HP +
// Estamina) de cada jogador da campanha, com acesso direto à ficha
// completa de qualquer um, e o menu de dar XP em massa (todos
// marcados por padrão — o mestre só desmarca quem não deve ganhar).
import { escapeHtml } from '../shared/gameData.js';
import { listCampaignCharacterSheets, subscribeCampaignSheets, hpMax, estaminaMax, grantXp, hpBarClass } from '../characterSheet.js';
import { renderFichaScreen } from './ficha.js';

export function renderMasterFichaScreen(app, { session, profile, campaign, onBack }) {
  const campaignId = campaign.id;
  const $ = (id) => app.querySelector('#' + id);

  let characters = [];
  let selected = new Set();
  let firstLoad = true;
  let xpFeedback = '';
  let channel = null;
  let viewingCharacterId = null;
  let realtimeReloadTimer = null;

  async function load() {
    const fresh = await listCampaignCharacterSheets(campaignId);
    if (firstLoad) {
      firstLoad = false;
      selected = new Set(fresh.map((c) => c.id));
    } else {
      const freshIds = new Set(fresh.map((c) => c.id));
      selected = new Set([...selected].filter((id) => freshIds.has(id)));
      fresh.forEach((c) => {
        if (!characters.some((old) => old.id === c.id)) selected.add(c.id); // personagem novo entra marcado
      });
    }
    characters = fresh;
    render();
    if (!channel) {
      // debounce -- evita remontar a ficha aberta (perdendo edição em
      // andamento) toda vez que QUALQUER personagem da campanha muda.
      channel = subscribeCampaignSheets(campaignId, () => {
        clearTimeout(realtimeReloadTimer);
        realtimeReloadTimer = setTimeout(load, 700);
      });
    }
  }

  function render() {
    if (viewingCharacterId) {
      renderFichaScreen(app, {
        session,
        profile,
        campaign,
        characterId: viewingCharacterId,
        onBack: () => {
          viewingCharacterId = null;
          render();
        },
      });
      return;
    }

    app.innerHTML = `
      ${onBack ? `<button type="button" class="btn btn-ghost" id="master-ficha-back-btn" style="margin-bottom:12px;">← voltar ao painel</button>` : ''}
      <div class="ficha-section-title" style="margin-bottom:10px;">FICHAS DA CAMPANHA</div>
      <div class="ficha-dash-grid">
        ${characters.length === 0 ? '<p class="admin-empty">nenhum personagem nessa campanha ainda.</p>' : characters.map((c) => dashCard(c)).join('')}
      </div>
      ${xpPanel()}
    `;
    wireEvents();
  }

  function dashCard(c) {
    const hMax = hpMax(c);
    const eMax = estaminaMax(c);
    const hpPct = hMax > 0 ? Math.round((c.hp_current / hMax) * 100) : 0;
    const ePct = eMax > 0 ? Math.round((c.estamina_current / eMax) * 100) : 0;
    return `
      <button type="button" class="ficha-dash-card" data-open-ficha="${c.id}">
        ${c.avatar_url ? `<img class="ficha-dash-avatar" src="${escapeHtml(c.avatar_url)}" alt="">` : `<div class="ficha-dash-avatar"></div>`}
        <div class="ficha-dash-info">
          <div class="ficha-dash-name">${escapeHtml(c.name)} <span style="color:var(--ink-faint); font-weight:400;">Nv.${c.level}</span></div>
          <div class="ficha-dash-bar-row"><span class="ficha-dash-bar-icon">❤</span><div class="combat-hp-bar"><div class="combat-hp-fill ${hpBarClass(hpPct)}" style="width:${hpPct}%"></div></div></div>
          <div class="ficha-dash-bar-row"><span class="ficha-dash-bar-icon">⚡</span><div class="combat-hp-bar"><div class="combat-hp-fill ficha-estamina-fill" style="width:${ePct}%"></div></div></div>
        </div>
      </button>`;
  }

  function xpPanel() {
    return `
      <div class="ficha-xp-panel">
        <div class="ficha-xp-panel-head">🎖 DAR XP</div>
        ${
          characters.length === 0
            ? '<p class="admin-empty">nenhum personagem pra dar XP ainda.</p>'
            : characters
                .map(
                  (c) => `
          <label class="ficha-xp-player-row">
            <input type="checkbox" data-xp-check="${c.id}" ${selected.has(c.id) ? 'checked' : ''}>
            ${c.avatar_url ? `<img src="${escapeHtml(c.avatar_url)}" alt="">` : '<img alt="">'}
            <span>${escapeHtml(c.name)} <span style="color:var(--ink-faint);">(Nv.${c.level})</span></span>
          </label>`
                )
                .join('')
        }
        <div class="ficha-xp-input-row">
          <input type="number" id="ficha-xp-amount" min="1" placeholder="quantidade de XP">
          <button type="button" class="btn" id="ficha-xp-give-btn">dar XP</button>
        </div>
        ${xpFeedback ? `<p class="admin-error" style="display:block;">${escapeHtml(xpFeedback)}</p>` : ''}
      </div>
    `;
  }

  let wired = false;
  function wireEvents() {
    if (wired) return;
    wired = true;

    app.addEventListener('click', async (e) => {
      const backBtn = e.target.closest('#master-ficha-back-btn');
      if (backBtn) return onBack && onBack();

      const cardBtn = e.target.closest('button[data-open-ficha]');
      if (cardBtn) {
        viewingCharacterId = cardBtn.dataset.openFicha;
        render();
        return;
      }

      const giveBtn = e.target.closest('#ficha-xp-give-btn');
      if (giveBtn) {
        xpFeedback = '';
        const amountInput = $('ficha-xp-amount');
        const amount = parseInt(amountInput.value);
        const ids = [...selected];
        if (!amount || amount <= 0) {
          xpFeedback = 'informe uma quantidade de XP válida.';
          render();
          return;
        }
        if (ids.length === 0) {
          xpFeedback = 'marque pelo menos um jogador.';
          render();
          return;
        }
        try {
          await grantXp(ids, amount);
          xpFeedback = `+${amount} XP dado pra ${ids.length} jogador(es) ✓`;
          await load();
        } catch (err) {
          xpFeedback = 'erro: ' + err.message;
          render();
        }
        return;
      }
    });

    app.addEventListener('change', (e) => {
      const checkbox = e.target.closest('input[data-xp-check]');
      if (checkbox) {
        if (checkbox.checked) selected.add(checkbox.dataset.xpCheck);
        else selected.delete(checkbox.dataset.xpCheck);
      }
    });
  }

  load();
}
