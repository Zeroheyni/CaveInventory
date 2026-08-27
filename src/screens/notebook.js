// Fase 7 — caderno de anotações. Dono lê/escreve o próprio (RLS direta
// em characters.notebook_data); quem está em isAdminView (mestre de
// campanha ou mestre global olhando o personagem de outra pessoa) só
// enxerga, em modo leitura, as páginas que o dono marcou como
// compartilhadas -- ver get_notebook_shared_pages em db/026.
import { escapeHtml } from '../shared/gameData.js';
import {
  NOTEBOOK_THEMES,
  loadOwnNotebook,
  saveOwnNotebook,
  loadSharedNotebookPages,
  uploadNotebookImage,
  sanitizeNotebookHtml,
  newPage,
} from '../notebook.js';

export function renderNotebookScreen(app, { session, profile, campaign, characterId, isAdminView }) {
  const isOwner = !isAdminView;
  const $ = (id) => app.querySelector('#' + id);

  let notebook = null; // { theme, activePageId, pages }
  let loaded = false;
  let loadError = '';
  let saveTimer = null;
  let savedRange = null;
  let imgUploadError = '';

  async function load() {
    try {
      if (isOwner) {
        notebook = await loadOwnNotebook(characterId);
      } else {
        const shared = await loadSharedNotebookPages(characterId);
        notebook = { theme: shared.theme, activePageId: shared.pages[0] ? shared.pages[0].id : null, pages: shared.pages };
      }
    } catch (err) {
      loadError = err.message;
    }
    loaded = true;
    render();
  }

  function activePage() {
    if (!notebook) return null;
    return notebook.pages.find((p) => p.id === notebook.activePageId) || notebook.pages[0] || null;
  }

  function themeInfo() {
    return NOTEBOOK_THEMES.find((t) => t.id === (notebook && notebook.theme)) || NOTEBOOK_THEMES[0];
  }

  function render() {
    if (!loaded) {
      app.innerHTML = '<p class="admin-empty">carregando...</p>';
      return;
    }
    if (loadError) {
      app.innerHTML = `<p class="admin-error" style="display:block;">erro: ${escapeHtml(loadError)}</p>`;
      return;
    }
    const theme = themeInfo();
    const page = activePage();
    const isDigital = theme.family === 'digital';

    app.innerHTML = `
      <div class="notebook-wrap notebook-theme-${theme.id}">
        <div class="notebook-toolbar">
          ${
            isOwner
              ? `
            <select class="notebook-theme-select" id="notebook-theme-select">
              ${NOTEBOOK_THEMES.map((t) => `<option value="${t.id}" ${t.id === theme.id ? 'selected' : ''}>${escapeHtml(t.label)}</option>`).join('')}
            </select>
            <span class="notebook-toolbar-sep"></span>
            <button type="button" class="notebook-fmt-btn" data-fmt="bold" title="negrito"><b>B</b></button>
            <button type="button" class="notebook-fmt-btn" data-fmt="italic" title="itálico"><i>I</i></button>
            <button type="button" class="notebook-fmt-btn" data-fmt="underline" title="sublinhado"><u>U</u></button>
            <button type="button" class="notebook-fmt-btn" data-fmt="insertUnorderedList" title="lista">☰</button>
            <button type="button" class="notebook-fmt-btn" data-fmt="insertOrderedList" title="lista numerada">①</button>
            <button type="button" class="notebook-fmt-btn" id="notebook-img-btn" title="inserir imagem">🖼</button>
            <input type="file" id="notebook-img-input" accept="image/*" style="display:none;">
            <span class="notebook-toolbar-sep"></span>
            ${page ? `<label class="notebook-share-toggle" title="o mestre consegue ver essa página"><input type="checkbox" id="notebook-share-check" ${page.visibleToMaster ? 'checked' : ''}> visível ao mestre</label>` : ''}
            <span class="notebook-save-status" id="notebook-save-status"></span>
          `
              : `<span class="notebook-readonly-badge">📖 modo leitura — só páginas compartilhadas</span>`
          }
        </div>
        ${imgUploadError ? `<p class="admin-error" style="display:block;">${escapeHtml(imgUploadError)}</p>` : ''}

        ${
          notebook.pages.length === 0
            ? isOwner
              ? `<p class="admin-empty">nenhuma página ainda.</p><button type="button" class="btn" id="notebook-add-page">+ nova página</button>`
              : `<p class="admin-empty">esse personagem não compartilhou nenhuma página com você.</p>`
            : `
          ${isDigital ? digitalNav() : physicalNav()}
          <div class="notebook-stage">
            <div class="notebook-page" id="notebook-page-surface" ${isOwner ? 'contenteditable="true"' : ''}>${page ? sanitizeNotebookHtml(page.html) : ''}</div>
          </div>
        `
        }
      </div>
    `;
    wireEvents();
  }

  function digitalNav() {
    return `
      <div class="notebook-tabs">
        ${notebook.pages.map((p) => `<button type="button" class="notebook-tab-btn ${p.id === notebook.activePageId ? 'active' : ''}" data-page-id="${p.id}">${escapeHtml(p.title)}</button>`).join('')}
        ${isOwner ? `<button type="button" class="notebook-tab-add" id="notebook-add-page" title="nova página">+</button>` : ''}
      </div>
      ${isOwner ? pageActionsRow() : ''}
    `;
  }

  function physicalNav() {
    const idx = notebook.pages.findIndex((p) => p.id === notebook.activePageId);
    const page = activePage();
    return `
      <div class="notebook-physical-nav">
        <button type="button" class="notebook-page-arrow" id="notebook-prev-page" ${idx <= 0 ? 'disabled' : ''}>‹</button>
        <span class="notebook-page-count">${escapeHtml(page ? page.title : '')} — ${idx + 1} / ${notebook.pages.length}</span>
        <button type="button" class="notebook-page-arrow" id="notebook-next-page" ${idx >= notebook.pages.length - 1 ? 'disabled' : ''}>›</button>
        ${isOwner ? `<button type="button" class="notebook-tab-add" id="notebook-add-page" title="nova página">+</button>` : ''}
      </div>
      ${isOwner ? pageActionsRow() : ''}
    `;
  }

  function pageActionsRow() {
    return `
      <div class="notebook-page-actions">
        <button type="button" class="btn btn-ghost" id="notebook-rename-page">renomear página</button>
        <button type="button" class="combat-row-remove" id="notebook-delete-page" title="apagar página">✕</button>
      </div>
    `;
  }

  function capture() {
    const el = $('notebook-page-surface');
    const page = activePage();
    if (!el || !page) return;
    page.html = sanitizeNotebookHtml(el.innerHTML);
  }

  function scheduleSave() {
    const statusEl = $('notebook-save-status');
    if (statusEl) statusEl.textContent = 'salvando...';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await saveOwnNotebook(characterId, notebook);
        const el = $('notebook-save-status');
        if (el) el.textContent = 'salvo ✓';
      } catch (err) {
        const el = $('notebook-save-status');
        if (el) el.textContent = 'erro ao salvar: ' + err.message;
      }
    }, 1200);
  }

  function navigateTo(newId, direction) {
    capture();
    const family = themeInfo().family;
    const stage = app.querySelector('.notebook-stage');
    if (family === 'physical' && stage && direction) {
      stage.classList.add(direction === 'next' ? 'notebook-flip-out-next' : 'notebook-flip-out-prev');
      setTimeout(() => {
        notebook.activePageId = newId;
        render();
        const freshStage = app.querySelector('.notebook-stage');
        if (freshStage) {
          const inClass = direction === 'next' ? 'notebook-flip-in-next' : 'notebook-flip-in-prev';
          freshStage.classList.add(inClass);
          setTimeout(() => freshStage.classList.remove(inClass), 260);
        }
      }, 180);
    } else {
      notebook.activePageId = newId;
      render();
    }
    scheduleSave();
  }

  function saveSelection() {
    const sel = window.getSelection();
    const editor = $('notebook-page-surface');
    if (sel.rangeCount > 0 && editor && editor.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  }

  function restoreSelectionAndFocus() {
    const editor = $('notebook-page-surface');
    if (!editor) return;
    editor.focus();
    if (savedRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
  }

  function startImageResize(img, e) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = img.getBoundingClientRect().width;
    function onMove(ev) {
      const next = Math.max(40, Math.round(startWidth + (ev.clientX - startX)));
      img.style.width = next + 'px';
      img.style.height = 'auto';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      capture();
      scheduleSave();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function wireEvents() {
    // cada render() troca o innerHTML inteiro (páginas/tema mudam com
    // pouca frequência) -- religar aqui é seguro, o DOM antigo (com
    // seus listeners) já foi descartado junto.
    const themeSelect = $('notebook-theme-select');
    if (themeSelect) {
      themeSelect.addEventListener('change', () => {
        notebook.theme = themeSelect.value;
        render();
        scheduleSave();
      });
    }

    app.querySelectorAll('button[data-fmt]').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => e.preventDefault()); // não perde a seleção do texto
      btn.addEventListener('click', () => {
        document.execCommand(btn.dataset.fmt, false, null);
        capture();
        scheduleSave();
      });
    });

    const imgBtn = $('notebook-img-btn');
    const imgInput = $('notebook-img-input');
    if (imgBtn && imgInput) {
      imgBtn.addEventListener('mousedown', (e) => e.preventDefault());
      imgBtn.addEventListener('click', () => {
        saveSelection();
        imgInput.click();
      });
      imgInput.addEventListener('change', async () => {
        const file = imgInput.files && imgInput.files[0];
        imgInput.value = '';
        if (!file) return;
        imgUploadError = '';
        try {
          const url = await uploadNotebookImage(characterId, file);
          restoreSelectionAndFocus();
          document.execCommand('insertHTML', false, `<img class="notebook-img" src="${url}" style="width:220px">`);
          capture();
          scheduleSave();
        } catch (err) {
          imgUploadError = 'erro ao enviar imagem: ' + err.message;
          render();
        }
      });
    }

    const shareCheck = $('notebook-share-check');
    if (shareCheck) {
      shareCheck.addEventListener('change', () => {
        const page = activePage();
        if (!page) return;
        page.visibleToMaster = shareCheck.checked;
        scheduleSave();
      });
    }

    const editor = $('notebook-page-surface');
    if (editor) {
      editor.addEventListener('input', () => {
        capture();
        scheduleSave();
      });
      editor.addEventListener('mousedown', (e) => {
        if (e.target.tagName !== 'IMG') return;
        const rect = e.target.getBoundingClientRect();
        const nearCorner = e.clientX > rect.right - 16 && e.clientY > rect.bottom - 16;
        if (nearCorner) startImageResize(e.target, e);
      });
    }

    app.querySelectorAll('button[data-page-id]').forEach((btn) => {
      btn.addEventListener('click', () => navigateTo(btn.dataset.pageId, null));
    });

    const prevBtn = $('notebook-prev-page');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        const idx = notebook.pages.findIndex((p) => p.id === notebook.activePageId);
        if (idx > 0) navigateTo(notebook.pages[idx - 1].id, 'prev');
      });
    }
    const nextBtn = $('notebook-next-page');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        const idx = notebook.pages.findIndex((p) => p.id === notebook.activePageId);
        if (idx < notebook.pages.length - 1) navigateTo(notebook.pages[idx + 1].id, 'next');
      });
    }

    const addBtn = $('notebook-add-page');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        capture();
        const p = newPage(`Página ${notebook.pages.length + 1}`);
        notebook.pages.push(p);
        notebook.activePageId = p.id;
        render();
        scheduleSave();
      });
    }

    const renameBtn = $('notebook-rename-page');
    if (renameBtn) {
      renameBtn.addEventListener('click', () => {
        const page = activePage();
        if (!page) return;
        const next = window.prompt('Nome da página', page.title);
        if (next && next.trim()) {
          page.title = next.trim();
          render();
          scheduleSave();
        }
      });
    }

    const deleteBtn = $('notebook-delete-page');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        if (notebook.pages.length <= 1) {
          window.alert('não dá pra apagar a única página do caderno.');
          return;
        }
        if (!window.confirm('apagar essa página? não dá pra desfazer.')) return;
        const idx = notebook.pages.findIndex((p) => p.id === notebook.activePageId);
        notebook.pages.splice(idx, 1);
        notebook.activePageId = notebook.pages[Math.max(0, idx - 1)].id;
        render();
        scheduleSave();
      });
    }
  }

  load();
}
