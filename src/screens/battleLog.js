// Fase 8 — sub-aba "LOG" dentro do combate (character.js monta isso dentro
// de #combat-page-log, sub-árvore do painel de combate). Só leitura --
// quem grava é combat.js (dano/cura/entrada/saída) e as RPCs de condição
// (db/031_patch_combat_conditions.sql).
import { supabase } from '../supabaseClient.js';
import { escapeHtml } from '../shared/gameData.js';
import { listRecentEvents, subscribeBattleLog, clearBattleLog } from '../battleLog.js';

const TYPE_META = {
  dano: { icon: '⚔', label: 'dano', cls: 'battlelog-dano' },
  cura: { icon: '✚', label: 'cura', cls: 'battlelog-cura' },
  entrada: { icon: '→', label: 'entrou no combate', cls: 'battlelog-entrada' },
  saida: { icon: '←', label: 'saiu do combate', cls: 'battlelog-saida' },
  condicao_aplicada: { icon: '☠', label: 'recebeu condição', cls: 'battlelog-condicao' },
  condicao_removida: { icon: '✓', label: 'perdeu condição', cls: 'battlelog-condicao' },
  rolagem: { icon: '🎲', label: 'rolagem', cls: 'battlelog-rolagem' },
};

let activeChannel = null;

function formatTime(iso) {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function eventText(ev) {
  const meta = TYPE_META[ev.type] || { icon: '•', label: ev.type, cls: '' };
  if (ev.type === 'dano' || ev.type === 'cura') {
    return `${meta.label === 'dano' ? '−' : '+'}${ev.amount} ${ev.detail || 'hp'}`;
  }
  if (ev.type === 'condicao_aplicada' || ev.type === 'condicao_removida') {
    return `${meta.label}${ev.detail ? ': ' + ev.detail : ''}`;
  }
  if (ev.type === 'rolagem') return ev.detail || meta.label;
  return meta.label;
}

export function renderBattleLogScreen(app, { session, profile, campaign }) {
  const campaignId = campaign.id;
  const isMaster = profile.role === 'master';
  const $ = (id) => app.querySelector('#' + id);

  if (activeChannel) {
    supabase.removeChannel(activeChannel);
    activeChannel = null;
  }

  let events = [];

  async function load() {
    events = await listRecentEvents(campaignId);
    render();
  }

  function subscribeRealtime() {
    activeChannel = subscribeBattleLog(campaignId, async () => {
      events = await listRecentEvents(campaignId);
      render();
    });
  }

  function render() {
    app.innerHTML = `
      <div class="battlelog-wrap">
        <div class="battlelog-toolbar">
          <span class="log-panel-head">EVENTOS DA LUTA ATUAL</span>
          ${isMaster && events.length > 0 ? `<button type="button" class="btn btn-ghost" id="battlelog-clear-btn">limpar log</button>` : ''}
        </div>
        ${
          events.length === 0
            ? `<p class="admin-empty">nenhum evento registrado ainda nesta luta.</p>`
            : events
                .map((ev) => {
                  const meta = TYPE_META[ev.type] || { icon: '•', cls: '' };
                  return `
              <div class="battlelog-entry ${meta.cls}">
                <span class="log-time">${formatTime(ev.created_at)}</span>
                <span class="battlelog-icon">${meta.icon}</span>
                <span class="battlelog-who">${escapeHtml(ev.participant_name)}</span>
                <span class="battlelog-text">${escapeHtml(eventText(ev))}</span>
              </div>`;
                })
                .join('')
        }
      </div>
    `;

    const clearBtn = $('battlelog-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (!window.confirm('Limpar o log de eventos desta luta?')) return;
        await clearBattleLog(campaignId);
      });
    }
  }

  load();
  subscribeRealtime();
}
