// Fase 6 — pra mestre, a aba "Inventário" do menu lateral vira um
// seletor: cards de cada player (e de todo NPC de ficha completa,
// que tem inventário igual um player) pra escolher de quem gerenciar
// os itens. Abre a tela cheia de character.js (própria janela, com
// seu próprio cabeçalho) porque essa tela não é feita pra ficar
// embutida dentro de si mesma.
import { escapeHtml } from '../shared/gameData.js';
import { supabase } from '../supabaseClient.js';
import { renderCharacterScreen } from './character.js';
import {
  listBackups, restoreBackup, createBackup, BACKUP_REASON_LABELS,
  buildInventoryExport, downloadJson, markExported, daysSinceExport, parseInventoryExport, importInventory,
} from '../inventoryBackups.js';

function formatBackupDate(iso) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function renderMasterInventoryChooser(app, { session, profile, campaign, topApp, escapeBack }) {
  const campaignId = campaign.id;

  let list = [];
  let loaded = false;
  let activeTab = 'jogadores'; // 'jogadores' | 'npcs' -- mesma ideia de abas do painel de combate, pra não misturar player com NPC no mesmo grid

  // painel de backups (db/047) -- o banco grava as fotos sozinho, aqui o
  // mestre escolhe um personagem, vê o histórico e restaura uma versão.
  let backupCharId = '';
  let backups = [];
  let backupsLoading = false;
  let backupMsg = '';
  // cópia em arquivo (fora do Supabase): mensagem e entradas lidas do arquivo escolhido
  let fileMsg = '';
  let fileEntries = null;

  async function loadBackups() {
    if (!backupCharId) {
      backups = [];
      render();
      return;
    }
    backupsLoading = true;
    render();
    try {
      backups = await listBackups(backupCharId);
    } catch (err) {
      backups = [];
      backupMsg = 'erro ao carregar backups: ' + err.message;
    }
    backupsLoading = false;
    render();
  }

  async function load() {
    const { data, error } = await supabase
      .from('characters')
      .select('id, name, avatar_url, is_npc, npc_sheet_type, max_carga, owner_id')
      .eq('campaign_id', campaignId)
      .order('is_npc')
      .order('name');
    if (error) throw error;
    // player de verdade, ou NPC de ficha completa (só esses têm inventário) --
    // NPC simples não entra aqui (não tem itens), e o próprio personagem
    // do mestre também não (auto-criado só pelo mecanismo genérico de
    // loadState(), nunca usado de verdade).
    list = (data || []).filter((c) => (!c.is_npc || c.npc_sheet_type === 'completa') && c.owner_id !== session.user.id);
    loaded = true;
    render();
  }

  function render() {
    const players = list.filter((c) => !c.is_npc);
    const npcs = list.filter((c) => c.is_npc);
    const groups = { jogadores: players, npcs };
    const shown = groups[activeTab] || [];

    app.innerHTML = `
      <div class="ficha-section-title" style="margin-bottom:10px;">ESCOLHA UM INVENTÁRIO</div>
      ${
        !loaded
          ? '<p class="admin-empty">carregando...</p>'
          : `
        <div class="combat-master-tabs">
          <button type="button" class="combat-master-tab-btn ${activeTab === 'jogadores' ? 'active' : ''}" data-inv-tab="jogadores">Jogadores <span class="combat-master-tab-count">${players.length}</span></button>
          <button type="button" class="combat-master-tab-btn ${activeTab === 'npcs' ? 'active' : ''}" data-inv-tab="npcs">NPCs <span class="combat-master-tab-count">${npcs.length}</span></button>
        </div>
        ${
          shown.length === 0
            ? `<p class="admin-empty">${activeTab === 'jogadores' ? 'nenhum jogador nessa campanha ainda.' : 'nenhum NPC completo criado ainda.'}</p>`
            : `<div class="ficha-dash-grid">${shown.map(chooserCard).join('')}</div>`
        }
        ${backupPanel()}
      `
      }
    `;
    wireEvents();
  }

  function backupPanel() {
    return `
      <div class="inv-backup-panel">
        <div class="ficha-xp-panel-head">🛟 BACKUPS DOS INVENTÁRIOS</div>
        <p class="section-hint">O sistema guarda uma cópia sozinho antes de qualquer gravação que zere ou corte pela metade um inventário, e uma a cada 15 min durante o uso. Restaurar nunca perde nada: o estado de agora também vira um backup.</p>
        ${fileBackupHtml()}
        <div class="inv-backup-controls">
          <select id="inv-backup-char" class="slot-select">
            <option value="">escolha um personagem…</option>
            ${list.map((c) => `<option value="${c.id}" ${backupCharId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}${c.is_npc ? ' (NPC)' : ''}</option>`).join('')}
          </select>
          <button type="button" class="btn btn-ghost" id="inv-backup-now" ${backupCharId ? '' : 'disabled'}>salvar backup agora</button>
        </div>
        ${backupMsg ? `<p class="${backupMsg.endsWith('✓') ? 'section-hint' : 'admin-error'}" style="display:block;">${escapeHtml(backupMsg)}</p>` : ''}
        ${
          !backupCharId
            ? ''
            : backupsLoading
              ? '<p class="admin-empty">carregando...</p>'
              : backups.length === 0
                ? '<p class="admin-empty">nenhum backup desse personagem ainda (só é criado quando ele tem algo no inventário).</p>'
                : `<div class="inv-backup-list">${backups
                    .map(
                      (b) => `
            <div class="inv-backup-row">
              <span class="inv-backup-date">${formatBackupDate(b.created_at)}</span>
              <span class="inv-backup-info">${b.items_count} ${b.items_count === 1 ? 'item' : 'itens'} · ${b.containers_count} ${b.containers_count === 1 ? 'recipiente' : 'recipientes'}${typeof b.new_items_count === 'number' ? ' · virou ' + b.new_items_count : ''}</span>
              <span class="inv-backup-reason inv-backup-reason-${b.reason}">${BACKUP_REASON_LABELS[b.reason] || b.reason}</span>
              <button type="button" class="btn btn-ghost" data-restore-backup="${b.id}" data-restore-label="${escapeHtml(formatBackupDate(b.created_at) + ' (' + b.items_count + ' itens)')}">restaurar</button>
            </div>`
                    )
                    .join('')}</div>`
        }
      </div>`;
  }

  // exportar/importar arquivo: os backups do banco moram no MESMO projeto do
  // Supabase -- só um arquivo baixado protege se o projeto inteiro se perder.
  function fileBackupHtml() {
    const days = daysSinceExport();
    const reminder =
      days === null
        ? 'Você ainda não baixou uma cópia dos inventários em arquivo neste navegador.'
        : days >= 7
          ? `Faz ${days} dias que você baixou a última cópia em arquivo.`
          : '';
    const entryRows = fileEntries
      ? fileEntries.characters
          .map((fc, i) => {
            const target = list.find((x) => x.id === fc.id);
            return `
        <div class="inv-backup-row">
          <span class="inv-backup-date">${escapeHtml(fc.name || '?')}</span>
          <span class="inv-backup-info">${fc.data.items.length} itens · ${fc.data.containers.length} recipientes</span>
          ${target ? `<button type="button" class="btn btn-ghost" data-import-idx="${i}">importar</button>` : '<span class="inv-backup-reason">personagem não existe mais aqui</span>'}
        </div>`;
          })
          .join('')
      : '';
    return `
      <div class="inv-backup-file">
        <div class="inv-backup-file-title">💾 CÓPIA EM ARQUIVO</div>
        ${reminder ? `<p class="admin-error" style="display:block;">${reminder} Baixe uma agora e guarde num lugar seguro (drive, nuvem).</p>` : ''}
        <div class="inv-backup-controls">
          <button type="button" class="btn btn-ghost" id="inv-export-all">⬇ baixar todos os inventários</button>
          <label class="btn btn-ghost inv-import-label">⬆ importar de arquivo<input type="file" id="inv-import-file" accept=".json,application/json" hidden></label>
        </div>
        ${fileMsg ? `<p class="${fileMsg.endsWith('✓') ? 'section-hint' : 'admin-error'}" style="display:block;">${escapeHtml(fileMsg)}</p>` : ''}
        ${entryRows ? `<div class="inv-backup-list">${entryRows}</div>` : ''}
      </div>`;
  }

  function chooserCard(c) {
    return `
      <button type="button" class="ficha-dash-card npc-chooser-card" data-open-inv="${c.id}">
        ${c.avatar_url ? `<img class="ficha-dash-avatar" src="${escapeHtml(c.avatar_url)}" alt="">` : `<div class="ficha-dash-avatar"></div>`}
        <div class="ficha-dash-info">
          <div class="ficha-dash-name">${escapeHtml(c.name)}</div>
          ${c.is_npc ? '<span class="npc-type-badge completa">NPC</span>' : ''}
        </div>
      </button>`;
  }

  let wired = false;
  function wireEvents() {
    if (wired) return;
    wired = true;
    app.addEventListener('change', async (e) => {
      const fileInput = e.target.closest('#inv-import-file');
      if (fileInput) {
        const f = fileInput.files && fileInput.files[0];
        if (!f) return;
        try {
          fileEntries = parseInventoryExport(await f.text());
          fileMsg = `arquivo lido (${fileEntries.exportedAt ? formatBackupDate(fileEntries.exportedAt) : 'sem data'}). Escolha qual inventário importar.`;
        } catch (err) {
          fileEntries = null;
          fileMsg = 'erro: ' + err.message;
        }
        render();
        return;
      }
      const sel = e.target.closest('#inv-backup-char');
      if (!sel) return;
      backupCharId = sel.value;
      backupMsg = '';
      loadBackups();
    });

    app.addEventListener('click', async (e) => {
      const tabBtn = e.target.closest('button[data-inv-tab]');
      if (tabBtn) {
        activeTab = tabBtn.dataset.invTab;
        render();
        return;
      }

      const exportBtn = e.target.closest('#inv-export-all');
      if (exportBtn) {
        try {
          const dump = await buildInventoryExport(campaign);
          const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
          downloadJson(dump, `inventarios-${String(campaign.name || 'campanha').replace(/[^\w-]+/g, '_')}-${stamp}.json`);
          markExported();
          fileMsg = `${dump.characters.length} inventários baixados ✓`;
        } catch (err) {
          fileMsg = 'erro ao exportar: ' + err.message;
        }
        render();
        return;
      }

      const importBtn = e.target.closest('button[data-import-idx]');
      if (importBtn) {
        const fc = fileEntries && fileEntries.characters[Number(importBtn.dataset.importIdx)];
        if (!fc) return;
        const ok = window.confirm(
          `Sobrescrever o inventário ATUAL de ${fc.name} pelo do arquivo (${fc.data.items.length} itens)?\n\nO inventário de agora também é guardado como backup ("antes de restaurar").`
        );
        if (!ok) return;
        try {
          await importInventory(fc.id, fc.data, fc.currency);
          fileMsg = `inventário de ${fc.name} importado ✓`;
        } catch (err) {
          fileMsg = 'erro ao importar: ' + err.message;
        }
        render();
        return;
      }

      const nowBtn = e.target.closest('#inv-backup-now');
      if (nowBtn) {
        if (!backupCharId) return;
        try {
          await createBackup(backupCharId);
          backupMsg = '';
        } catch (err) {
          backupMsg = 'erro ao criar backup: ' + err.message;
        }
        await loadBackups();
        return;
      }

      const restoreBtn = e.target.closest('button[data-restore-backup]');
      if (restoreBtn) {
        const c = list.find((x) => x.id === backupCharId);
        const ok = window.confirm(
          `Restaurar o inventário de ${c ? c.name : 'esse personagem'} para a versão de ${restoreBtn.dataset.restoreLabel}?\n\nO inventário de AGORA também é guardado como backup ("antes de restaurar"), então dá pra desfazer.`
        );
        if (!ok) return;
        try {
          await restoreBackup(restoreBtn.dataset.restoreBackup);
          backupMsg = 'inventário restaurado ✓';
        } catch (err) {
          backupMsg = 'erro ao restaurar: ' + err.message;
        }
        await loadBackups();
        return;
      }
      const btn = e.target.closest('button[data-open-inv]');
      if (!btn) return;
      const id = btn.dataset.openInv;
      const c = list.find((x) => x.id === id);
      renderCharacterScreen(topApp, {
        session,
        profile,
        campaign,
        characterId: id,
        ownerName: c ? c.name : 'Personagem',
        onBack: escapeBack || (() => renderCharacterScreen(topApp, { session, profile, campaign })),
      });
    });
  }

  load();
}
