// Fase 8 — aba de rolagem de dados, compartilhada em tempo real com a
// campanha inteira. Embutida dentro de character.js (aba "DADOS"), igual
// combat.js/notebook.js -- toda busca de elemento fica restrita à própria
// subárvore do embed.
import { supabase } from '../supabaseClient.js';
import { escapeHtml } from '../shared/gameData.js';
import { rollDice, listRecentRolls, subscribeDiceRolls, clearRolls } from '../dice.js';

const DICE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];

let activeChannel = null;

function formatTime(iso) {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

export function renderDiceScreen(app, { session, profile, campaign }) {
  const campaignId = campaign.id;
  const rollerId = session.user.id;
  const rollerName = profile.username || 'jogador';
  const isMaster = profile.role === 'master';
  const $ = (id) => app.querySelector('#' + id);

  if (activeChannel) {
    supabase.removeChannel(activeChannel);
    activeChannel = null;
  }

  let rolls = [];
  let qty = 1;
  let modifier = 0;
  let rolling = false;
  let error = '';

  async function load() {
    rolls = await listRecentRolls(campaignId);
    render();
  }

  function subscribeRealtime() {
    activeChannel = subscribeDiceRolls(campaignId, async () => {
      rolls = await listRecentRolls(campaignId);
      render();
    });
  }

  function render() {
    app.innerHTML = `
      <div class="dice-wrap">
        <div class="dice-toolbar">
          <span class="dice-title">🎲 ROLAGEM DE DADOS</span>
          ${isMaster ? `<button type="button" class="btn btn-ghost" id="dice-clear-btn">limpar histórico</button>` : ''}
        </div>

        <div class="dice-controls">
          <div class="dice-buttons">
            ${DICE_TYPES.map((d) => `<button type="button" class="dice-die-btn" data-die="${d}" ${rolling ? 'disabled' : ''}>${d}</button>`).join('')}
          </div>
          <div class="dice-modifiers">
            <label class="dice-field">
              <span>quantidade</span>
              <input type="number" id="dice-qty" min="1" max="10" value="${qty}">
            </label>
            <label class="dice-field">
              <span>modificador</span>
              <input type="number" id="dice-modifier" value="${modifier}">
            </label>
          </div>
        </div>

        ${error ? `<p class="admin-error" style="display:block;">${escapeHtml(error)}</p>` : ''}

        <div class="dice-history">
          <div class="log-panel-head">HISTÓRICO DA CAMPANHA</div>
          ${
            rolls.length === 0
              ? `<p class="admin-empty">ninguém rolou nada ainda.</p>`
              : rolls
                  .map(
                    (r) => `
              <div class="dice-roll-entry">
                <span class="log-time">${formatTime(r.created_at)}</span>
                <span class="dice-roll-who">${escapeHtml(r.roller_name)}</span>
                <span class="dice-roll-formula">${r.qty}${r.die}${r.modifier ? (r.modifier > 0 ? '+' + r.modifier : r.modifier) : ''}</span>
                <span class="dice-roll-results">[${r.results.join(', ')}]</span>
                <span class="dice-roll-total">${r.total}</span>
              </div>`
                  )
                  .join('')
          }
        </div>
      </div>
    `;

    $('dice-qty').addEventListener('change', (e) => {
      qty = Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1));
    });
    $('dice-modifier').addEventListener('change', (e) => {
      modifier = parseInt(e.target.value, 10) || 0;
    });
    app.querySelectorAll('.dice-die-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (rolling) return;
        rolling = true;
        error = '';
        render();
        try {
          await rollDice(campaignId, rollerId, rollerName, btn.dataset.die, qty, modifier);
        } catch (err) {
          error = err.message;
        }
        rolling = false;
        render();
      });
    });
    const clearBtn = $('dice-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (!window.confirm('Apagar todo o histórico de rolagens da campanha?')) return;
        try {
          await clearRolls(campaignId);
        } catch (err) {
          error = err.message;
          render();
        }
      });
    }
  }

  load();
  subscribeRealtime();
}
