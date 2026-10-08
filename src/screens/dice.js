// Fase 8 — aba de rolagem de dados, compartilhada em tempo real com a
// campanha inteira. Embutida dentro de character.js (aba "DADOS"), igual
// combat.js/notebook.js -- toda busca de elemento fica restrita à própria
// subárvore do embed.
import { supabase } from '../supabaseClient.js';
import { escapeHtml } from '../shared/gameData.js';
import { rollDice, listRecentRolls, subscribeDiceRolls, clearRolls, DICE_PRESETS, normalizeCustomDie, getHiddenRollMode, setHiddenRollMode, onHiddenRollMode, revealRoll } from '../dice.js';

function formatTime(iso) {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// `topicSuffix` opcional (Fase 4 do tabuleiro) -- mesmo motivo/padrão
// de combat.js: essa tela agora pode ser montada em DOIS lugares ao
// mesmo tempo na mesma sessão (a aba Dados normal E o painel "Dados"
// do HUD do tabuleiro) -- activeChannel virou variável LOCAL em vez
// de módulo, e o topic ganha o sufixo pra não colidir entre as duas
// instâncias. Quem não passa nada continua exatamente como antes.
export function renderDiceScreen(app, { session, profile, campaign, topicSuffix }) {
  const campaignId = campaign.id;
  const rollerId = session.user.id;
  const rollerName = profile.username || 'jogador';
  const isMaster = profile.role === 'master';
  const $ = (id) => app.querySelector('#' + id);
  const suffix = topicSuffix || '';

  let activeChannel = null;

  let rolls = [];
  let qty = 1;
  let modifier = 0;
  let customValue = '';
  let rolling = false;
  let error = '';

  // achado testando o HUD do tabuleiro (Fase 4b, via harness isolado --
  // sem login de teste nesse ambiente pra reproduzir com conta real):
  // sem o try/catch aqui, uma falha na consulta inicial (rede, RLS,
  // timing de auth etc) rejeitava a promise de `load()` ANTES de
  // chegar em `render()` -- como `load()` é chamada sem `await`/catch
  // lá embaixo, a rejeição virava uma "unhandled promise rejection"
  // silenciosa e a tela inteira ficava em branco pra sempre (essa
  // tela só monta uma vez por sessão, nunca tenta de novo sozinha).
  // Provavelmente a causa real do "esse dado não tá funcionando" --
  // o drawer abria (CSS) mas o conteúdo nunca aparecia.
  async function load() {
    try {
      rolls = await listRecentRolls(campaignId);
      error = '';
    } catch (err) {
      error = err.message;
    }
    render();
  }

  function subscribeRealtime() {
    activeChannel = subscribeDiceRolls(
      campaignId,
      () => {
        // fire-and-forget com o mesmo cuidado de load() -- uma falha
        // aqui não pode virar unhandled rejection.
        load();
      },
      'dice-' + campaignId + suffix
    );
  }

  function render() {
    app.innerHTML = `
      <div class="dice-wrap">
        <div class="dice-toolbar">
          <span class="dice-title">🎲 ROLAGEM DE DADOS</span>
          ${
            isMaster
              ? `<button type="button" class="btn btn-ghost dice-hidden-toggle ${getHiddenRollMode() ? 'on' : ''}" id="dice-hidden-toggle" title="enquanto ligado, só você vê as suas rolagens (até clicar em revelar)">🙈 rolagem oculta: ${getHiddenRollMode() ? 'LIGADA' : 'desligada'}</button>
                 <button type="button" class="btn btn-ghost" id="dice-clear-btn">limpar histórico</button>`
              : ''
          }
        </div>

        <div class="dice-controls">
          <div class="dice-buttons">
            ${DICE_PRESETS.map((d) => `<button type="button" class="dice-die-btn" data-die="${d}" ${rolling ? 'disabled' : ''}>${d}</button>`).join('')}
            <div class="dice-custom-row">
              <span class="dice-custom-prefix">d</span>
              <input type="number" id="dice-custom-value" min="2" max="1000" placeholder="ex: 132" value="${escapeHtml(customValue)}">
              <button type="button" class="dice-custom-roll-btn" id="dice-custom-roll-btn" ${rolling ? 'disabled' : ''}>rolar</button>
            </div>
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
              <div class="dice-roll-entry ${r.hidden ? 'is-hidden' : ''}">
                <span class="log-time">${formatTime(r.created_at)}</span>
                ${r.hidden ? `<span class="dice-hidden-tag" title="só os mestres veem">🙈 oculta</span><button type="button" class="dice-reveal-btn" data-reveal="${r.id}">revelar</button>` : ''}
                <span class="dice-roll-who">${escapeHtml(r.roller_name)}</span>
                ${r.label ? `<span class="dice-roll-label">🎯 ${escapeHtml(r.label)}</span>` : ''}
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
    $('dice-custom-value').addEventListener('change', (e) => {
      customValue = e.target.value;
    });

    async function performRoll(die) {
      if (rolling) return;
      rolling = true;
      error = '';
      render();
      try {
        // desenha a própria rolagem na hora (o insert já devolve a linha
        // completa) em vez de esperar o Realtime voltar com outro SELECT
        // -- essa espera redundante era o que fazia rolar dado parecer
        // lento.
        const roll = await rollDice(campaignId, rollerId, rollerName, die, qty, modifier);
        rolls = [roll, ...rolls];
      } catch (err) {
        error = err.message;
      }
      rolling = false;
      render();
    }

    app.querySelectorAll('.dice-die-btn').forEach((btn) => {
      btn.addEventListener('click', () => performRoll(btn.dataset.die));
    });
    $('dice-custom-roll-btn').addEventListener('click', () => {
      const die = normalizeCustomDie($('dice-custom-value').value);
      if (!die) {
        error = 'dado customizado precisa ser um número entre 2 e 1000.';
        render();
        return;
      }
      performRoll(die);
    });
    const hiddenToggle = $('dice-hidden-toggle');
    if (hiddenToggle) hiddenToggle.addEventListener('click', () => setHiddenRollMode(!getHiddenRollMode()));
    app.querySelectorAll('[data-reveal]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await revealRoll(btn.dataset.reveal);
          const r = rolls.find((x) => x.id === btn.dataset.reveal);
          if (r) r.hidden = false;
          render();
        } catch (err) {
          error = err.message;
          render();
        }
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

  // o 🙈 pode ser ligado em outro lugar (dock do tabuleiro, bandeja do combate): repinta o botão daqui também
  if (isMaster) onHiddenRollMode(() => app.isConnected && render());

  load();
  subscribeRealtime();
}
