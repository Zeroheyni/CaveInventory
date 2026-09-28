// Tabuleiro (virtual tabletop) -- Fase 1: CRUD de tabuleiro pelo
// mestre + colocar/mover token de personagem. Sem marcador solto,
// redimensionar ou reordenar camada ainda (Fase 2), sem arrasto ao
// vivo com preview/cursor colorido (Fase 3, via Broadcast) -- por
// ora o arrasto só é local até soltar, e a posição final grava no
// banco (postgres_changes normal, igual combate).
//
// UI em duas telas: a aba abre numa LISTA dos tabuleiros da campanha
// (igual um menu); clicar num deles entra em modo tela cheia de
// verdade (position:fixed cobrindo o viewport inteiro, por cima até
// do cabeçalho do site -- só fica visível a seta do menu lateral,
// que já tem z-index maior que qualquer coisa aqui, e um botãozinho
// "voltar" no canto superior esquerdo). "Tabuleiro ativo"
// (campaigns.active_board_id, escolhido pelo mestre) continua
// existindo como um indicador/lembrete de qual é o principal da
// campanha, mas agora é só INFORMATIVO -- abrir um tabuleiro pra
// olhar/jogar não depende mais dele, qualquer um da lista abre.
import { supabase } from '../supabaseClient.js';
import { escapeHtml } from '../shared/gameData.js';
import {
  listBoards,
  createBoard,
  renameBoard,
  deleteBoard,
  setActiveBoard,
  uploadBoardBackground,
  listBoardTokens,
  createTokenForCharacter,
  updateTokenPosition,
  deleteToken,
  subscribeBoard,
  subscribeCampaignBoards,
} from '../board.js';

let boardsChannel = null;
let tokensChannel = null;

