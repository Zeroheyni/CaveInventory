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
  paperlessImageFile,
  sanitizeNotebookHtml,
  newPage,
  newNotebook,
  getFontFamily,
  ensureCustomFontLoaded,
  RULINGS,
  coverColorOf,
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
  // corretor ortográfico (os risquinhos vermelhos): vem DESLIGADO; a escolha fica guardada neste navegador
  const SPELL_KEY = 'cave.notebook.spellcheck';
  let spellcheckOn = false;
  try {
    spellcheckOn = localStorage.getItem(SPELL_KEY) === '1';
  } catch (_) { /* sem storage: fica desligado */ }
  let exportMenuOpen = false;

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
    postRender();
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
        <div class="nb-shelf">${list.map((nb) => notebookCard(nb.notebookId, nb.notebookName, nb.themeId, false, nb.variant)).join('')}</div>
      `;
    }
    const list = notebookData.notebooks;
    return `
      <div class="notebook-list-head">
        <div class="ficha-section-title">MEUS CADERNOS</div>
        ${!creatingNotebook ? `<button type="button" class="btn" id="notebook-new-btn">+ novo caderno</button>` : ''}
      </div>
      ${creatingNotebook ? newNotebookPanel() : ''}
      <div class="nb-shelf">
        ${list.map((nb) => notebookCard(nb.id, nb.name, nb.themeId, true, nb.variant)).join('')}
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

  // capa de caderno numa estante: couro/pano na cor do material, lombada costurada, fita marcadora e plaquinha com o nome
  function notebookCard(id, name, themeId, deletable, variant) {
    const theme = themeDef(themeId);
    const isDigital = theme.family === 'digital';
    const emblem = isDigital ? '>_' : themeId === 'pergaminho' ? '📜' : '📖';
    return `
      <div class="notebook-card-wrap nb-book-wrap">
        <button type="button" class="notebook-card nb-cover ${isDigital ? 'nb-cover-digital' : 'nb-cover-leather'}" data-open-notebook="${id}" style="--cover:${coverColorOf(themeId, variant)};">
          <span class="nb-cover-spine"></span>
          ${isDigital ? '' : '<span class="nb-cover-ribbon"></span>'}
          <span class="nb-cover-plate">
            <span class="nb-cover-emblem">${emblem}</span>
            <span class="notebook-card-name">${escapeHtml(name)}</span>
            <span class="notebook-card-theme">${escapeHtml(theme.label)}</span>
          </span>
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
      <div class="notebook-wrap nb-immersive ${themeClasses}" style="--notebook-font:${fontFamily};">
        <div class="nb-top">
          <button type="button" class="btn btn-ghost" id="notebook-back-to-list">← cadernos</button>
          <span class="notebook-name">${escapeHtml(nb.name)}</span>
          ${isOwner ? `<button type="button" class="notebook-pencil-btn" id="notebook-rename-current" title="renomear caderno">✎</button>` : ''}
          <span class="notebook-toolbar-sep"></span>
          ${
            isOwner
              ? `
            <div class="notebook-settings-wrap" id="notebook-settings-wrap">
              <button type="button" class="notebook-fmt-btn" id="notebook-settings-btn" title="personalizar caderno (material, fonte, pauta...)">⚙</button>
              ${settingsOpen ? settingsPanel(nb, theme) : ''}
            </div>
            <button type="button" class="notebook-fmt-btn nb-spell ${spellcheckOn ? 'on' : ''}" id="notebook-spell-btn" title="${spellcheckOn ? 'corretor ortográfico LIGADO (clique pra desligar)' : 'corretor ortográfico desligado (clique pra ligar)'}">${spellcheckOn ? 'abc✓' : 'abc'}</button>
          `
              : ''
          }
          <div class="notebook-settings-wrap" id="notebook-export-wrap">
            <button type="button" class="notebook-fmt-btn" id="notebook-export-btn" title="exportar como imagem (pra mandar em outros lugares)">📷</button>
            ${exportMenuOpen ? exportMenu(nb, theme) : ''}
          </div>
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
            : isDigital
              ? digitalBody(nb)
              : physicalBody(nb)
        }
      </div>
    `;
  }

  // o que dá pra exportar: cada item tem baixar (⬇) e copiar (📋)
  function exportMenu(nb, theme) {
    let items;
    if (theme.family === 'digital') items = [['term', 'A janela do terminal']];
    else if (nb.pageViewMode === 'spread') items = [['sheet-l', 'Página esquerda'], ['sheet-r', 'Página direita'], ['book', 'As duas páginas (caderno aberto, só o conteúdo)']];
    else items = [['sheet-l', 'A folha']];
    return `
      <div class="notebook-settings-panel nb-export-menu">
        <div class="notebook-settings-row"><label>Exportar como imagem</label></div>
        ${items
          .map(
            ([k, label]) => `
          <div class="nb-export-item">
            <span>${label}</span>
            <button type="button" class="notebook-fmt-btn" data-export="${k}" data-mode="download" title="baixar PNG">⬇</button>
            <button type="button" class="notebook-fmt-btn" data-export="${k}" data-mode="copy" title="copiar imagem (cole em qualquer lugar)">📋</button>
          </div>`
          )
          .join('')}
      </div>`;
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
            <label>Folha</label>
            <select id="notebook-ruling-select">
              ${RULINGS.map((r) => `<option value="${r.id}" ${r.id === nb.ruling ? 'selected' : ''}>${escapeHtml(r.label)}</option>`).join('')}
            </select>
          </div>
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
        <button type="button" class="notebook-fmt-btn" data-fx="nb-fx-strike" title="riscar o texto selecionado"><s>S</s></button>
        <div class="nb-fx-wrap" id="notebook-fx-wrap">
          <button type="button" class="notebook-fmt-btn" id="notebook-fx-btn" title="mais estilos: riscado, censura, marca-texto, brilho, alinhamento...">✨</button>
          <div class="nb-fx-pop" id="notebook-fx-pop">
            <div class="nb-fx-title">Estilo do trecho selecionado</div>
            <div class="nb-fx-grid">
              <button type="button" data-fx="nb-fx-strike"><span class="nb-fx-strike">Riscado</span></button>
              <button type="button" data-fx="nb-fx-scratch"><span class="nb-fx-scratch">Rasurado</span></button>
              <button type="button" data-fx="nb-fx-censor" title="tarja preta fixa (não revela ao clicar)"><span class="nb-fx-censor">Censurado</span></button>
              <button type="button" data-fx="nb-fx-smudge"><span class="nb-fx-smudge">Borrado</span></button>
              <button type="button" data-fx="nb-fx-ghost"><span class="nb-fx-ghost">Apagado</span></button>
              <button type="button" data-fx="nb-fx-wavy"><span class="nb-fx-wavy">Ondulado</span></button>
              <button type="button" data-fx="nb-fx-glow"><span class="nb-fx-glow">Brilho</span></button>
              <button type="button" data-fx="nb-fx-blood"><span class="nb-fx-blood">Sangue</span></button>
              <button type="button" data-fx="nb-fx-caps"><span class="nb-fx-caps">Versalete</span></button>
              <button type="button" data-blk="sup">x<sup>2</sup> sobrescrito</button>
              <button type="button" data-blk="sub">x<sub>2</sub> subscrito</button>
            </div>
            <div class="nb-fx-title">Marca-texto</div>
            <div class="nb-fx-hls">
              <button type="button" data-fx="nb-fx-hl-y" title="amarelo"><span class="nb-fx-hl-y">abc</span></button>
              <button type="button" data-fx="nb-fx-hl-p" title="rosa"><span class="nb-fx-hl-p">abc</span></button>
              <button type="button" data-fx="nb-fx-hl-g" title="verde"><span class="nb-fx-hl-g">abc</span></button>
              <button type="button" data-fx="nb-fx-hl-b" title="azul"><span class="nb-fx-hl-b">abc</span></button>
            </div>
            <div class="nb-fx-title">Parágrafo</div>
            <div class="nb-fx-grid nb-fx-grid-4">
              <button type="button" data-blk="align-left" title="alinhar à esquerda">⇤</button>
              <button type="button" data-blk="align-center" title="centralizar">↔</button>
              <button type="button" data-blk="align-right" title="alinhar à direita">⇥</button>
              <button type="button" data-blk="align-full" title="justificar">☰</button>
            </div>
            <div class="nb-fx-grid">
              <button type="button" data-blk="quote">❝ Citação</button>
              <button type="button" data-blk="dropcap">Ａ Letra capitular</button>
              <button type="button" data-blk="divider">❖ Divisória</button>
              <button type="button" data-blk="clear" class="nb-fx-clear">⌫ Limpar estilo</button>
            </div>
          </div>
        </div>
        <span class="nb-tb-sep"></span>
        <button type="button" class="notebook-fmt-btn nb-size-btn" data-size="dec" title="diminuir a fonte do trecho selecionado (ou da linha onde está o cursor)">A−</button>
        <button type="button" class="notebook-fmt-btn nb-size-btn" data-size="inc" title="aumentar a fonte do trecho selecionado (ou da linha onde está o cursor)">A+</button>
        <button type="button" class="notebook-fmt-btn nb-size-btn" data-size="36" title="título grande">T1</button>
        <button type="button" class="notebook-fmt-btn nb-size-btn" data-size="26" title="subtítulo">T2</button>
        <button type="button" class="notebook-fmt-btn nb-size-btn" data-size="reset" title="voltar ao tamanho normal">Aa</button>
        <span class="nb-tb-sep"></span>
        <button type="button" class="notebook-fmt-btn" data-fmt="insertUnorderedList" title="lista">☰</button>
        <button type="button" class="notebook-fmt-btn" data-fmt="insertOrderedList" title="lista numerada">①</button>
        <button type="button" class="notebook-fmt-btn" id="notebook-spoiler-btn" title="marcar trecho selecionado como spoiler (tarja preta -- clique no texto pra revelar)">🙈</button>
        <button type="button" class="notebook-fmt-btn" id="notebook-img-btn" title="inserir imagem">🖼</button>
        <input type="file" id="notebook-img-input" accept="image/*" style="display:none;">
        <div class="notebook-color-wrap" id="notebook-color-wrap">
          <button type="button" class="notebook-fmt-btn" id="notebook-color-btn" title="cor do texto">🎨</button>
          <div class="notebook-color-popover ${colorPopoverOpen ? 'open' : ''}" id="notebook-color-pop">${TEXT_COLORS.map((c) => `<button type="button" class="notebook-color-swatch" data-color="${c}" style="background:${c};"></button>`).join('')}</div>
        </div>
      </div>
    `;
  }

  // ---- título da página + ações (renomear/apagar), fora da folha pra não sujar a escrita ----
  function titleControls(page) {
    if (!page) return '';
    return `<span class="nb-ptitle" title="${escapeHtml(page.title)}">${escapeHtml(page.title)}</span>${
      isOwner
        ? `<button type="button" class="notebook-pencil-btn" data-rename-page="${page.id}" title="renomear página">✎</button><button type="button" class="notebook-pencil-btn notebook-delete-page-btn" data-delete-page="${page.id}" title="apagar página">✕</button>`
        : ''
    }`;
  }

  const slug = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'pagina';

  const pageEditor = (page, id) =>
    `<div class="notebook-page" id="${id}" data-page-id="${page.id}" ${isOwner ? `contenteditable="true" spellcheck="${spellcheckOn ? 'true' : 'false'}"` : ''}>${sanitizeNotebookHtml(page.html)}</div>`;

  // uma folha do livro: cabeçalho corrente, texto, número da página e canto que vira a página
  function sheetHtml(page, side, folio, hasMore) {
    const curl = hasMore ? `<button type="button" class="nb-curl nb-curl-${side === 'l' ? 'prev' : 'next'}" data-export-skip data-curl="${side === 'l' ? 'prev' : 'next'}" title="${side === 'l' ? 'página anterior' : 'próxima página'}"></button>` : '';
    return `
      <section class="nb-sheet nb-sheet-${side}">
        <div class="nb-runhead">${escapeHtml(page.title)}</div>
        ${pageEditor(page, side === 'l' ? 'notebook-page-surface' : 'notebook-page-surface-right')}
        <div class="nb-folio">${folio}</div>
        ${curl}
      </section>`;
  }

  // metade direita sem página ainda: o dono clica e a próxima página nasce ali (antes era um "fim do caderno" morto)
  function blankSheetHtml() {
    return `
      <section class="nb-sheet nb-sheet-r nb-sheet-blank">
        <div class="notebook-page nb-blank-page">
          ${
            isOwner
              ? `<button type="button" class="nb-blank-add" id="nb-add-right" data-export-skip><span class="nb-blank-plus">＋</span><b>continuar o caderno</b><small>clique para criar a próxima página</small></button>`
              : `<span class="notebook-blank-half">fim do caderno</span>`
          }
        </div>
      </section>`;
  }

  function pageBar(nb, leftPage, rightPage, prevDisabled, nextDisabled, countText) {
    return `
      <div class="nb-pagebar">
        <div class="nb-pagebar-side">${titleControls(leftPage)}</div>
        <div class="nb-pagebar-mid">
          <button type="button" class="notebook-page-arrow" id="notebook-prev-page" ${prevDisabled ? 'disabled' : ''} title="página anterior (Alt + ←)">‹</button>
          <span class="notebook-page-count">${countText}</span>
          <button type="button" class="notebook-page-arrow" id="notebook-next-page" ${nextDisabled ? 'disabled' : ''} title="próxima página (Alt + →)">›</button>
          ${isOwner ? `<button type="button" class="notebook-tab-add" id="notebook-add-page" title="nova página no fim do caderno">+</button>` : ''}
        </div>
        <div class="nb-pagebar-side nb-right">${titleControls(rightPage)}</div>
      </div>`;
  }

  function digitalBody(nb) {
    const idx = Math.max(0, nb.pages.findIndex((p) => p.id === nb.activePageId));
    const page = nb.pages[idx] || nb.pages[0];
    return `
      <div class="nb-term" id="nb-book">
        <div class="nb-term-title">
          <span class="nb-dots"><i></i><i></i><i></i></span>
          <span class="nb-term-name">~/cadernos/${slug(nb.name)}/${slug(page ? page.title : '')}</span>
        </div>
        <div class="notebook-tabs nb-term-tabs">
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
          ${isOwner ? `<button type="button" class="notebook-tab-add" id="notebook-add-page" title="nova página" data-export-skip>+</button>` : ''}
        </div>
        <div class="nb-term-body">
          ${page ? pageEditor(page, 'notebook-page-surface') : ''}
        </div>
        <div class="nb-term-status"><span>● ${escapeHtml(page ? page.title : '')}</span><span>página ${idx + 1} de ${nb.pages.length}</span></div>
      </div>
      ${isOwner && page ? sharePageToggle(page) : ''}
    `;
  }

  function physicalBody(nb) {
    if (nb.pageViewMode === 'spread') return spreadBody(nb);
    const idx = Math.max(0, nb.pages.findIndex((p) => p.id === nb.activePageId));
    const page = nb.pages[idx];
    return `
      ${pageBar(nb, page, null, idx <= 0, idx >= nb.pages.length - 1, `${idx + 1} / ${nb.pages.length}`)}
      <div class="nb-desk">
        <div class="nb-book nb-book-single" id="nb-book" data-ruling="${nb.ruling}" style="--cover:${coverColorOf(nb.themeId, nb.variant)};">
          <div class="nb-spread nb-spread-single">
            ${page ? sheetHtml(page, 'l', idx + 1, idx < nb.pages.length - 1).replace('nb-curl-prev', 'nb-curl-next').replace('data-curl="prev"', 'data-curl="next"').replace('página anterior', 'próxima página') : ''}
          </div>
          <span class="nb-ribbon"></span>
        </div>
      </div>
      ${isOwner && page ? sharePageToggle(page) : ''}
    `;
  }

  function spreadBody(nb) {
    const idx = Math.max(0, nb.pages.findIndex((p) => p.id === nb.activePageId));
    const pairStart = idx - (idx % 2);
    const left = nb.pages[pairStart];
    const right = nb.pages[pairStart + 1];
    const total = nb.pages.length;
    return `
      ${pageBar(nb, left, right, pairStart <= 0, pairStart + 2 >= total, `${pairStart + 1}${right ? '–' + (pairStart + 2) : ''} / ${total}`)}
      <div class="nb-desk">
        <div class="nb-book nb-book-spread" id="nb-book" data-ruling="${nb.ruling}" style="--cover:${coverColorOf(nb.themeId, nb.variant)};">
          <div class="nb-spread">
            ${left ? sheetHtml(left, 'l', pairStart + 1, pairStart > 0) : ''}
            ${right ? sheetHtml(right, 'r', pairStart + 2, pairStart + 2 < total) : blankSheetHtml()}
            <div class="nb-gutter"></div>
          </div>
          <span class="nb-ribbon"></span>
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

  // virar de página: a folha que está sendo virada gira em torno da lombada (a da direita pra frente, a da esquerda pra trás),
  // e a nova cai do outro lado. No terminal (digital) só troca.
  function navigateTo(newId, direction) {
    capture();
    const nb = currentNotebook();
    const theme = themeDef(nb.themeId);
    const spread = app.querySelector('.nb-spread');
    const out = direction && theme.family === 'physical' && spread ? spread.querySelector(direction === 'next' ? '.nb-sheet-r, .nb-sheet-l:only-of-type' : '.nb-sheet-l') : null;
    if (out && !reduceMotion()) {
      out.classList.add(direction === 'next' ? 'nb-turn-out-next' : 'nb-turn-out-prev');
      setTimeout(() => {
        nb.activePageId = newId;
        render();
        const fresh = app.querySelector('.nb-spread');
        const into = fresh && fresh.querySelector(direction === 'next' ? '.nb-sheet-l' : '.nb-sheet-r, .nb-sheet-l:only-of-type');
        if (into) {
          const cls = direction === 'next' ? 'nb-turn-in-next' : 'nb-turn-in-prev';
          into.classList.add(cls);
          setTimeout(() => into.classList.remove(cls), 420);
        }
      }, 230);
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

  // ---- acabamento da imagem (barra flutuante) ----
  let imageBar = null;
  let imageBarImg = null;
  function hideImageBar() {
    if (imageBar) imageBar.remove();
    imageBar = null;
    if (imageBarImg) imageBarImg.classList.remove('nb-img-selected');
    imageBarImg = null;
  }
  function showImageBar(img) {
    hideImageBar();
    const pageEl = img.closest('.notebook-page');
    // largura útil do texto na página (sem o padding), pra trabalhar em % -- vale em qualquer tela e na exportação
    const contentW = () => {
      if (!pageEl) return 1;
      const cs = getComputedStyle(pageEl);
      return Math.max(1, pageEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    };
    const curPct = () => Math.max(5, Math.min(100, Math.round((img.getBoundingClientRect().width / contentW()) * 100)));
    const has = (c) => img.classList.contains(c);

    const bar = document.createElement('div');
    bar.className = 'notebook-img-bar nb-img-bar';
    img.classList.add('nb-img-selected');
    bar.innerHTML = `
      <div class="nb-ib-row">
        <span class="nb-ib-label">tamanho</span>
        ${[25, 50, 75, 100].map((n) => `<button type="button" data-img-size="${n}">${n}%</button>`).join('')}
        <input type="range" min="10" max="100" step="1" value="${curPct()}" data-img-range title="arraste pra ajustar o tamanho">
        <output class="nb-ib-out">${curPct()}%</output>
      </div>
      <div class="nb-ib-row">
        <button type="button" data-img-act="full" class="${has('notebook-img-full') ? 'on' : ''}" title="a imagem ocupa a página inteira, de ponta a ponta">⛶ página inteira</button>
        <button type="button" data-img-act="center" class="${has('notebook-img-center') ? 'on' : ''}" title="centraliza a imagem">↔ centralizar</button>
        <span class="nb-ib-sep"></span>
        <button type="button" data-img-act="paper" title="transforma o papel do desenho em transparência: o traço fica direto na página">🪄 tirar o papel</button>
        <button type="button" data-img-act="blend" class="${has('notebook-img-blend') ? 'on' : ''}" title="funde a imagem com a cor da página (some o branco)">🎨 mesclar</button>
        <button type="button" data-img-act="plain" class="${!has('notebook-img-flat') && !has('notebook-img-blend') ? 'on' : ''}" title="com moldura e sombra">▭ normal</button>
        <span class="nb-ib-sep"></span>
        <button type="button" data-img-act="remove" class="nb-ib-danger" title="apagar a imagem">🗑</button>
      </div>
      <span class="notebook-img-bar-msg"></span>`;
    document.body.appendChild(bar);

    const place = () => {
      const r = img.getBoundingClientRect();
      const below = r.top < bar.offsetHeight + 24;
      bar.style.left = Math.max(8, Math.min(window.innerWidth - bar.offsetWidth - 8, r.left + r.width / 2 - bar.offsetWidth / 2)) + 'px';
      bar.style.top = Math.max(8, Math.min(window.innerHeight - bar.offsetHeight - 8, below ? Math.min(r.bottom + 10, window.innerHeight - bar.offsetHeight - 8) : r.top - bar.offsetHeight - 10)) + 'px';
    };
    place();
    imageBar = bar;
    imageBarImg = img;

    const msg = bar.querySelector('.notebook-img-bar-msg');
    const out = bar.querySelector('.nb-ib-out');
    const range = bar.querySelector('[data-img-range]');
    const commit = () => {
      capture();
      scheduleSave();
    };
    const refreshButtons = () => {
      bar.querySelector('[data-img-act="full"]').classList.toggle('on', has('notebook-img-full'));
      bar.querySelector('[data-img-act="center"]').classList.toggle('on', has('notebook-img-center'));
      bar.querySelector('[data-img-act="blend"]').classList.toggle('on', has('notebook-img-blend'));
      bar.querySelector('[data-img-act="plain"]').classList.toggle('on', !has('notebook-img-flat') && !has('notebook-img-blend'));
      range.value = String(curPct());
      out.textContent = curPct() + '%';
    };
    const setWidthPct = (p) => {
      img.classList.remove('notebook-img-full'); // escolher um tamanho tira o "página inteira"
      img.style.width = p + '%';
      img.style.height = 'auto';
      out.textContent = p + '%';
      place();
    };
    bar.addEventListener('mousedown', (e) => {
      if (e.target !== range) e.preventDefault(); // não rouba o foco do editor
    });
    bar.querySelectorAll('[data-img-size]').forEach((b) =>
      b.addEventListener('click', () => {
        setWidthPct(Number(b.dataset.imgSize));
        refreshButtons();
        commit();
      })
    );
    range.addEventListener('input', () => setWidthPct(Number(range.value)));
    range.addEventListener('change', () => {
      refreshButtons();
      commit();
    });
    const act = (name, fn) => bar.querySelector(`[data-img-act="${name}"]`).addEventListener('click', fn);
    act('full', () => {
      img.classList.toggle('notebook-img-full');
      img.classList.add('notebook-img-center');
      if (has('notebook-img-full')) {
        img.style.removeProperty('width');
        img.style.removeProperty('height');
      } else if (!img.style.width) img.style.width = '100%';
      refreshButtons();
      place();
      commit();
    });
    act('center', () => {
      img.classList.toggle('notebook-img-center');
      refreshButtons();
      commit();
    });
    act('plain', () => {
      img.classList.remove('notebook-img-flat', 'notebook-img-blend');
      img.classList.add('notebook-img');
      refreshButtons();
      commit();
    });
    act('blend', () => {
      const on = has('notebook-img-blend');
      img.classList.remove('notebook-img', 'notebook-img-flat', 'notebook-img-blend');
      img.classList.add(on ? 'notebook-img' : 'notebook-img-blend');
      refreshButtons();
      commit();
    });
    act('remove', () => {
      img.remove();
      commit();
      hideImageBar();
    });
    act('paper', async () => {
      msg.textContent = 'processando…';
      try {
        const file = await paperlessImageFile(img.getAttribute('src'));
        const url = await uploadNotebookImage(characterId, file);
        img.setAttribute('src', url);
        img.classList.remove('notebook-img', 'notebook-img-blend');
        img.classList.add('notebook-img-flat');
        msg.textContent = 'papel removido ✓';
        refreshButtons();
        commit();
      } catch (err) {
        msg.textContent = 'não deu: ' + err.message;
      }
    });
  }
  document.addEventListener('mousedown', (e) => {
    if (imageBar && !imageBar.contains(e.target) && e.target.tagName !== 'IMG') hideImageBar();
  });

  // puxar o canto inferior direito da imagem muda o tamanho -- guarda em % da página (vale em qualquer tela)
  function startImageResize(img, e) {
    e.preventDefault();
    const pageEl = img.closest('.notebook-page');
    const cs = pageEl ? getComputedStyle(pageEl) : null;
    const contentW = pageEl ? Math.max(1, pageEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) : 1;
    const startX = e.clientX;
    const startWidth = img.getBoundingClientRect().width;
    img.classList.remove('notebook-img-full');
    function onMove(ev) {
      const pct = Math.max(5, Math.min(100, ((startWidth + (ev.clientX - startX)) / contentW) * 100));
      img.style.width = pct.toFixed(1) + '%';
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

  // ---- extras do livro: corretor, exportar como imagem, virar página pelo canto, atalhos ----
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function setStatus(text) {
    const el = $('notebook-save-status');
    if (el) el.textContent = text;
  }

  // PNG do que está na tela (folha, página, livro aberto ou janela do terminal). Fontes e imagens vão embutidas.
  // A fonte do caderno vem do Google Fonts (CSS de outro domínio): o html-to-image não consegue ler/embutir sozinho e a imagem sairia com a fonte
  // padrão. Aqui busco o CSS, fico só com as faces das famílias usadas e troco cada url() por data: URI.
  const fontCssCache = new Map();
  async function embeddedFontCss(fontFamilyValue) {
    const names = String(fontFamilyValue || '')
      .split(',')
      .map((f) => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
      .filter(Boolean);
    const key = names.join('|');
    if (fontCssCache.has(key)) return fontCssCache.get(key);
    const toData = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
    let out = '';
    try {
      const links = [...document.querySelectorAll('link[rel="stylesheet"][href*="fonts.googleapis.com"]')];
      for (const l of links) {
        const css = await (await fetch(l.href)).text();
        const faces = (css.match(/@font-face\s*\{[^}]*\}/g) || []).filter((b) => {
          const m = /font-family:\s*['"]?([^;'"]+)['"]?/i.exec(b);
          return m && names.includes(m[1].trim().toLowerCase());
        });
        for (let face of faces) {
          for (const u of [...face.matchAll(/url\(([^)]+)\)/g)]) {
            const url = u[1].replace(/^['"]|['"]$/g, '');
            const data = await toData(await (await fetch(url)).blob());
            face = face.split(u[0]).join('url(' + data + ')');
          }
          out += face + '\n';
        }
      }
    } catch (_) {
      out = ''; // sem internet/CORS: deixa o html-to-image tentar sozinho
    }
    fontCssCache.set(key, out);
    return out;
  }

  async function exportImage(kind, mode) {
    capture();
    // 'book' = as duas páginas lado a lado, exatamente como na tela (sem a capa); 'term' = a janela do terminal
    const node = kind === 'sheet-l' ? app.querySelector('.nb-sheet-l') : kind === 'sheet-r' ? app.querySelector('.nb-sheet-r') : kind === 'term' ? app.querySelector('#nb-book') : app.querySelector('.nb-spread');
    if (!node) return;
    setStatus('gerando imagem…');
    const book = app.querySelector('#nb-book');
    if (book) book.classList.add('nb-exporting'); // some com placeholders/contornos de edição
    try {
      const { toBlob } = await import('html-to-image');
      // espera as fontes do caderno carregarem antes de fotografar
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const pageEl = app.querySelector('.notebook-page');
      const fontEmbedCSS = pageEl ? await embeddedFontCss(getComputedStyle(pageEl).fontFamily) : '';
      const blob = await Promise.race([toBlob(node, {
        pixelRatio: 2,
        cacheBust: true,
        ...(fontEmbedCSS ? { fontEmbedCSS } : {}),
        filter: (n) => !(n.dataset && n.dataset.exportSkip !== undefined),
      }), new Promise((_, rej) => setTimeout(() => rej(new Error('demorou demais -- tente de novo com a aba em primeiro plano')), 25000))]);
      if (!blob) throw new Error('não consegui gerar a imagem');
      const nb = currentNotebook();
      const name = `${slug(nb ? nb.name : 'caderno')}-${kind === 'book' || kind === 'term' ? 'caderno' : 'pagina'}.png`;
      if (mode === 'copy') {
        if (!navigator.clipboard || !window.ClipboardItem) throw new Error('seu navegador não deixa copiar imagem -- use o botão de baixar');
        await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
        setStatus('imagem copiada ✓');
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        setStatus('imagem baixada ✓');
      }
    } catch (err) {
      setStatus('erro ao exportar: ' + err.message);
    } finally {
      if (book) book.classList.remove('nb-exporting');
      setTimeout(() => setStatus(''), 3500);
    }
  }

  let keyWired = false;
  function wireBookExtras() {
    const rulingSelect = $('notebook-ruling-select');
    if (rulingSelect) {
      rulingSelect.addEventListener('change', () => {
        capture();
        currentNotebook().ruling = rulingSelect.value;
        settingsOpen = true;
        render();
        scheduleSave();
      });
    }
    const spellBtn = $('notebook-spell-btn');
    if (spellBtn) {
      spellBtn.addEventListener('click', () => {
        spellcheckOn = !spellcheckOn;
        try {
          localStorage.setItem(SPELL_KEY, spellcheckOn ? '1' : '0');
        } catch (_) { /* sem storage: vale só nessa sessão */ }
        capture();
        render();
      });
    }
    const exportBtn = $('notebook-export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        exportMenuOpen = !exportMenuOpen;
        capture();
        render();
      });
    }
    app.querySelectorAll('[data-export]').forEach((b) => {
      b.addEventListener('click', async () => {
        exportMenuOpen = false;
        render();
        await exportImage(b.dataset.export, b.dataset.mode);
      });
    });
    // canto da folha vira a página
    app.querySelectorAll('[data-curl]').forEach((b) => {
      b.addEventListener('click', () => {
        const target = $(b.dataset.curl === 'prev' ? 'notebook-prev-page' : 'notebook-next-page');
        if (target && !target.disabled) target.click();
      });
    });
    // metade direita vazia: cria a próxima página e já põe o cursor nela
    const addRight = $('nb-add-right');
    if (addRight) {
      addRight.addEventListener('click', () => {
        capture();
        const nb = currentNotebook();
        const p = newPage(`Página ${nb.pages.length + 1}`);
        nb.pages.push(p);
        nb.activePageId = p.id;
        lastFocusedSide = 'right';
        render();
        scheduleSave();
        const surf = $('notebook-page-surface-right') || $('notebook-page-surface');
        if (surf) surf.focus();
      });
    }
    if (!keyWired) {
      keyWired = true;
      document.addEventListener('keydown', (e) => {
        if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || view !== 'notebook' || !app.isConnected) return;
        const btn = $(e.key === 'ArrowLeft' ? 'notebook-prev-page' : 'notebook-next-page');
        if (btn && !btn.disabled) {
          e.preventDefault();
          btn.click();
        }
      });
    }
  }

  // depois de cada render: a cor do texto da folha vira variável (cabeçalho, número de página e pauta usam a mesma cor)
  function postRender() {
    const pg = app.querySelector('.notebook-page');
    const book = app.querySelector('#nb-book');
    if (pg && book) book.style.setProperty('--nb-fg', getComputedStyle(pg).color);
  }

  function wireEvents() {
    wireBookExtras();
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
        if (exportMenuOpen && !e.target.closest('#notebook-export-wrap')) {
          exportMenuOpen = false;
          render();
        }
        if (colorPopoverOpen && !e.target.closest('#notebook-color-wrap')) {
          colorPopoverOpen = false;
          const pop = $('notebook-color-pop');
          if (pop) pop.classList.remove('open');
        }
        if (!e.target.closest('#notebook-fx-wrap')) {
          const fp = $('notebook-fx-pop');
          if (fp) fp.classList.remove('open');
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

    // tamanho da fonte livre: A−/A+ (passo de 2px) e presets de título; sem seleção vale pra linha inteira do cursor
    app.querySelectorAll('button[data-size]').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => applyFontSize(btn.dataset.size));
    });
    function applyFontSize(how) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const anchor = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
      const editor = anchor && anchor.closest('.notebook-page[contenteditable="true"]');
      if (!editor) return;
      if (sel.isCollapsed) {
        // sem seleção: pega a linha (bloco) inteira onde está o cursor
        let blk = anchor;
        while (blk && blk.parentElement !== editor) blk = blk.parentElement;
        const r = document.createRange();
        if (blk && blk !== editor) r.selectNodeContents(blk);
        else r.selectNodeContents(editor);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      const cur = parseFloat(getComputedStyle(sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement).fontSize) || 18;
      const base = parseFloat(getComputedStyle(editor).fontSize) || 18;
      let px;
      if (how === 'inc') px = Math.round(cur) + 2;
      else if (how === 'dec') px = Math.round(cur) - 2;
      else if (how === 'reset') px = null;
      else px = Number(how);
      if (px != null) px = Math.max(8, Math.min(120, px));
      document.execCommand('styleWithCSS', false, false);
      document.execCommand('fontSize', false, '7'); // marca o trecho com <font size=7>; abaixo viram <span style="font-size">
      editor.querySelectorAll('font[size="7"]').forEach((f) => {
        const span = document.createElement('span');
        while (f.firstChild) span.appendChild(f.firstChild);
        // tamanhos antigos dentro do trecho não podem sobrepor o novo
        span.querySelectorAll('[style]').forEach((el) => el.style.removeProperty('font-size'));
        if (px != null && Math.abs(px - base) > 0.5) span.style.fontSize = px + 'px';
        f.replaceWith(span);
        const r = document.createRange();
        r.selectNodeContents(span);
        sel.removeAllRanges();
        sel.addRange(r);
      });
      // spans de tamanho que ficaram vazios/sem estilo
      editor.querySelectorAll('span:not([class])').forEach((sp) => {
        if (!sp.getAttribute('style') || !sp.getAttribute('style').trim()) {
          while (sp.firstChild) sp.parentNode.insertBefore(sp.firstChild, sp);
          sp.remove();
        }
      });
      capture();
      scheduleSave();
    }

    // ---- estilos de texto (menu ✨): riscado, censura, marca-texto, brilho, alinhamento, citação, letra capitular... ----
    // Cada efeito é um <span class="nb-fx-..."> (a lista branca do sanitize só deixa passar essas classes); aplicar de novo no mesmo trecho desliga.
    const FX_HL = ['nb-fx-hl-y', 'nb-fx-hl-p', 'nb-fx-hl-g', 'nb-fx-hl-b'];
    const fxBtn = $('notebook-fx-btn');
    const fxPop = $('notebook-fx-pop');
    if (fxBtn && fxPop) {
      fxBtn.addEventListener('mousedown', (e) => e.preventDefault());
      fxBtn.addEventListener('click', () => fxPop.classList.toggle('open'));
      fxPop.addEventListener('mousedown', (e) => e.preventDefault()); // não rouba a seleção do texto
    }
    function fxEditor() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const n = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
      return n ? n.closest('.notebook-page[contenteditable="true"]') : null;
    }
    function unwrapEl(el) {
      const p = el.parentNode;
      while (el.firstChild) p.insertBefore(el.firstChild, el);
      el.remove();
    }
    // textos da seleção, já cortados nas bordas (pra marcar só o que foi selecionado)
    function selectedTextNodes(editor) {
      const sel = window.getSelection();
      if (sel.isCollapsed) {
        try {
          sel.modify('move', 'backward', 'word');
          sel.modify('extend', 'forward', 'word');
        } catch (_) { /* navegador sem selection.modify: exige seleção */ }
        if (sel.isCollapsed) return [];
      }
      const range = sel.getRangeAt(0);
      let sc = range.startContainer;
      const so = range.startOffset;
      let ec = range.endContainer;
      const eo = range.endOffset;
      if (ec.nodeType === 3 && eo < ec.length) ec.splitText(eo);
      if (sc.nodeType === 3 && so > 0) {
        const right = sc.splitText(so);
        if (sc === ec) ec = right;
        sc = right;
      }
      const r = document.createRange();
      r.setStart(sc, sc.nodeType === 3 ? 0 : so);
      r.setEnd(ec, ec.nodeType === 3 ? ec.length : eo);
      const out = [];
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const t = walker.currentNode;
        if (!t.nodeValue || !r.intersectsNode(t)) continue;
        if (/\n/.test(t.nodeValue) && !t.nodeValue.trim()) continue; // quebras de linha entre blocos
        out.push(t);
      }
      return out;
    }
    function applyFx(cls) {
      const editor = fxEditor();
      if (!editor) return;
      const nodes = selectedTextNodes(editor);
      if (!nodes.length) return;
      const inFx = (n, c) => (n.parentElement ? n.parentElement.closest('span.' + c) : null);
      const allOn = nodes.every((n) => {
        const s = inFx(n, cls);
        return s && editor.contains(s);
      });
      let first = null;
      let last = null;
      if (allOn) {
        new Set(nodes.map((n) => inFx(n, cls))).forEach(unwrapEl);
      } else {
        if (FX_HL.includes(cls)) {
          FX_HL.filter((c) => c !== cls).forEach((c) => nodes.forEach((n) => { const s = inFx(n, c); if (s) unwrapEl(s); }));
        }
        nodes.forEach((n) => {
          let s = inFx(n, cls);
          if (!s) {
            s = document.createElement('span');
            s.className = cls;
            n.replaceWith(s);
            s.appendChild(n);
          }
          first = first || s;
          last = s;
        });
        // junta spans vizinhos iguais (selecionar de novo não empilha spans)
        editor.querySelectorAll('span.' + cls).forEach((s) => {
          const nx = s.nextSibling;
          if (nx && nx.nodeType === 1 && nx.tagName === 'SPAN' && nx.className === s.className && !nx.getAttribute('style')) {
            while (nx.firstChild) s.appendChild(nx.firstChild);
            nx.remove();
          }
        });
      }
      const sel = window.getSelection();
      if (first && last && first.isConnected && last.isConnected) {
        const r = document.createRange();
        r.setStartBefore(first);
        r.setEndAfter(last);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      capture();
      scheduleSave();
    }
    function blockOf(editor) {
      const sel = window.getSelection();
      let n = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
      while (n && n.parentElement !== editor) n = n.parentElement;
      return n && n !== editor ? n : null;
    }
    function blockAction(name) {
      const editor = fxEditor();
      if (!editor) return;
      if (name === 'sup' || name === 'sub') document.execCommand(name === 'sup' ? 'superscript' : 'subscript');
      else if (name.startsWith('align-')) {
        document.execCommand('styleWithCSS', false, true);
        document.execCommand({ 'align-left': 'justifyLeft', 'align-center': 'justifyCenter', 'align-right': 'justifyRight', 'align-full': 'justifyFull' }[name]);
      } else if (name === 'quote') {
        const sel = window.getSelection();
        const n = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
        document.execCommand('formatBlock', false, n && n.closest('blockquote') ? 'p' : 'blockquote');
      } else if (name === 'dropcap') {
        let b = blockOf(editor);
        if (!b || b.nodeType !== 1 || !['P', 'DIV', 'BLOCKQUOTE'].includes(b.tagName)) {
          document.execCommand('formatBlock', false, 'p');
          b = blockOf(editor);
        }
        if (b && b.nodeType === 1) b.classList.toggle('nb-dropcap');
      } else if (name === 'divider') {
        document.execCommand('insertHorizontalRule');
      } else if (name === 'clear') {
        const nodes = selectedTextNodes(editor);
        document.execCommand('removeFormat');
        nodes.forEach((n) => {
          let p = n.parentElement;
          while (p && p !== editor) {
            const next = p.parentElement;
            if (p.tagName === 'SPAN' && (/^nb-fx-/.test(p.className) || p.style.fontSize || p.classList.contains('notebook-spoiler') || p.style.color)) unwrapEl(p);
            p = next;
          }
        });
      }
      capture();
      scheduleSave();
    }
    app.querySelectorAll('[data-fx]').forEach((b) => b.addEventListener('click', () => applyFx(b.dataset.fx)));
    app.querySelectorAll('[data-blk]').forEach((b) => b.addEventListener('click', () => blockAction(b.dataset.blk)));

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
        const pop = $('notebook-color-pop');
        if (pop) pop.classList.toggle('open', colorPopoverOpen);
      });
    }
    app.querySelectorAll('button[data-color]').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        document.execCommand('styleWithCSS', false, true);
        document.execCommand('foreColor', false, btn.dataset.color);
        colorPopoverOpen = false;
        const pop = $('notebook-color-pop');
        if (pop) pop.classList.remove('open');
        capture();
        scheduleSave();
      });
    });

    // imagem: botão 🖼, Ctrl+V (print/copiar imagem) e arrastar um arquivo pra dentro da página -- todos sobem pro mesmo lugar
    const MAX_IMG_BYTES = 10 * 1024 * 1024;
    async function insertImageFile(file, focusFn) {
      if (!file || !/^image\//i.test(file.type || '')) return;
      if (file.size > MAX_IMG_BYTES) {
        imgUploadError = 'imagem grande demais (máximo 10 MB)';
        render();
        return;
      }
      imgUploadError = '';
      try {
        const url = await uploadNotebookImage(characterId, file);
        if (focusFn) focusFn();
        document.execCommand('insertHTML', false, `<img class="notebook-img" src="${url}" style="width:220px">`);
        capture();
        scheduleSave();
        // oferece na hora o acabamento (desenho em papel diferente da página é o caso comum)
        const added = Array.from(app.querySelectorAll('.notebook-page img')).find((im) => im.getAttribute('src') === url);
        if (added) showImageBar(added);
      } catch (err) {
        imgUploadError = 'erro ao enviar imagem: ' + err.message;
        render();
      }
    }
    const imageFilesOf = (dt) => {
      if (!dt) return [];
      const fromFiles = Array.from(dt.files || []).filter((f) => /^image\//i.test(f.type || ''));
      if (fromFiles.length) return fromFiles;
      return Array.from(dt.items || []).filter((it) => it.kind === 'file' && /^image\//i.test(it.type || '')).map((it) => it.getAsFile()).filter(Boolean);
    };

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
        await insertImageFile(file, () => restoreSelectionAndFocus(activeEditorId()));
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
        // colar IMAGEM (print, "copiar imagem"): sobe o arquivo e insere. Se vier junto texto de verdade, vale o texto (copiar de um
        // documento traz html + figura; a figura inline só entra se for http, e o resto segue o caminho normal abaixo)
        const imgs = imageFilesOf(e.clipboardData);
        if (imgs.length && !(e.clipboardData.getData('text/plain') || '').trim()) {
          e.preventDefault();
          (async () => {
            for (const f of imgs) await insertImageFile(f, () => editor.focus());
          })();
          return;
        }
        e.preventDefault();
        let html = e.clipboardData.getData('text/html');
        const text = e.clipboardData.getData('text/plain');
        if (html) {
          // só o que está entre as marcas de fragmento (o resto é a casca <html><body> do copiar do Windows/Word)
          const m = html.match(/<!--\s*StartFragment\s*-->([\s\S]*?)<!--\s*EndFragment\s*-->/i);
          if (m) html = m[1];
        }
        const clean = html ? sanitizeNotebookHtml(html) : escapeHtml(text).replace(/\n/g, '<br>');
        document.execCommand('insertHTML', false, clean);
      });
      // arrastar uma imagem do computador pra dentro da página
      editor.addEventListener('dragover', (e) => {
        if (imageFilesOf(e.dataTransfer).length || Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files')) e.preventDefault();
      });
      editor.addEventListener('drop', (e) => {
        const imgs = imageFilesOf(e.dataTransfer);
        if (!imgs.length) return;
        e.preventDefault();
        (async () => {
          for (const f of imgs) await insertImageFile(f, () => editor.focus());
        })();
      });
      // clique numa imagem: barrinha com os acabamentos (tirar o papel, mesclar, normal)
      editor.addEventListener('click', (e) => {
        if (e.target.tagName !== 'IMG') return;
        const rect = e.target.getBoundingClientRect();
        if (e.clientX > rect.right - 16 && e.clientY > rect.bottom - 16) return; // canto = redimensionar
        showImageBar(e.target);
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
