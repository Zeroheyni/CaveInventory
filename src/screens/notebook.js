// Fase 7 — caderno de anotações. Dono tem uma LISTA de cadernos (cada
// um com tema/material/fonte próprios) e escolhe qual abrir; quem
// está em isAdminView (mestre de campanha ou mestre global olhando o
// personagem de outra pessoa) só enxerga, em modo leitura, os
// cadernos/páginas que o dono marcou como compartilhados -- ver
// get_notebook_shared_pages em db/027.
import { escapeHtml } from '../shared/gameData.js';
import {
  NOTEBOOK_THEMES,
  TEXT_COLORS,
  loadOwnNotebookData,
  saveOwnNotebookData,
  loadSharedNotebooks,
  uploadNotebookImage,
  sanitizeNotebookHtml,
  newPage,
  newNotebook,
  getFontFamily,
  ensureCustomFontLoaded,
} from '../notebook.js';

export function renderNotebookScreen(app, { session, profile, campaign, characterId, isAdminView }) {
  const isOwner = !isAdminView;
  const $ = (id) => app.querySelector('#' + id);

  let loaded = false;
  let loadError = '';
  let notebookData = null; // dono: { activeNotebookId, notebooks: [...] }
  let sharedNotebooks = null; // visitante: [{ notebookId, notebookName, pages }]
  let sharedActiveId = null;
  let view = 'list'; // 'list' | 'notebook'
  let saveTimer = null;
  let savedRange = null;
  let imgUploadError = '';
  let settingsOpen = false;
  let colorPopoverOpen = false;
  let creatingNotebook = false;
  let lastFocusedSide = 'left'; // qual metade da folha dupla recebeu foco por último
  let docClickWired = false;

  async function load() {
    try {
      if (isOwner) {
        notebookData = await loadOwnNotebookData(characterId);
      } else {
        sharedNotebooks = await loadSharedNotebooks(characterId);
        sharedActiveId = sharedNotebooks[0] ? sharedNotebooks[0].notebookId : null;
        if (sharedNotebooks.length === 1) view = 'notebook';
      }
    } catch (err) {
      loadError = err.message;
    }
    loaded = true;
    render();
  }

  function themeDef(themeId) {
    return NOTEBOOK_THEMES.find((t) => t.id === themeId) || NOTEBOOK_THEMES[0];
  }

  function currentNotebook() {
    if (isOwner) return notebookData.notebooks.find((n) => n.id === notebookData.activeNotebookId) || null;
    return sharedNotebooks.find((n) => n.notebookId === sharedActiveId) || null;
  }

  function scheduleSave() {
    if (!isOwner) return;
    const statusEl = $('notebook-save-status');
    if (statusEl) statusEl.textContent = 'salvando...';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await saveOwnNotebookData(characterId, notebookData);
        const el = $('notebook-save-status');
        if (el) el.textContent = 'salvo ✓';
      } catch (err) {
        const el = $('notebook-save-status');
        if (el) el.textContent = 'erro ao salvar: ' + err.message;
      }
    }, 1200);
  }

  function capture() {
    if (!isOwner) return;
    const nb = currentNotebook();
    if (!nb) return;
    app.querySelectorAll('.notebook-page[contenteditable][data-page-id]').forEach((el) => {
      const page = nb.pages.find((p) => p.id === el.dataset.pageId);
      if (page) page.html = sanitizeNotebookHtml(el.innerHTML);
    });
  }

  // ================= RENDER =================

  function render() {
    if (!loaded) {
      app.innerHTML = '<p class="admin-empty">carregando...</p>';
      return;
    }
    if (loadError) {
      app.innerHTML = `<p class="admin-error" style="display:block;">erro: ${escapeHtml(loadError)}</p>`;
      return;
    }
    app.innerHTML = view === 'list' ? renderListView() : renderNotebookView();
    wireEvents();
  }

  // ---- lista de cadernos ----

  function renderListView() {
    if (!isOwner) {
      const list = sharedNotebooks || [];
      if (list.length === 0) return '<p class="admin-empty">esse personagem não compartilhou nenhum caderno com você.</p>';
      return `
        <div class="notebook-list-head">
          <div class="ficha-section-title">CADERNOS COMPARTILHADOS</div>
        </div>
        <div class="notebook-list-grid">${list.map((nb) => notebookCard(nb.notebookId, nb.notebookName, nb.themeId)).join('')}</div>
      `;
    }
    const list = notebookData.notebooks;
    return `
      <div class="notebook-list-head">
        <div class="ficha-section-title">MEUS CADERNOS</div>
        ${!creatingNotebook ? `<button type="button" class="btn" id="notebook-new-btn">+ novo caderno</button>` : ''}
      </div>
      ${creatingNotebook ? newNotebookPanel() : ''}
      <div class="notebook-list-grid">
        ${list.map((nb) => notebookCard(nb.id, nb.name, nb.themeId, true)).join('')}
      </div>
    `;
  }

  function newNotebookPanel() {
    return `
      <div class="npc-bank-create-card notebook-create-card">
        <div class="npc-bank-create-head">
          <h3>// NOVO CADERNO</h3>
          <button class="icon-btn" id="notebook-create-close" title="fechar">✕</button>
        </div>
        <div class="field" style="margin-bottom:12px;"><label for="notebook-create-name">Nome</label><input type="text" id="notebook-create-name" placeholder="ex: Diário de bordo" value="Caderno ${notebookData.notebooks.length + 1}"></div>
        <label class="ficha-section-title" style="display:block; margin-bottom:8px;">ESCOLHA O TEMA</label>
        <div class="notebook-theme-choice">
          ${NOTEBOOK_THEMES.map(
            (t) => `
            <button type="button" class="notebook-theme-choice-btn" data-create-theme="${t.id}">
              <span class="notebook-theme-choice-icon">${t.family === 'digital' ? '💻' : '📖'}</span>
              <span>${escapeHtml(t.label)}</span>
            </button>`
          ).join('')}
        </div>
      </div>
    `;
  }

  function notebookCard(id, name, themeId, deletable) {
    const theme = themeDef(themeId);
    return `
      <div class="notebook-card-wrap">
        <button type="button" class="notebook-card" data-open-notebook="${id}">
          <span class="notebook-card-icon">${theme.family === 'digital' ? '💻' : '📖'}</span>
          <span class="notebook-card-name">${escapeHtml(name)}</span>
          <span class="notebook-card-theme">${escapeHtml(theme.label)}</span>
        </button>
        ${isOwner ? `<button type="button" class="notebook-pencil-btn" data-rename-notebook="${id}" title="renomear">✎</button>` : ''}
        ${deletable && isOwner && list().length > 1 ? `<button type="button" class="combat-row-remove notebook-card-delete" data-delete-notebook="${id}" title="apagar caderno">✕</button>` : ''}
      </div>
    `;
  }

  function list() {
    return notebookData ? notebookData.notebooks : [];
  }

  // ---- caderno aberto ----

  function renderNotebookView() {
    const nb = currentNotebook();
    if (!nb) {
      view = 'list';
      return renderListView();
    }
    const theme = themeDef(nb.themeId);
    const isDigital = theme.family === 'digital';
    const fontFamily = getFontFamily(nb);
    if (nb.customFont) ensureCustomFontLoaded(nb.customFont);

    const pages = nb.pages;
    const themeClasses = `notebook-family-${theme.family} notebook-theme-${theme.id} notebook-variant-${nb.variant}${isDigital && nb.expandedView ? ' notebook-expanded' : ''}`;

    return `
      <div class="notebook-wrap ${themeClasses}" style="--notebook-font:${fontFamily};">
        <div class="notebook-toolbar">
          <button type="button" class="btn btn-ghost" id="notebook-back-to-list">← cadernos</button>
          <span class="notebook-name">${escapeHtml(isOwner ? nb.name : nb.name)}</span>
          ${isOwner ? `<button type="button" class="notebook-pencil-btn" id="notebook-rename-current" title="renomear caderno">✎</button>` : ''}
          <span class="notebook-toolbar-sep"></span>
          ${
            isOwner
              ? `
            <div class="notebook-settings-wrap" id="notebook-settings-wrap">
              <button type="button" class="notebook-fmt-btn" id="notebook-settings-btn" title="personalizar caderno">⚙</button>
              ${settingsOpen ? settingsPanel(nb, theme) : ''}
            </div>
          `
              : ''
          }
          <button type="button" class="notebook-fmt-btn" id="notebook-focus-btn" title="modo foco (tela cheia)">⤢</button>
          <span class="notebook-save-status" id="notebook-save-status"></span>
          ${!isOwner ? `<span class="notebook-readonly-badge">📖 modo leitura</span>` : ''}
        </div>

        ${isOwner ? formatToolbar() : ''}
        ${imgUploadError ? `<p class="admin-error" style="display:block;">${escapeHtml(imgUploadError)}</p>` : ''}

        ${
          pages.length === 0
            ? isOwner
              ? `<p class="admin-empty">nenhuma página ainda.</p><button type="button" class="btn" id="notebook-add-page">+ nova página</button>`
              : `<p class="admin-empty">nenhuma página compartilhada.</p>`
            : theme.family === 'digital'
              ? digitalBody(nb)
              : physicalBody(nb)
        }
      </div>
    `;
  }

  function settingsPanel(nb, theme) {
    return `
      <div class="notebook-settings-panel" id="notebook-settings-panel">
        <div class="notebook-settings-row">
          <label>Material</label>
          <select id="notebook-variant-select">
            ${theme.variants.map((v) => `<option value="${v.id}" ${v.id === nb.variant ? 'selected' : ''}>${escapeHtml(v.label)}</option>`).join('')}
          </select>
        </div>
        <div class="notebook-settings-row">
          <label>Fonte</label>
          <select id="notebook-font-select">
            ${theme.fonts.map((f) => `<option value="${escapeHtml(f.family)}" ${nb.customFont === null && f.family === nb.font ? 'selected' : ''}>${escapeHtml(f.label)}</option>`).join('')}
            <option value="__custom__" ${nb.customFont !== null ? 'selected' : ''}>Outra (Google Fonts)...</option>
          </select>
        </div>
        <div class="notebook-settings-row" id="notebook-custom-font-row" style="${nb.customFont !== null ? '' : 'display:none;'}">
          <label>Nome exato</label>
          <input type="text" id="notebook-custom-font-input" placeholder="ex: Bangers" value="${nb.customFont ? escapeHtml(nb.customFont) : ''}">
        </div>
        ${
          theme.family === 'physical'
            ? `
          <div class="notebook-settings-row">
            <label>Visualização</label>
            <div class="notebook-view-toggle">
              <button type="button" class="notebook-toggle-btn ${nb.pageViewMode === 'single' ? 'active' : ''}" data-view-mode="single">1 folha</button>
              <button type="button" class="notebook-toggle-btn ${nb.pageViewMode === 'spread' ? 'active' : ''}" data-view-mode="spread">Caderno aberto</button>
            </div>
          </div>
        `
            : ''
        }
        ${
          theme.family === 'digital'
            ? `
          <label class="notebook-share-toggle">
            <input type="checkbox" id="notebook-expanded-check" ${nb.expandedView ? 'checked' : ''}> exibir tudo (sem rolagem)
          </label>
        `
            : ''
        }
      </div>
    `;
  }

  function formatToolbar() {
    return `
      <div class="notebook-toolbar">
        <button type="button" class="notebook-fmt-btn" data-fmt="bold" title="negrito"><b>B</b></button>
        <button type="button" class="notebook-fmt-btn" data-fmt="italic" title="itálico"><i>I</i></button>
        <button type="button" class="notebook-fmt-btn" data-fmt="underline" title="sublinhado"><u>U</u></button>
        <button type="button" class="notebook-fmt-btn" data-fmt="insertUnorderedList" title="lista">☰</button>
        <button type="button" class="notebook-fmt-btn" data-fmt="insertOrderedList" title="lista numerada">①</button>
        <button type="button" class="notebook-fmt-btn" id="notebook-spoiler-btn" title="marcar trecho selecionado como spoiler (tarja preta -- clique no texto pra revelar)">🙈</button>
        <button type="button" class="notebook-fmt-btn" id="notebook-img-btn" title="inserir imagem">🖼</button>
        <input type="file" id="notebook-img-input" accept="image/*" style="display:none;">
        <div class="notebook-color-wrap" id="notebook-color-wrap">
          <button type="button" class="notebook-fmt-btn" id="notebook-color-btn" title="cor do texto">🎨</button>
          ${colorPopoverOpen ? `<div class="notebook-color-popover">${TEXT_COLORS.map((c) => `<button type="button" class="notebook-color-swatch" data-color="${c}" style="background:${c};"></button>`).join('')}</div>` : ''}
        </div>
      </div>
    `;
  }

  function pageTitleWithPencil(page) {
    if (!isOwner) return escapeHtml(page.title);
    return `${escapeHtml(page.title)} <button type="button" class="notebook-pencil-btn" data-rename-page="${page.id}" title="renomear página">✎</button><button type="button" class="notebook-pencil-btn notebook-delete-page-btn" data-delete-page="${page.id}" title="apagar página">✕</button>`;
  }

  function digitalBody(nb) {
    const page = nb.pages.find((p) => p.id === nb.activePageId) || nb.pages[0];
    return `
      <div class="notebook-tabs">
        ${nb.pages
          .map(
            (p) => `
          <div class="notebook-tab-item">
            <button type="button" class="notebook-tab-btn ${p.id === nb.activePageId ? 'active' : ''}" data-page-id="${p.id}">${escapeHtml(p.title)}</button>
            ${
              isOwner
                ? `<button type="button" class="notebook-pencil-btn" data-rename-page="${p.id}" title="renomear">✎</button>
            <button type="button" class="notebook-pencil-btn notebook-delete-page-btn" data-delete-page="${p.id}" title="apagar página">✕</button>`
                : ''
            }
          </div>`
          )
          .join('')}
        ${isOwner ? `<button type="button" class="notebook-tab-add" id="notebook-add-page" title="nova página">+</button>` : ''}
      </div>
      ${isOwner && page ? sharePageToggle(page) : ''}
      <div class="notebook-stage">
        <div class="notebook-page" id="notebook-page-surface" data-page-id="${page ? page.id : ''}" ${isOwner ? 'contenteditable="true"' : ''}>${page ? sanitizeNotebookHtml(page.html) : ''}</div>
      </div>
    `;
  }

  function physicalBody(nb) {
    if (nb.pageViewMode === 'spread') return spreadBody(nb);
    const idx = nb.pages.findIndex((p) => p.id === nb.activePageId);
    const page = nb.pages[idx];
    return `
      <div class="notebook-physical-nav">
        <button type="button" class="notebook-page-arrow" id="notebook-prev-page" ${idx <= 0 ? 'disabled' : ''}>‹</button>
        <span class="notebook-page-count">${page ? pageTitleWithPencil(page, 'left') : ''} — ${idx + 1} / ${nb.pages.length}</span>
        <button type="button" class="notebook-page-arrow" id="notebook-next-page" ${idx >= nb.pages.length - 1 ? 'disabled' : ''}>›</button>
        ${isOwner ? `<button type="button" class="notebook-tab-add" id="notebook-add-page" title="nova página">+</button>` : ''}
      </div>
      ${isOwner && page ? sharePageToggle(page) : ''}
      <div class="notebook-stage">
        <div class="notebook-page" id="notebook-page-surface" data-page-id="${page ? page.id : ''}" ${isOwner ? 'contenteditable="true"' : ''}>${page ? sanitizeNotebookHtml(page.html) : ''}</div>
      </div>
    `;
  }

  function spreadBody(nb) {
    const idx = nb.pages.findIndex((p) => p.id === nb.activePageId);
    const pairStart = idx - (idx % 2);
    const left = nb.pages[pairStart];
    const right = nb.pages[pairStart + 1];
    return `
      <div class="notebook-physical-nav">
        <button type="button" class="notebook-page-arrow" id="notebook-prev-page" ${pairStart <= 0 ? 'disabled' : ''}>‹</button>
        <span class="notebook-page-count">${pairStart + 1}-${pairStart + (right ? 2 : 1)} / ${nb.pages.length}</span>
        <button type="button" class="notebook-page-arrow" id="notebook-next-page" ${pairStart + 2 >= nb.pages.length ? 'disabled' : ''}>›</button>
        ${isOwner ? `<button type="button" class="notebook-tab-add" id="notebook-add-page" title="nova página">+</button>` : ''}
      </div>
      <div class="notebook-stage notebook-stage-spread">
        <div class="notebook-page-half">
          <div class="notebook-page-half-head">${left ? pageTitleWithPencil(left, 'left') : ''}</div>
          <div class="notebook-page" id="notebook-page-surface" data-page-id="${left ? left.id : ''}" ${isOwner && left ? 'contenteditable="true"' : ''}>${left ? sanitizeNotebookHtml(left.html) : ''}</div>
        </div>
        <div class="notebook-spine"></div>
        <div class="notebook-page-half">
          <div class="notebook-page-half-head">${right ? pageTitleWithPencil(right, 'right') : ''}</div>
          <div class="notebook-page" id="notebook-page-surface-right" data-page-id="${right ? right.id : ''}" ${isOwner && right ? 'contenteditable="true"' : ''}>${right ? sanitizeNotebookHtml(right.html) : right ? '' : '<span class="notebook-blank-half">fim do caderno</span>'}</div>
        </div>
      </div>
      ${isOwner && left ? sharePageToggle(left, right) : ''}
    `;
  }

  function sharePageToggle(page, page2) {
    return `
      <div class="notebook-share-row">
        <label class="notebook-share-toggle" title="o mestre consegue ver essa página">
          <input type="checkbox" class="notebook-share-check" data-share-page="${page.id}" ${page.visibleToMaster ? 'checked' : ''}> compartilhar${page2 ? ' (esquerda)' : ''}
        </label>
        ${page2 ? `<label class="notebook-share-toggle"><input type="checkbox" class="notebook-share-check" data-share-page="${page2.id}" ${page2.visibleToMaster ? 'checked' : ''}> compartilhar (direita)</label>` : ''}
      </div>
    `;
  }

  // ================= NAVEGAÇÃO / AÇÕES =================

  function navigateTo(newId, direction) {
    capture();
    const nb = currentNotebook();
    const theme = themeDef(nb.themeId);
    const stage = app.querySelector('.notebook-stage');
    if (theme.family === 'physical' && stage && direction) {
      stage.classList.add(direction === 'next' ? 'notebook-flip-out-next' : 'notebook-flip-out-prev');
      setTimeout(() => {
        nb.activePageId = newId;
        render();
        const freshStage = app.querySelector('.notebook-stage');
        if (freshStage) {
          const inClass = direction === 'next' ? 'notebook-flip-in-next' : 'notebook-flip-in-prev';
          freshStage.classList.add(inClass);
          setTimeout(() => freshStage.classList.remove(inClass), 260);
        }
      }, 180);
    } else {
      nb.activePageId = newId;
      render();
    }
    scheduleSave();
  }

  function saveSelection(editorId) {
    const sel = window.getSelection();
    const editor = $(editorId);
    if (sel.rangeCount > 0 && editor && editor.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  }

  function restoreSelectionAndFocus(editorId) {
    const editor = $(editorId);
    if (!editor) return;
    editor.focus();
    if (savedRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
  }

  function activeEditorId() {
    return lastFocusedSide === 'right' && $('notebook-page-surface-right') ? 'notebook-page-surface-right' : 'notebook-page-surface';
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
    // --- lista ---
    app.querySelectorAll('button[data-open-notebook]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (isOwner) notebookData.activeNotebookId = btn.dataset.openNotebook;
        else sharedActiveId = btn.dataset.openNotebook;
        view = 'notebook';
        settingsOpen = false;
        render();
      });
    });
    const newNbBtn = $('notebook-new-btn');
    if (newNbBtn) {
      newNbBtn.addEventListener('click', () => {
        creatingNotebook = true;
        render();
        const input = $('notebook-create-name');
        if (input) input.select();
      });
    }
    const closeCreateBtn = $('notebook-create-close');
    if (closeCreateBtn) {
      closeCreateBtn.addEventListener('click', () => {
        creatingNotebook = false;
        render();
      });
    }
    app.querySelectorAll('button[data-create-theme]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nameInput = $('notebook-create-name');
        const name = (nameInput && nameInput.value.trim()) || `Caderno ${notebookData.notebooks.length + 1}`;
        const nb = newNotebook(name, btn.dataset.createTheme);
        notebookData.notebooks.push(nb);
        notebookData.activeNotebookId = nb.id;
        creatingNotebook = false;
        view = 'notebook';
        render();
        scheduleSave();
      });
    });
    app.querySelectorAll('button[data-rename-notebook]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const nb = notebookData.notebooks.find((n) => n.id === btn.dataset.renameNotebook);
        if (!nb) return;
        const next = window.prompt('Nome do caderno', nb.name);
        if (next && next.trim()) {
          nb.name = next.trim();
          render();
          scheduleSave();
        }
      });
    });
    app.querySelectorAll('button[data-delete-notebook]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (notebookData.notebooks.length <= 1) {
          window.alert('não dá pra apagar o único caderno.');
          return;
        }
        if (!window.confirm('apagar esse caderno inteiro? não dá pra desfazer.')) return;
        const id = btn.dataset.deleteNotebook;
        notebookData.notebooks = notebookData.notebooks.filter((n) => n.id !== id);
        if (notebookData.activeNotebookId === id) notebookData.activeNotebookId = notebookData.notebooks[0].id;
        render();
        scheduleSave();
      });
    });

    // --- topo do caderno ---
    const backBtn = $('notebook-back-to-list');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        capture();
        view = 'list';
        settingsOpen = false;
        render();
      });
    }
    const renameCurrentBtn = $('notebook-rename-current');
    if (renameCurrentBtn) {
      renameCurrentBtn.addEventListener('click', () => {
        const nb = currentNotebook();
        const next = window.prompt('Nome do caderno', nb.name);
        if (next && next.trim()) {
          nb.name = next.trim();
          render();
          scheduleSave();
        }
      });
    }
    const focusBtn = $('notebook-focus-btn');
    if (focusBtn) {
      focusBtn.addEventListener('click', () => {
        document.body.classList.toggle('notebook-focus-mode');
      });
    }

    const settingsBtn = $('notebook-settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        settingsOpen = !settingsOpen;
        render();
      });
    }
    if (!docClickWired) {
      docClickWired = true;
      document.addEventListener('click', (e) => {
        if (settingsOpen && !e.target.closest('#notebook-settings-wrap')) {
          settingsOpen = false;
          render();
        }
        if (colorPopoverOpen && !e.target.closest('#notebook-color-wrap')) {
          colorPopoverOpen = false;
          render();
        }
      });
    }

    const variantSelect = $('notebook-variant-select');
    if (variantSelect) {
      variantSelect.addEventListener('change', () => {
        currentNotebook().variant = variantSelect.value;
        render();
        scheduleSave();
      });
    }
    const fontSelect = $('notebook-font-select');
    if (fontSelect) {
      fontSelect.addEventListener('change', () => {
        const nb = currentNotebook();
        if (fontSelect.value === '__custom__') {
          nb.customFont = nb.customFont || '';
          settingsOpen = true;
          render();
          const input = $('notebook-custom-font-input');
          if (input) input.focus();
        } else {
          nb.customFont = null;
          nb.font = fontSelect.value;
          render();
          scheduleSave();
        }
      });
    }
    const customFontInput = $('notebook-custom-font-input');
    if (customFontInput) {
      customFontInput.addEventListener('change', () => {
        const nb = currentNotebook();
        nb.customFont = customFontInput.value.trim() || null;
        render();
        scheduleSave();
      });
    }
    app.querySelectorAll('button[data-view-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentNotebook().pageViewMode = btn.dataset.viewMode;
        render();
        scheduleSave();
      });
    });
    const expandedCheck = $('notebook-expanded-check');
    if (expandedCheck) {
      expandedCheck.addEventListener('change', () => {
        currentNotebook().expandedView = expandedCheck.checked;
        render();
        scheduleSave();
      });
    }

    // --- formatação ---
    app.querySelectorAll('button[data-fmt]').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        document.execCommand(btn.dataset.fmt, false, null);
        capture();
        scheduleSave();
      });
    });

    const spoilerBtn = $('notebook-spoiler-btn');
    if (spoilerBtn) {
      spoilerBtn.addEventListener('mousedown', (e) => e.preventDefault());
      spoilerBtn.addEventListener('click', () => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return; // precisa selecionar um trecho antes
        const range = sel.getRangeAt(0);
        const span = document.createElement('span');
        span.className = 'notebook-spoiler';
        span.appendChild(range.extractContents());
        range.insertNode(span);
        sel.removeAllRanges();
        capture();
        scheduleSave();
      });
    }
    // clique num spoiler revela na hora (só no DOM ao vivo -- nunca
    // salva revelado, ver sanitizeNotebookHtml) -- funciona tanto
    // editando quanto lendo um caderno compartilhado (a página não-dona
    // não é contenteditable, mas o spoiler continua clicável do mesmo
    // jeito).
    app.querySelectorAll('.notebook-spoiler').forEach((span) => {
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        span.classList.toggle('revealed');
      });
    });

    const colorBtn = $('notebook-color-btn');
    if (colorBtn) {
      colorBtn.addEventListener('mousedown', (e) => e.preventDefault());
      colorBtn.addEventListener('click', () => {
        colorPopoverOpen = !colorPopoverOpen;
        render();
      });
    }
    app.querySelectorAll('button[data-color]').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        document.execCommand('styleWithCSS', false, true);
        document.execCommand('foreColor', false, btn.dataset.color);
        colorPopoverOpen = false;
        capture();
        render();
        scheduleSave();
      });
    });

    const imgBtn = $('notebook-img-btn');
    const imgInput = $('notebook-img-input');
    if (imgBtn && imgInput) {
      imgBtn.addEventListener('mousedown', (e) => e.preventDefault());
      imgBtn.addEventListener('click', () => {
        saveSelection(activeEditorId());
        imgInput.click();
      });
      imgInput.addEventListener('change', async () => {
        const file = imgInput.files && imgInput.files[0];
        imgInput.value = '';
        if (!file) return;
        imgUploadError = '';
        try {
          const url = await uploadNotebookImage(characterId, file);
          restoreSelectionAndFocus(activeEditorId());
          document.execCommand('insertHTML', false, `<img class="notebook-img" src="${url}" style="width:220px">`);
          capture();
          scheduleSave();
        } catch (err) {
          imgUploadError = 'erro ao enviar imagem: ' + err.message;
          render();
        }
      });
    }

    app.querySelectorAll('input.notebook-share-check').forEach((el) => {
      el.addEventListener('change', () => {
        const nb = currentNotebook();
        const page = nb.pages.find((p) => p.id === el.dataset.sharePage);
        if (page) {
          page.visibleToMaster = el.checked;
          scheduleSave();
        }
      });
    });

    app.querySelectorAll('.notebook-page[contenteditable]').forEach((editor) => {
      editor.addEventListener('focus', () => {
        lastFocusedSide = editor.id === 'notebook-page-surface-right' ? 'right' : 'left';
      });
      editor.addEventListener('input', () => {
        capture();
        scheduleSave();
      });
      // Colar sem tratar deixa o navegador inserir a formatação rica do
      // que foi copiado de fora (cor de fundo, fonte, etc.) direto no
      // DOM -- sanitizeNotebookHtml só rodava ao salvar/exibir, então o
      // destaque feio (ex: texto "marcado" com fundo preto vindo de um
      // doc externo) aparecia na tela até recarregar a página. Agora
      // sanitiza JÁ na hora de colar, antes de inserir -- mesma função
      // que já limpa ao salvar, só que também na entrada.
      editor.addEventListener('paste', (e) => {
        e.preventDefault();
        const html = e.clipboardData.getData('text/html');
        const text = e.clipboardData.getData('text/plain');
        const clean = html ? sanitizeNotebookHtml(html) : escapeHtml(text).replace(/\n/g, '<br>');
        document.execCommand('insertHTML', false, clean);
      });
      editor.addEventListener('mousedown', (e) => {
        if (e.target.tagName !== 'IMG') return;
        const rect = e.target.getBoundingClientRect();
        const nearCorner = e.clientX > rect.right - 16 && e.clientY > rect.bottom - 16;
        if (nearCorner) startImageResize(e.target, e);
      });
    });

    // --- páginas ---
    app.querySelectorAll('button[data-page-id]').forEach((btn) => {
      btn.addEventListener('click', () => navigateTo(btn.dataset.pageId, null));
    });
    app.querySelectorAll('button[data-rename-page]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const nb = currentNotebook();
        const page = nb.pages.find((p) => p.id === btn.dataset.renamePage);
        if (!page) return;
        const next = window.prompt('Nome da página', page.title);
        if (next && next.trim()) {
          page.title = next.trim();
          render();
          scheduleSave();
        }
      });
    });

    const prevBtn = $('notebook-prev-page');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        const nb = currentNotebook();
        const step = nb.pageViewMode === 'spread' ? 2 : 1;
        const idx = nb.pages.findIndex((p) => p.id === nb.activePageId);
        const newIdx = Math.max(0, idx - step);
        if (newIdx !== idx) navigateTo(nb.pages[newIdx].id, 'prev');
      });
    }
    const nextBtn = $('notebook-next-page');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        const nb = currentNotebook();
        const step = nb.pageViewMode === 'spread' ? 2 : 1;
        const idx = nb.pages.findIndex((p) => p.id === nb.activePageId);
        const newIdx = Math.min(nb.pages.length - 1, idx + step);
        if (newIdx !== idx) navigateTo(nb.pages[newIdx].id, 'next');
      });
    }

    const addBtn = $('notebook-add-page');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        capture();
        const nb = currentNotebook();
        const p = newPage(`Página ${nb.pages.length + 1}`);
        nb.pages.push(p);
        nb.activePageId = p.id;
        render();
        scheduleSave();
      });
    }

    app.querySelectorAll('button[data-delete-page]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const nb = currentNotebook();
        if (nb.pages.length <= 1) {
          window.alert('não dá pra apagar a única página do caderno.');
          return;
        }
        const id = btn.dataset.deletePage;
        const page = nb.pages.find((p) => p.id === id);
        if (!page) return;
        if (!window.confirm(`apagar a página "${page.title}"? não dá pra desfazer.`)) return;
        const idx = nb.pages.findIndex((p) => p.id === id);
        nb.pages.splice(idx, 1);
        if (nb.activePageId === id) nb.activePageId = nb.pages[Math.max(0, idx - 1)].id;
        render();
        scheduleSave();
      });
    });
  }

  load();
}