export function renderBoardScreen(app, { session, profile, campaign, characterId, characterName }) {
  const campaignId = campaign.id;
  const isMaster = profile.role === 'master';
  const $ = (id) => app.querySelector('#' + id);

  if (boardsChannel) {
    supabase.removeChannel(boardsChannel);
    boardsChannel = null;
  }
  if (tokensChannel) {
    supabase.removeChannel(tokensChannel);
    tokensChannel = null;
  }

  let boards = [];
  let activeBoardId = null; // só informativo agora, ver comentário acima
  let viewBoardId = null; // null = lista; senão = tabuleiro aberto em tela cheia
  let tokens = [];
  let charactersInCampaign = []; // só carregado pro mestre (picker de "+ token")
  let loading = true;
  let error = '';

  let creatingBoard = false;
  let newBoardName = '';
  let renamingBoardId = null;
  let renameValue = '';
  let addTokenOpen = false;

  // arrasto -- fica FORA do estado re-renderizado (não pode disparar
  // render() a cada pixel movido, senão o innerHTML inteiro seria
  // reconstruído em cada pointermove e o arrasto travaria).
  let dragTokenId = null;
  let dragPointerId = null;
  let dragStartClientX = 0;
  let dragStartClientY = 0;
  let dragStartXPct = 0;
  let dragStartYPct = 0;
  let dragBoardRect = null;
  let dragEl = null;

  async function load() {
    loading = true;
    render();
    try {
      const [boardList, { data: campRow }] = await Promise.all([
        listBoards(campaignId),
        supabase.from('campaigns').select('active_board_id').eq('id', campaignId).maybeSingle(),
      ]);
      boards = boardList;
      activeBoardId = campRow?.active_board_id || null;
      // se o tabuleiro que eu tinha aberto sumiu (apagado por outro
      // cliente), volta sozinho pra lista em vez de ficar preso numa
      // tela cheia órfã.
      if (viewBoardId && !boards.some((b) => b.id === viewBoardId)) closeBoard();
      if (isMaster) {
        const { data: chars } = await supabase
          .from('characters')
          .select('id, name, avatar_url, is_npc')
          .eq('campaign_id', campaignId)
          .order('name');
        charactersInCampaign = chars || [];
      }
      error = '';
    } catch (err) {
      error = err.message;
    }
    loading = false;
    render();
  }

  // ---- entrar/sair do modo tela cheia ----
  async function openBoard(boardId) {
    viewBoardId = boardId;
    addTokenOpen = false;
    tokens = [];
    render();
    try {
      tokens = await listBoardTokens(boardId);
      error = '';
    } catch (err) {
      error = err.message;
    }
    render();
    resubscribeTokens();
  }

  function closeBoard() {
    viewBoardId = null;
    tokens = [];
    if (tokensChannel) {
      supabase.removeChannel(tokensChannel);
      tokensChannel = null;
    }
    lastSubscribedBoardId = undefined;
    render();
  }

  // reassina o canal de tokens toda vez que o tabuleiro aberto muda --
  // o topic carrega o boardId (mesmo padrão de subscribeBoard), então
  // trocar de tabuleiro sem resubscrever deixaria a tela ouvindo o
  // tabuleiro ERRADO.
  let lastSubscribedBoardId = undefined;
  function resubscribeTokens() {
    if (viewBoardId === lastSubscribedBoardId) return;
    lastSubscribedBoardId = viewBoardId;
    if (tokensChannel) {
      supabase.removeChannel(tokensChannel);
      tokensChannel = null;
    }
    if (!viewBoardId) return;
    tokensChannel = subscribeBoard(viewBoardId, () => {
      clearTimeout(tokensReloadTimer);
      tokensReloadTimer = setTimeout(reloadTokens, 400);
    });
  }

  let tokensReloadTimer = null;
  async function reloadTokens() {
    if (!viewBoardId) return;
    try {
      const fresh = await listBoardTokens(viewBoardId);
      // preserva a posição local otimista do token que ESTOU arrastando
      // agora -- sem isso, um evento de realtime alheio (outro jogador
      // mexendo em outro token) chegando no meio do meu arrasto faria a
      // tela "puxar" meu token de volta pra posição antiga do banco.
      if (dragTokenId) {
        const mine = fresh.find((t) => t.id === dragTokenId);
        const prevLocal = tokens.find((t) => t.id === dragTokenId);
        if (mine && prevLocal) {
          mine.x = prevLocal.x;
          mine.y = prevLocal.y;
        }
      }
      tokens = fresh;
      render();
    } catch (err) {
      // realtime reload falhando não deveria travar a tela -- só ignora,
      // a próxima mudança tenta de novo.
    }
  }

  function subscribeBoardsRealtime() {
    boardsChannel = subscribeCampaignBoards(campaignId, () => {
      clearTimeout(boardsReloadTimer);
      boardsReloadTimer = setTimeout(load, 400);
    });
  }
  let boardsReloadTimer = null;

  // ---- ações de gerência (mestre) ----
  async function handleCreateBoard() {
    const name = newBoardName.trim() || 'Tabuleiro';
    creatingBoard = false;
    newBoardName = '';
    try {
      const board = await createBoard(campaignId, name);
      // primeiro tabuleiro da campanha já marca sozinho como "ativo" --
      // senão o mestre criava e ainda precisava lembrar de marcar.
      if (!activeBoardId) await setActiveBoard(campaignId, board.id);
      await load();
    } catch (err) {
      error = err.message;
      render();
    }
  }

  async function handleActivate(boardId) {
    try {
      await setActiveBoard(campaignId, boardId);
    } catch (err) {
      error = err.message;
      render();
    }
  }

  async function handleRenameConfirm(boardId) {
    const name = renameValue.trim();
    renamingBoardId = null;
    if (!name) return render();
    try {
      await renameBoard(boardId, name);
      await load();
    } catch (err) {
      error = err.message;
      render();
    }
  }

  async function handleDeleteBoard(boardId) {
    try {
      await deleteBoard(boardId);
      if (viewBoardId === boardId) closeBoard();
      await load();
    } catch (err) {
      error = err.message;
      render();
    }
  }

  async function handleUploadBackground(boardId, file) {
    try {
      await uploadBoardBackground(boardId, file);
      await load();
    } catch (err) {
      error = err.message;
      render();
    }
  }

  async function handleAddToken(charId) {
    addTokenOpen = false;
    try {
      const token = await createTokenForCharacter(viewBoardId, campaignId, charId, { x: 50, y: 50 });
      tokens = [...tokens, token];
      render();
    } catch (err) {
      error = err.message;
      render();
    }
  }

  async function handleDeleteToken(tokenId) {
    try {
      await deleteToken(tokenId);
      tokens = tokens.filter((t) => t.id !== tokenId);
      render();
    } catch (err) {
      error = err.message;
      render();
    }
  }

  // ---- arrasto de token (pointer events, ver avatarEditor.js) ----
  function canMoveToken(t) {
    return isMaster || (t.character_id && t.character_id === characterId);
  }

  function onTokenPointerDown(e) {
    const el = e.currentTarget;
    const tokenId = el.dataset.tokenId;
    const token = tokens.find((t) => t.id === tokenId);
    if (!token || !canMoveToken(token)) return;
    const boardArea = $('board-area');
    if (!boardArea) return;
    e.preventDefault();
    dragTokenId = tokenId;
    dragPointerId = e.pointerId;
    dragEl = el;
    dragStartClientX = e.clientX;
    dragStartClientY = e.clientY;
    dragStartXPct = token.x;
    dragStartYPct = token.y;
    dragBoardRect = boardArea.getBoundingClientRect();
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
  }

  function onTokenPointerMove(e) {
    if (!dragTokenId || e.pointerId !== dragPointerId || !dragEl || !dragBoardRect) return;
    const deltaXPct = ((e.clientX - dragStartClientX) / dragBoardRect.width) * 100;
    const deltaYPct = ((e.clientY - dragStartClientY) / dragBoardRect.height) * 100;
    const x = Math.max(0, Math.min(100, dragStartXPct + deltaXPct));
    const y = Math.max(0, Math.min(100, dragStartYPct + deltaYPct));
    dragEl.style.left = x + '%';
    dragEl.style.top = y + '%';
    const token = tokens.find((t) => t.id === dragTokenId);
    if (token) {
      token.x = x;
      token.y = y;
    }
  }

  async function onTokenPointerUp(e) {
    if (!dragTokenId || e.pointerId !== dragPointerId) return;
    const tokenId = dragTokenId;
    const token = tokens.find((t) => t.id === tokenId);
    if (dragEl) dragEl.classList.remove('dragging');
    dragTokenId = null;
    dragPointerId = null;
    dragEl = null;
    dragBoardRect = null;
    if (token) {
      try {
        await updateTokenPosition(tokenId, token.x, token.y);
      } catch (err) {
        error = err.message;
        render();
      }
    }
  }

  // ---- render ----
  function avatarOrLetter(t) {
    if (t.image_url) return `<img src="${escapeHtml(t.image_url)}" alt="">`;
    const letter = (t.label || '?').trim().charAt(0).toUpperCase();
    return `<span class="board-token-placeholder">${escapeHtml(letter)}</span>`;
  }

  function tokenHtml(t) {
    // remover token segue a MESMA permissão de mover ele (dono do
    // personagem vinculado ou mestre) -- ver db/055.
    const movable = canMoveToken(t);
    const shapeClass = t.shape === 'square' ? 'square' : 'circle';
    return `
      <div class="board-token ${shapeClass} ${movable ? 'movable' : ''}" data-token-id="${t.id}"
        style="left:${t.x}%; top:${t.y}%; width:${t.size}%; border-color:${escapeHtml(t.border_color)}; z-index:${t.z_index};"
        title="${escapeHtml(t.label || '?')}">
        ${avatarOrLetter(t)}
        ${movable ? `<button type="button" class="board-token-del" data-token-del="${t.id}" title="tirar do tabuleiro">×</button>` : ''}
      </div>`;
  }

  // ---- tela 1: lista de tabuleiros ----
  function boardListItemHtml(b) {
    const active = b.id === activeBoardId;
    const renaming = renamingBoardId === b.id;
    return `
      <div class="board-list-item ${active ? 'active' : ''}" data-board-open="${b.id}">
        <div class="board-list-thumb" style="${b.background_image_url ? `background-image:url('${escapeHtml(b.background_image_url)}');` : ''}">
          ${!b.background_image_url ? '🗺' : ''}
        </div>
        <div class="board-list-info" ${renaming ? 'data-stop-open' : ''}>
          ${
            renaming
              ? `<input type="text" class="board-row-rename-input" id="board-rename-input" value="${escapeHtml(renameValue)}">
                 <div class="board-list-rename-actions">
                   <button type="button" class="btn" data-board-rename-confirm="${b.id}">salvar</button>
                   <button type="button" class="btn btn-ghost" data-board-rename-cancel="1">cancelar</button>
                 </div>`
              : `<div class="board-list-name">${escapeHtml(b.name)}${active ? '<span class="board-active-badge" title="tabuleiro ativo da campanha">● ativo</span>' : ''}</div>
                 <div class="board-list-hint">clique para abrir</div>`
          }
        </div>
        ${
          isMaster && !renaming
            ? `<div class="board-list-actions" data-stop-open>
                 <button type="button" class="board-row-icon-btn" data-board-activate="${b.id}" title="${active ? 'tabuleiro ativo' : 'marcar como ativo'}">${active ? '★' : '☆'}</button>
                 <button type="button" class="board-row-icon-btn" data-board-rename="${b.id}" title="renomear">✎</button>
                 <label class="board-row-icon-btn" title="trocar imagem de fundo">🖼<input type="file" accept="image/*" data-board-bg="${b.id}" style="display:none;"></label>
                 <button type="button" class="admin-danger-btn" data-board-delete="${b.id}">apagar</button>
               </div>`
            : ''
        }
      </div>`;
  }

  function renderList() {
    app.innerHTML = `
      <div class="board-list-screen">
        ${error ? `<div class="board-error">${escapeHtml(error)}</div>` : ''}
        ${
          isMaster
            ? `<div class="board-list-head">
                 <b>Tabuleiros da campanha</b>
                 <button type="button" class="btn" id="board-new-btn">+ novo tabuleiro</button>
               </div>
               ${
                 creatingBoard
                   ? `<div class="board-new-form">
                        <input type="text" id="board-new-name" placeholder="nome do tabuleiro" value="${escapeHtml(newBoardName)}">
                        <button type="button" class="btn" id="board-new-confirm">criar</button>
                        <button type="button" class="btn btn-ghost" id="board-new-cancel">cancelar</button>
                      </div>`
                   : ''
               }`
            : `<div class="board-list-head"><b>Tabuleiros da campanha</b></div>`
        }
        <div class="board-list">
          ${boards.map(boardListItemHtml).join('') || `<div class="admin-empty">${isMaster ? 'nenhum tabuleiro ainda -- crie um acima.' : 'o mestre ainda não criou nenhum tabuleiro.'}</div>`}
        </div>
      </div>`;
    wireListEvents();
  }

  function addTokenPickerHtml() {
    if (!isMaster || !addTokenOpen) return '';
    const placedIds = new Set(tokens.map((t) => t.character_id).filter(Boolean));
    const available = charactersInCampaign.filter((c) => !placedIds.has(c.id));
    return `
      <div class="board-add-token-picker">
        <div class="board-add-token-head">escolha um personagem <button type="button" class="board-add-token-close" id="board-add-token-close">×</button></div>
        ${
          available.length
            ? available
                .map(
                  (c) => `
          <button type="button" class="board-add-token-option" data-add-token-char="${c.id}">
            ${c.avatar_url ? `<img src="${escapeHtml(c.avatar_url)}" alt="">` : `<span class="board-token-placeholder">${escapeHtml((c.name || '?').charAt(0).toUpperCase())}</span>`}
            ${escapeHtml(c.name)}${c.is_npc ? ' <small>(NPC)</small>' : ''}
          </button>`
                )
                .join('')
            : '<div class="admin-empty">todo mundo já tem token neste tabuleiro</div>'
        }
      </div>`;
  }

  // ---- tela 2: tabuleiro em tela cheia ----
  function renderFullscreen() {
    const board = boards.find((b) => b.id === viewBoardId);
    const bg = board && board.background_image_url;
    app.innerHTML = `
      <div class="board-fullscreen">
        <button type="button" class="board-back-btn" id="board-back-btn" title="sair do tabuleiro">←</button>
        ${error ? `<div class="board-error board-fullscreen-error">${escapeHtml(error)}</div>` : ''}
        <div class="board-area" id="board-area" style="${bg ? `background-image:url('${escapeHtml(bg)}');` : ''}">
          ${tokens.map(tokenHtml).join('')}
          ${isMaster ? `<button type="button" class="board-add-token-fab" id="board-add-token-fab" title="adicionar token de personagem">+ token</button>` : ''}
          ${addTokenPickerHtml()}
        </div>
      </div>`;
    wireFullscreenEvents();
  }

  function render() {
    if (loading && !boards.length) {
      app.innerHTML = `<div class="admin-empty" style="padding:24px 0;">carregando tabuleiro…</div>`;
      return;
    }
    if (viewBoardId) {
      renderFullscreen();
    } else {
      renderList();
    }
  }

  function wireListEvents() {
    const newBtn = $('board-new-btn');
    if (newBtn) newBtn.addEventListener('click', () => { creatingBoard = true; newBoardName = ''; render(); $('board-new-name')?.focus(); });

    const newNameInput = $('board-new-name');
    if (newNameInput) {
      newNameInput.addEventListener('input', (e) => { newBoardName = e.target.value; });
      newNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleCreateBoard(); });
    }
    const newConfirm = $('board-new-confirm');
    if (newConfirm) newConfirm.addEventListener('click', handleCreateBoard);
    const newCancel = $('board-new-cancel');
    if (newCancel) newCancel.addEventListener('click', () => { creatingBoard = false; render(); });

    const renameInput = $('board-rename-input');
    if (renameInput) {
      renameInput.addEventListener('input', (e) => { renameValue = e.target.value; });
      renameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleRenameConfirm(renamingBoardId); });
      renameInput.focus();
      renameInput.setSelectionRange(renameInput.value.length, renameInput.value.length);
    }

    app.querySelectorAll('[data-board-activate]').forEach((btn) => {
      btn.addEventListener('click', () => handleActivate(btn.dataset.boardActivate));
    });
    app.querySelectorAll('[data-board-rename]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const board = boards.find((b) => b.id === btn.dataset.boardRename);
        renamingBoardId = btn.dataset.boardRename;
        renameValue = board ? board.name : '';
        render();
      });
    });
    app.querySelectorAll('[data-board-rename-confirm]').forEach((btn) => {
      btn.addEventListener('click', () => handleRenameConfirm(btn.dataset.boardRenameConfirm));
    });
    app.querySelectorAll('[data-board-rename-cancel]').forEach((btn) => {
      btn.addEventListener('click', () => { renamingBoardId = null; render(); });
    });
    app.querySelectorAll('[data-board-delete]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.confirm !== '1') {
          btn.dataset.confirm = '1';
          btn.textContent = 'confirmar?';
          btn.classList.add('confirm-pending');
          setTimeout(() => { btn.dataset.confirm = ''; btn.textContent = 'apagar'; btn.classList.remove('confirm-pending'); }, 3000);
          return;
        }
        handleDeleteBoard(btn.dataset.boardDelete);
      });
    });
    app.querySelectorAll('[data-board-bg]').forEach((input) => {
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (file) handleUploadBackground(input.dataset.boardBg, file);
        input.value = '';
      });
    });

    // clique no cartão do tabuleiro abre ele em tela cheia -- exceto
    // clique em qualquer coisa marcada com data-stop-open (os botões
    // de gerência do mestre, que já têm a própria ação).
    app.querySelectorAll('[data-board-open]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-stop-open]')) return;
        openBoard(row.dataset.boardOpen);
      });
    });
  }

  function wireFullscreenEvents() {
    const backBtn = $('board-back-btn');
    if (backBtn) backBtn.addEventListener('click', closeBoard);

    const addTokenFab = $('board-add-token-fab');
    if (addTokenFab) addTokenFab.addEventListener('click', () => { addTokenOpen = !addTokenOpen; render(); });
    const addTokenClose = $('board-add-token-close');
    if (addTokenClose) addTokenClose.addEventListener('click', () => { addTokenOpen = false; render(); });
    app.querySelectorAll('[data-add-token-char]').forEach((btn) => {
      btn.addEventListener('click', () => handleAddToken(btn.dataset.addTokenChar));
    });

    app.querySelectorAll('[data-token-del]').forEach((btn) => {
      // impede o pointerdown de borbulhar até o listener de arrasto do
      // token (pai) -- sem isso, clicar no × também disparava
      // setPointerCapture/início de arrasto no token por baixo antes do
      // clique de remover ser processado.
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleDeleteToken(btn.dataset.tokenDel);
      });
    });
    app.querySelectorAll('.board-token').forEach((el) => {
      el.addEventListener('pointerdown', onTokenPointerDown);
      el.addEventListener('pointermove', onTokenPointerMove);
      el.addEventListener('pointerup', onTokenPointerUp);
      el.addEventListener('pointercancel', onTokenPointerUp);
    });
  }

  load();
  subscribeBoardsRealtime();
}
