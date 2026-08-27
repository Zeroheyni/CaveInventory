// Fase 8 — aba de diário de sessão. Embutida dentro de character.js (aba
// "DIÁRIO"), igual dice.js/notebook.js -- toda busca de elemento fica
// restrita à própria subárvore do embed. Mestre cria/edita/apaga; jogador
// só lê.
import { supabase } from '../supabaseClient.js';
import { escapeHtml } from '../shared/gameData.js';
import { listEntries, createEntry, updateEntry, deleteEntry, subscribeJournal } from '../sessionJournal.js';

let activeChannel = null;

function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function renderSessionJournalScreen(app, { session, profile, campaign }) {
  const campaignId = campaign.id;
  const userId = session.user.id;
  const isMaster = profile.role === 'master';
  const $ = (id) => app.querySelector('#' + id);

  if (activeChannel) {
    supabase.removeChannel(activeChannel);
    activeChannel = null;
  }

  let entries = [];
  let editingId = null; // null = form fechado; 'new' = criando; id = editando essa entrada
  let error = '';

  async function load() {
    entries = await listEntries(campaignId);
    render();
  }

  function subscribeRealtime() {
    activeChannel = subscribeJournal(campaignId, async () => {
      entries = await listEntries(campaignId);
      render();
    });
  }

  function formHtml() {
    const editing = editingId !== 'new' && editingId !== null ? entries.find((e) => e.id === editingId) : null;
    return `
      <div class="journal-form-card">
        <div class="form-grid">
          <div class="field">
            <label>Título</label>
            <input type="text" id="journal-title" placeholder="ex: A emboscada na ponte" value="${editing ? escapeHtml(editing.title) : ''}">
          </div>
          <div class="field">
            <label>Data</label>
            <input type="date" id="journal-date" value="${editing ? editing.session_date : todayIso()}">
          </div>
        </div>
        <div class="field">
          <label>Resumo</label>
          <textarea id="journal-summary" rows="5" placeholder="o que aconteceu nessa sessão...">${editing ? escapeHtml(editing.summary) : ''}</textarea>
        </div>
        <div class="journal-form-actions">
          <button type="button" class="btn" id="journal-save-btn">${editing ? 'salvar alterações' : 'registrar sessão'}</button>
          <button type="button" class="btn btn-ghost" id="journal-cancel-btn">cancelar</button>
        </div>
      </div>
    `;
  }

  function entryCard(entry) {
    return `
      <div class="journal-entry-card">
        <div class="journal-entry-head">
          <span class="journal-entry-date">${formatDate(entry.session_date)}</span>
          <span class="journal-entry-title">${escapeHtml(entry.title)}</span>
          ${
            isMaster
              ? `<button type="button" class="notebook-pencil-btn" data-journal-edit="${entry.id}" title="editar">✎</button>
                 <button type="button" class="notebook-pencil-btn notebook-delete-page-btn" data-journal-delete="${entry.id}" title="apagar">✕</button>`
              : ''
          }
        </div>
        ${entry.summary ? `<p class="journal-entry-summary">${escapeHtml(entry.summary)}</p>` : ''}
      </div>
    `;
  }

  function render() {
    app.innerHTML = `
      <div class="journal-wrap">
        <div class="journal-toolbar">
          <span class="dice-title">📔 DIÁRIO DE SESSÃO</span>
          ${isMaster && editingId === null ? `<button type="button" class="btn" id="journal-new-btn">+ nova sessão</button>` : ''}
        </div>
        ${error ? `<p class="admin-error" style="display:block;">${escapeHtml(error)}</p>` : ''}
        ${editingId !== null ? formHtml() : ''}
        <div class="journal-list">
          ${
            entries.length === 0
              ? `<p class="admin-empty">${isMaster ? 'nenhuma sessão registrada ainda.' : 'o mestre ainda não registrou nenhuma sessão.'}</p>`
              : entries.map(entryCard).join('')
          }
        </div>
      </div>
    `;

    const newBtn = $('journal-new-btn');
    if (newBtn) newBtn.addEventListener('click', () => { editingId = 'new'; render(); });

    const cancelBtn = $('journal-cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => { editingId = null; error = ''; render(); });

    const saveBtn = $('journal-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', async () => {
      const title = $('journal-title').value.trim();
      const sessionDate = $('journal-date').value;
      const summary = $('journal-summary').value.trim();
      if (!title || !sessionDate) { error = 'preencha título e data.'; render(); return; }
      try {
        if (editingId === 'new') await createEntry(campaignId, userId, { sessionDate, title, summary });
        else await updateEntry(editingId, { sessionDate, title, summary });
        editingId = null;
        error = '';
        await load();
      } catch (err) {
        error = err.message;
        render();
      }
    });

    app.querySelectorAll('[data-journal-edit]').forEach((btn) => {
      btn.addEventListener('click', () => { editingId = btn.dataset.journalEdit; render(); });
    });
    app.querySelectorAll('[data-journal-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!window.confirm('Apagar esta entrada do diário?')) return;
        try {
          await deleteEntry(btn.dataset.journalDelete);
          await load();
        } catch (err) {
          error = err.message;
          render();
        }
      });
    });
  }

  load();
  subscribeRealtime();
}
