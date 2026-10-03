// Tabuleiro (virtual tabletop) -- Fases 1 a 3: CRUD de tabuleiro pelo
// mestre, colocar/mover token de personagem OU marcador solto (sem
// ficha), redimensionar via alça de arrasto no canto, cor da borda/
// formato editáveis e camada (z-index, só frente/trás -- não é uma
// lista de grupos nomeados, ver decisão original), MAIS (Fase 3) o
// arrasto/redimensionar aparecem em tempo real pros outros enquanto
// ainda tá em andamento (não só depois de soltar) e um cursor colorido
// mostra onde o mouse de cada um está -- tudo via Realtime Broadcast,
// efêmero, nunca gravado no banco (a posição/tamanho FINAIS continuam
// gravando normal, uma vez, no soltar -- postgres_changes de sempre,
// igual combate).
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
  createFreeformToken,
  uploadTokenImage,
  updateTokenPosition,
  updateTokenAppearance,
  deleteToken,
  subscribeBoard,
  subscribeCampaignBoards,
  broadcastCursor,
  broadcastDrag,
  readImageSize,
  updateBoardDims,
  listBoardWalls,
  insertWalls,
  deleteWalls,
  updateWalls,
  updateBoardSettings,
  listBoardLights,
  insertLight,
  updateLight,
  deleteLight,
  updateMyLight,
} from '../board.js';
import { renderBoardHud, mountDrawer } from './boardHud.js';
import { blockingWalls, resolveMove, toWorld, toPct } from '../boardGeometry.js';
import { wallsLayerHtml, createWallEditor } from '../boardWalls.js';
import { mountSceneryPanel } from '../boardScenery.js';
import { createLighting, LIGHT_PRESETS } from '../boardLighting.js';

// throttle do que é mandado por Broadcast (Fase 3) -- cursor e preview
// de arrasto/redimensionar não precisam (nem devem) mandar uma
// mensagem por pointermove bruto (60-120Hz do navegador); um teto de
// ~16/s já fica visualmente suave e não afoga o canal.
const LIVE_THROTTLE_MS = 60;
// quanto tempo sem notícia de um cursor remoto até considerar que a
// pessoa saiu/fechou a aba sem mandar o "leave" (ex: queda de rede) --
// não dá pra confiar só no evento de saída.
const CURSOR_STALE_MS = 8000;

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
  let addTokenTab = 'character'; // 'character' | 'freeform' (Fase 2)
  let freeformName = '';
  let freeformImageFile = null; // File escolhido, só sobe no upload quando confirma criar
  let editTokenId = null; // token com o popover de aparência aberto (mestre)

  // arrasto de MOVER -- fica FORA do estado re-renderizado (não pode
  // disparar render() a cada pixel movido, senão o innerHTML inteiro
  // seria reconstruído em cada pointermove e o arrasto travaria).
  let dragTokenId = null;
  let dragPointerId = null;
  let dragStartClientX = 0;
  let dragStartClientY = 0;
  let dragStartXPct = 0;
  let dragStartYPct = 0;
  let dragBoardRect = null;
  let dragEl = null;

  // arrasto de REDIMENSIONAR (Fase 2) -- alça no canto do token,
  // mesma lógica do arrasto de mover só que mexendo em `size` em vez
  // de x/y.
  let resizeTokenId = null;
  let resizePointerId = null;
  let resizeStartClientX = 0;
  let resizeStartSize = 0;
  let resizeBoardRect = null;
  let resizeEl = null;

  // ---- PAREDES (db/060): desenhadas pelo mestre, bloqueiam o arrasto dos
  // tokens (e, na Fase 2, a luz). Dados em % do palco, igual aos tokens.
  // O editor (boardWalls.js) e o painel (boardScenery.js) só falam com o
  // banco por aqui. ----
  const WALL_TOOL_DEFS = {
    parede: { mode: 'line', kind: 'parede' },
    retangulo: { mode: 'rect', kind: 'parede' },
    porta: { mode: 'line', kind: 'porta' },
    janela: { mode: 'line', kind: 'janela' },
    invisivel: { mode: 'line', kind: 'invisivel' },
    editar: { mode: 'edit' },
    apagar: { mode: 'erase' },
  };
  let walls = [];
  let wallTool = null; // chave de WALL_TOOL_DEFS; null = "mover" (arrasta tokens/mapa normalmente)
  let selectedWallId = null;
  let wallGrid = 0; // passo da grade de encaixe em % (0 = sem)
  let wallsVersion = 0; // sobe a cada mudança -- invalida o cache de colisão
  let moveWallsCache = { version: -1, aspect: 0, list: [] };
  let wallsReloadTimer = null;
  let sceneryPanel = null;
  let dragLastX = 0; // última posição VÁLIDA do token arrastado (colisão varre desse ponto até o ponteiro)
  let dragLastY = 0;

  const wallHost = {
    stage: () => $('board-stage'),
    aspect: () => stageAspect(),
    walls: () => walls,
    tool: () => (wallTool ? WALL_TOOL_DEFS[wallTool] || null : null),
    grid: () => wallGrid,
    async add(rows) {
      try {
        const created = await insertWalls(viewBoardId, campaignId, rows);
        walls = walls.concat(created);
        wallsChanged();
        return created;
      } catch (err) {
        error = err.message;
        render();
        throw err;
      }
    },
    async remove(ids) {
      walls = walls.filter((w) => !ids.includes(w.id));
      if (ids.includes(selectedWallId)) selectedWallId = null;
      wallsChanged();
      try {
        await deleteWalls(ids);
      } catch (err) {
        error = err.message;
        reloadWalls();
        throw err;
      }
    },
    async update(updates) {
      updates.forEach((u) => {
        const w = walls.find((x) => x.id === u.id);
        if (w) Object.assign(w, u.fields);
      });
      wallsChanged();
      try {
        await updateWalls(updates);
      } catch (err) {
        error = err.message;
        reloadWalls();
        throw err;
      }
    },
    select(id) {
      selectedWallId = id;
    },
    selected: () => selectedWallId,
    redraw: () => wallsChanged(),
    changed: () => refreshScenery(),
  };
  const wallEditor = createWallEditor(wallHost);

  // ---- ILUMINAÇÃO (db/060): luz presa a token ou fixa no cenário; o canvas
  // de escuridão/brilho vive em boardLighting.js (polígono de visibilidade
  // contra as paredes, por isso a luz não atravessa parede) ----
  let lights = [];
  let sceneryTab = 'paredes';
  let viewAsPlayer = false; // mestre "vê como jogador" (testar a escuridão)
  let editLightId = null; // luz com o editor aberto no painel
  let lightsReloadTimer = null;
  const lighting = createLighting({
    stage: () => $('board-stage'),
    board: () => currentBoard(),
    aspect: () => stageAspect(),
    walls: () => walls,
    wallsVersion: () => wallsVersion,
    tokens: () => tokens,
    lights: () => lights,
    isMaster: () => isMaster,
    viewAsPlayer: () => viewAsPlayer,
    characterId: () => characterId,
  });

  const LIGHT_FIELDS = ['kind', 'radius', 'dim_radius', 'color', 'angle', 'flicker', 'pulse', 'intensity'];
  const presetFields = (kind) => {
    const p = LIGHT_PRESETS[kind] || LIGHT_PRESETS.custom;
    const out = { kind: LIGHT_PRESETS[kind] ? kind : 'custom' };
    LIGHT_FIELDS.forEach((k) => {
      if (k !== 'kind') out[k] = p[k];
    });
    return out;
  };
  const lightOfToken = (tokenId) => lights.find((l) => l.token_id === tokenId) || null;
  const canToggleLight = (l) => {
    if (isMaster) return true;
    const t = l.token_id && tokens.find((x) => x.id === l.token_id);
    return !!(t && t.character_id && t.character_id === characterId);
  };

  async function reloadLights() {
    if (!viewBoardId) return;
    try {
      lights = await listBoardLights(viewBoardId);
    } catch (_) {
      // sem a tabela (migration não aplicada) ou rede: segue sem luzes
    }
    lightsChanged(true);
  }
  // luz mudou (ou token que carrega): redesenha escuridão, marcadores e painel
  function lightsChanged(fullMarkers = false) {
    lighting.update();
    if (fullMarkers) renderLightMarkers();
    refreshScenery();
  }

  function fixedLightMarkersHtml() {
    if (!isMaster) return '';
    return lights
      .filter((l) => !l.token_id)
      .map((l) => {
        const p = LIGHT_PRESETS[l.kind] || LIGHT_PRESETS.custom;
        return `<div class="board-light-marker ${l.enabled ? 'on' : 'off'}" data-light-marker="${l.id}" style="left:${l.x}%; top:${l.y}%; border-color:${escapeHtml(l.color)};" title="${escapeHtml(p.label)} (arraste pra mover)">${p.icon}</div>`;
      })
      .join('');
  }
  function renderLightMarkers() {
    const layer = $('board-light-markers');
    if (!layer) return;
    layer.innerHTML = fixedLightMarkersHtml();
    wireLightMarkers();
  }

  // arrasto de uma luz fixa (só mestre)
  let markerDrag = null;
  function wireLightMarkers() {
    app.querySelectorAll('[data-light-marker]').forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const stageEl = $('board-stage');
        if (!stageEl) return;
        try {
          el.setPointerCapture(e.pointerId);
        } catch (_) {
          // sem captura, segue
        }
        markerDrag = { id: el.dataset.lightMarker, el, pointerId: e.pointerId, rect: stageEl.getBoundingClientRect(), moved: false };
      });
      el.addEventListener('pointermove', (e) => {
        if (!markerDrag || e.pointerId !== markerDrag.pointerId) return;
        const x = Math.max(0, Math.min(100, ((e.clientX - markerDrag.rect.left) / markerDrag.rect.width) * 100));
        const y = Math.max(0, Math.min(100, ((e.clientY - markerDrag.rect.top) / markerDrag.rect.height) * 100));
        const l = lights.find((q) => q.id === markerDrag.id);
        if (!l) return;
        l.x = x;
        l.y = y;
        markerDrag.moved = true;
        markerDrag.el.style.left = x + '%';
        markerDrag.el.style.top = y + '%';
        lighting.update();
      });
      const end = async (e) => {
        if (!markerDrag || e.pointerId !== markerDrag.pointerId) return;
        const d = markerDrag;
        markerDrag = null;
        const l = lights.find((q) => q.id === d.id);
        if (l && d.moved) {
          try {
            await updateLight(l.id, { x: l.x, y: l.y });
          } catch (err) {
            error = err.message;
            render();
          }
        } else if (l && !d.moved) {
          editLightId = l.id;
          sceneryTab = 'luzes';
          refreshScenery();
        }
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    });
  }

  // liga/desliga uma luz (mestre em qualquer uma; jogador só na própria, via RPC)
  async function toggleLight(id) {
    const l = lights.find((x) => x.id === id);
    if (!l || !canToggleLight(l)) return;
    const next = !l.enabled;
    l.enabled = next;
    lightsChanged(true);
    refreshTokenLightButtons();
    try {
      if (isMaster) await updateLight(id, { enabled: next });
      else await updateMyLight(id, { enabled: next });
    } catch (err) {
      l.enabled = !next;
      error = err.message;
      render();
    }
  }
  function refreshTokenLightButtons() {
    app.querySelectorAll('[data-token-light]').forEach((btn) => {
      const l = lightOfToken(btn.dataset.tokenLight);
      btn.classList.toggle('on', !!(l && l.enabled));
    });
  }

  // preset de luz num token (mestre): cria, troca o tipo ou remove ('' = sem luz)
  async function setTokenLight(tokenId, kind) {
    const existing = lightOfToken(tokenId);
    try {
      if (!kind) {
        if (existing) {
          lights = lights.filter((l) => l.id !== existing.id);
          lightsChanged(true);
          await deleteLight(existing.id);
        }
      } else if (existing) {
        const fields = presetFields(kind);
        Object.assign(existing, fields);
        lightsChanged(true);
        await updateLight(existing.id, fields);
      } else {
        const created = await insertLight(viewBoardId, campaignId, { token_id: tokenId, enabled: true, ...presetFields(kind) });
        lights = lights.concat(created);
        lightsChanged(true);
      }
    } catch (err) {
      error = err.message;
    }
    render();
  }

  async function addFixedLight(kind) {
    try {
      const created = await insertLight(viewBoardId, campaignId, { x: 50, y: 50, enabled: true, ...presetFields(kind) });
      lights = lights.concat(created);
      editLightId = created.id;
      lightsChanged(true);
    } catch (err) {
      error = err.message;
      render();
    }
  }

  // sliders do editor: 'input' só mexe local e redesenha (sem refazer o painel,
  // senão o slider some do dedo); 'change' grava
  function liveLightField(id, fields) {
    const l = lights.find((x) => x.id === id);
    if (!l) return;
    Object.assign(l, fields);
    lighting.update();
  }
  async function saveLightFields(id, fields) {
    const l = lights.find((x) => x.id === id);
    if (!l) return;
    Object.assign(l, fields);
    lightsChanged(true);
    try {
      await updateLight(id, fields);
    } catch (err) {
      error = err.message;
      render();
    }
  }
  async function removeLight(id) {
    const l = lights.find((x) => x.id === id);
    if (!l) return;
    lights = lights.filter((x) => x.id !== id);
    if (editLightId === id) editLightId = null;
    lightsChanged(true);
    render();
    try {
      await deleteLight(id);
    } catch (err) {
      error = err.message;
      reloadLights();
    }
  }

  // a lanterna lembra pra onde apontava (o mestre grava direto; o dono, via RPC)
  async function persistFacing(token) {
    const l = lightOfToken(token.id);
    if (!l || l.angle >= 359.5) return;
    const ang = lighting.getFacing(token.id);
    if (ang === null || ang === undefined) return;
    const deg = Math.round((((ang * 180) / Math.PI) % 360 + 360) % 360);
    if (l.direction !== null && l.direction !== undefined && Math.abs(l.direction - deg) < 4) return;
    l.direction = deg;
    try {
      if (isMaster) await updateLight(l.id, { direction: deg });
      else await updateMyLight(l.id, { direction: deg });
    } catch (_) {
      // direção é só conforto -- ignora erro
    }
  }

  function showWallsLayer() {
    const b = currentBoard();
    return isMaster || !!(b && b.show_walls_to_players);
  }

  // redesenha só a camada de paredes (sem render() geral)
  function wallsChanged() {
    wallsVersion += 1;
    lighting.update();
    const layer = $('board-walls-layer');
    if (layer) {
      layer.innerHTML = showWallsLayer()
        ? wallsLayerHtml(visibleWalls(), { selectedId: selectedWallId, editing: wallTool === 'editar', doorButtons: isMaster })
        : '';
      wireDoorButtons();
    }
    refreshScenery();
  }
  // jogador só vê parede "de verdade" (a invisível some, ela só bloqueia)
  function visibleWalls() {
    return isMaster ? walls : walls.filter((w) => w.kind !== 'invisivel');
  }

  function moveWallsFor(aspect) {
    if (moveWallsCache.version !== wallsVersion || moveWallsCache.aspect !== aspect) {
      moveWallsCache = { version: wallsVersion, aspect, list: blockingWalls(walls, 'move', aspect) };
    }
    return moveWallsCache.list;
  }

  // posição final do token arrastado depois da colisão ("parar e deslizar").
  // Vale só no cliente (modelo de confiança de mesa de amigos): o mestre
  // ignora segurando Shift e o tabuleiro tem um interruptor de colisão.
  function resolveTokenMove(token, tx, ty, ignore) {
    const b = currentBoard();
    const free = () => {
      dragLastX = tx;
      dragLastY = ty;
      return { x: tx, y: ty };
    };
    if (ignore || !b || !b.collision_enabled || !walls.length) return free();
    const aspect = stageAspect();
    const list = moveWallsFor(aspect);
    if (!list.length) return free();
    const r = ((token.size / 100) * aspect) / 2;
    const res = resolveMove(toWorld(dragLastX, dragLastY, aspect), toWorld(tx, ty, aspect), r, list);
    const p = toPct(res.x, res.y, aspect);
    dragLastX = Math.max(0, Math.min(100, p.x));
    dragLastY = Math.max(0, Math.min(100, p.y));
    return { x: dragLastX, y: dragLastY };
  }

  async function reloadWalls() {
    if (!viewBoardId) return;
    try {
      walls = await listBoardWalls(viewBoardId);
    } catch (_) {
      // sem a tabela (migration não aplicada) ou rede: tabuleiro segue sem paredes
    }
    wallsChanged();
  }

  async function toggleDoor(id) {
    const w = walls.find((x) => x.id === id);
    if (!w) return;
    try {
      await wallHost.update([{ id, fields: { door_open: !w.door_open } }]);
    } catch (_) {
      // erro já exibido
    }
  }
  function wireDoorButtons() {
    app.querySelectorAll('[data-door-toggle]').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDoor(btn.dataset.doorToggle);
      });
    });
  }

  // o elemento que captura o ponteiro enquanto uma ferramenta de parede está ativa
  function syncWallCapture() {
    const stage = $('board-stage');
    if (!stage) return;
    const existing = $('board-wall-capture');
    const want = isMaster && wallTool && WALL_TOOL_DEFS[wallTool];
    if (!want) {
      if (existing) existing.remove();
      wallEditor.detach();
      return;
    }
    let cap = existing;
    if (!cap) {
      cap = document.createElement('div');
      cap.className = 'board-wall-capture';
      cap.id = 'board-wall-capture';
      stage.appendChild(cap);
    }
    cap.dataset.tool = wallTool;
    wallEditor.attach(cap);
  }

  // ---- painel Cenário (drawer do mestre) ----
  function refreshScenery() {
    if (sceneryPanel) sceneryPanel.refresh();
  }
  function setWallTool(key) {
    wallTool = key && key !== 'mover' && WALL_TOOL_DEFS[key] ? key : null;
    wallEditor.reset();
    if (wallTool !== 'editar') selectedWallId = null;
    const area = $('board-area');
    if (area) area.classList.toggle('walls-editing', !!wallTool);
    syncWallCapture();
    wallsChanged();
  }
  async function patchBoard(fields) {
    const b = currentBoard();
    if (!b) return;
    Object.assign(b, fields);
    try {
      await updateBoardSettings(b.id, fields);
    } catch (err) {
      error = err.message;
    }
    render();
    refreshScenery();
  }
  const sceneryApi = {
    state() {
      const b = currentBoard() || {};
      return {
        tab: sceneryTab,
        ...lightingState(),
        tool: wallTool || 'mover',
        collision: b.collision_enabled !== false,
        showWalls: !!b.show_walls_to_players,
        grid: wallGrid,
        wallCount: walls.length,
        selected: walls.find((w) => w.id === selectedWallId) || null,
        canUndo: wallEditor.canUndo(),
        canRedo: wallEditor.canRedo(),
      };
    },
    setTool: setWallTool,
    setCollision: (v) => patchBoard({ collision_enabled: !!v }),
    setShowWalls: (v) => patchBoard({ show_walls_to_players: !!v }),
    setGrid(n) {
      wallGrid = Number(n) || 0;
      refreshScenery();
    },
    undo: () => wallEditor.undo(),
    redo: () => wallEditor.redo(),
    selectedKind(kind) {
      const w = walls.find((x) => x.id === selectedWallId);
      if (!w) return;
      const d = wallEditor.defaults(kind);
      wallEditor.updateWalls([
        { id: w.id, before: { kind: w.kind, blocks_move: w.blocks_move, blocks_light: w.blocks_light }, after: { kind, blocks_move: d.blocks_move, blocks_light: d.blocks_light } },
      ]);
    },
    selectedFlag(flag, value) {
      const w = walls.find((x) => x.id === selectedWallId);
      if (!w) return;
      wallEditor.updateWalls([{ id: w.id, before: { [flag]: w[flag] }, after: { [flag]: !!value } }]);
    },
    deleteSelected() {
      if (selectedWallId) wallEditor.removeWalls([selectedWallId]);
    },
    clearAll() {
      wallEditor.removeWalls(walls.map((w) => w.id));
    },
  };

  // estado do painel de luz/ambiente + ações (mescladas no sceneryApi)
  function lightingState() {
    const b = currentBoard() || {};
    return {
      lighting: !!b.lighting_enabled,
      ambient: b.ambient ?? 0.92,
      fogMode: b.fog_mode || 'escuro',
      ambientColor: b.ambient_color || '#05060d',
      viewAsPlayer,
      editLightId,
      lights: lights.map((l) => {
        const t = l.token_id && tokens.find((x) => x.id === l.token_id);
        return { ...l, ownerLabel: l.token_id ? (t ? t.label || 'token' : 'token removido') : 'luz fixa' };
      }),
    };
  }
  Object.assign(sceneryApi, {
    setTab(t) {
      sceneryTab = t;
      if (t !== 'paredes' && wallTool) setWallTool(null);
      refreshScenery();
    },
    setLighting: (v) => patchBoard({ lighting_enabled: !!v }),
    setAmbient: (v) => patchBoard({ ambient: Math.max(0, Math.min(1, Number(v))) }),
    setFogMode: (v) => patchBoard({ fog_mode: v === 'neblina' ? 'neblina' : 'escuro' }),
    setAmbientColor: (v) => patchBoard({ ambient_color: v }),
    setViewAsPlayer(v) {
      viewAsPlayer = !!v;
      lighting.update();
      refreshScenery();
    },
    addFixedLight,
    toggleLight,
    editLight(id) {
      editLightId = editLightId === id ? null : id;
      refreshScenery();
    },
    liveLight: liveLightField,
    saveLight: saveLightFields,
    applyPreset(id, kind) {
      saveLightFields(id, presetFields(kind));
    },
    deleteLight: removeLight,
  });

  // ---- PALCO + zoom/pan (base de paredes e iluminação) ----
  // x/y/size dos tokens são % do PALCO (.board-stage), que tem a proporção
  // da imagem do mapa e é encaixado (contain) na tela -- igual pra todo
  // mundo, em qualquer aparelho. Antes eram % da tela inteira com a imagem
  // em `cover`, o que cortava o mapa de um jeito diferente em cada tela.
  // Zoom/pan são LOCAIS (cada um olha como quiser, nada vai pro banco nem
  // pro Broadcast); ficam em localStorage por tabuleiro.
  // view = { z: zoom, fx/fy: ponto do palco (0-1) que está no centro da tela }
  // -- em fração, não em px, pra sobreviver a redimensionar a janela.
  const ZOOM_MIN = 0.4;
  const ZOOM_MAX = 8;
  const FALLBACK_ASPECT = 16 / 9; // tabuleiro sem imagem
  let view = { z: 1, fx: 0.5, fy: 0.5 };
  const measuredDims = new Map(); // boardId -> { w, h } medido pela URL (boards antigos)
  const panPointers = new Map(); // pointerId -> último { x, y } (1 dedo = pan, 2 = pinça)
  let pinchLast = null;
  let saveViewTimer = null;
  let areaResizeObserver = null;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const viewKey = (id) => 'board-view-' + id;

  function loadView(boardId) {
    view = { z: 1, fx: 0.5, fy: 0.5 };
    try {
      const raw = localStorage.getItem(viewKey(boardId));
      if (!raw) return;
      const v = JSON.parse(raw);
      if (Number.isFinite(v.z) && Number.isFinite(v.fx) && Number.isFinite(v.fy)) {
        view = { z: clamp(v.z, ZOOM_MIN, ZOOM_MAX), fx: clamp(v.fx, 0, 1), fy: clamp(v.fy, 0, 1) };
      }
    } catch (_) {
      // storage bloqueado/corrompido -- começa do padrão
    }
  }
  function saveViewSoon() {
    clearTimeout(saveViewTimer);
    saveViewTimer = setTimeout(() => {
      try {
        if (viewBoardId) localStorage.setItem(viewKey(viewBoardId), JSON.stringify(view));
      } catch (_) {
        // sem storage, só não lembra
      }
    }, 250);
  }

  function currentBoard() {
    return boards.find((b) => b.id === viewBoardId) || null;
  }
  // tamanho natural da imagem do tabuleiro aberto (null = ainda não sei / sem imagem)
  function stageDims() {
    const b = currentBoard();
    if (b && b.bg_width > 0 && b.bg_height > 0) return { w: b.bg_width, h: b.bg_height };
    if (b && b.background_image_url && measuredDims.get(b.id)) return measuredDims.get(b.id);
    return null;
  }
  function stageAspect() {
    const d = stageDims();
    return d ? d.w / d.h : FALLBACK_ASPECT;
  }
  // sem imagem = pronto (16:9); com imagem, só depois de saber o tamanho
  function stageReady() {
    const b = currentBoard();
    return !(b && b.background_image_url) || !!stageDims();
  }
  // boards criados antes do palco não têm bg_width/bg_height: mede pela URL
  // (e o mestre grava, pra ninguém precisar medir de novo)
  function ensureStageDims() {
    const b = currentBoard();
    if (!b || !b.background_image_url || stageDims() || measuredDims.has(b.id)) return;
    const id = b.id;
    measuredDims.set(id, null);
    readImageSize(b.background_image_url)
      .then((d) => {
        measuredDims.set(id, d);
        if (isMaster) updateBoardDims(id, d.w, d.h).catch(() => {});
      })
      .catch(() => measuredDims.set(id, { w: 16, h: 9 }))
      .finally(() => {
        if (viewBoardId === id) applyView();
      });
  }

  // tamanho do palco em px com zoom 1 (contain dentro da área) + retângulo da área
  function stageBase() {
    const area = $('board-area');
    if (!area) return null;
    const a = area.getBoundingClientRect();
    if (!a.width || !a.height) return null;
    const aspect = stageAspect();
    let W;
    let H;
    if (a.width / a.height > aspect) {
      H = a.height;
      W = H * aspect;
    } else {
      W = a.width;
      H = W / aspect;
    }
    return { a, W, H };
  }

  function applyView() {
    const stage = $('board-stage');
    const base = stageBase();
    if (!stage || !base) return;
    const { a, W, H } = base;
    const z = view.z;
    const tx = a.width / 2 - view.fx * W * z;
    const ty = a.height / 2 - view.fy * H * z;
    stage.style.width = W + 'px';
    stage.style.height = H + 'px';
    stage.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
    // controles dos tokens (×, ⚙, alça, popover, cursores) não crescem/encolhem com o zoom
    stage.style.setProperty('--inv-zoom', String(1 / z));
    stage.style.visibility = stageReady() ? '' : 'hidden';
    lighting.resize();
  }

  // zoom em torno de um ponto da tela (o ponto sob o cursor fica parado)
  function zoomAt(clientX, clientY, factor) {
    const stage = $('board-stage');
    const base = stageBase();
    if (!stage || !base) return;
    const s = stage.getBoundingClientRect();
    const px = (clientX - s.left) / s.width;
    const py = (clientY - s.top) / s.height;
    const nz = clamp(view.z * factor, ZOOM_MIN, ZOOM_MAX);
    view.fx = clamp(px - (clientX - base.a.left - base.a.width / 2) / (base.W * nz), 0, 1);
    view.fy = clamp(py - (clientY - base.a.top - base.a.height / 2) / (base.H * nz), 0, 1);
    view.z = nz;
    applyView();
    saveViewSoon();
  }

  function panByPixels(dx, dy) {
    const base = stageBase();
    if (!base) return;
    view.fx = clamp(view.fx - dx / (base.W * view.z), 0, 1);
    view.fy = clamp(view.fy - dy / (base.H * view.z), 0, 1);
    applyView();
    saveViewSoon();
  }

  function resetView() {
    view = { z: 1, fx: 0.5, fy: 0.5 };
    applyView();
    saveViewSoon();
  }

  // pan/pinça só começam no "fundo" (nada de token, botão ou painel por baixo)
  function isBackgroundTarget(e) {
    if (e.target.closest('.board-wall-capture')) return e.button === 1; // ferramenta ativa: só o botão do meio arrasta o mapa
    return !e.target.closest('.board-token, button, input, label, .board-add-token-picker, .board-zoom-ctl');
  }
  function onAreaPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    const inCapture = !!e.target.closest('.board-wall-capture');
    if (inCapture && e.pointerType === 'touch') {
      // ferramenta de parede ativa: um dedo desenha (o editor cuida), dois dedos fazem pinça/pan
      panPointers.set(e.pointerId, { x: e.clientX, y: e.clientY, passive: true });
      if (panPointers.size === 2) {
        const [p, q] = Array.from(panPointers.values());
        pinchLast = { mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, dist: Math.hypot(p.x - q.x, p.y - q.y) };
      }
      return;
    }
    if (!isBackgroundTarget(e)) return;
    e.preventDefault();
    const area = e.currentTarget;
    try {
      area.setPointerCapture(e.pointerId);
    } catch (_) {
      // ponteiro já liberado -- segue sem captura
    }
    panPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (panPointers.size === 2) {
      const [p, q] = Array.from(panPointers.values());
      pinchLast = { mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, dist: Math.hypot(p.x - q.x, p.y - q.y) };
    }
    area.classList.add('panning');
  }
  function onAreaPointerMoveView(e) {
    const prev = panPointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY, passive: prev.passive };
    if (panPointers.size === 1) {
      if (!prev.passive) panByPixels(cur.x - prev.x, cur.y - prev.y);
      panPointers.set(e.pointerId, cur);
      return;
    }
    panPointers.set(e.pointerId, cur);
    const [p, q] = Array.from(panPointers.values());
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const dist = Math.hypot(p.x - q.x, p.y - q.y);
    if (pinchLast && pinchLast.dist > 0 && dist > 0) {
      panByPixels(mid.x - pinchLast.mid.x, mid.y - pinchLast.mid.y);
      zoomAt(mid.x, mid.y, dist / pinchLast.dist);
    }
    pinchLast = { mid, dist };
  }
  function onAreaPointerUpView(e) {
    if (!panPointers.delete(e.pointerId)) return;
    if (panPointers.size < 2) pinchLast = null;
    if (panPointers.size === 0) e.currentTarget.classList.remove('panning');
  }
  function onAreaWheel(e) {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
  }

  // ---- Fase 3: cursor colorido de cada um + preview de arrasto ao
  // vivo, via Realtime Broadcast (efêmero, nunca gravado no banco) ----
  const remoteCursors = new Map(); // userId -> { x, y, color, name, lastSeen }
  let lastCursorSendAt = 0;
  let lastDragSendAt = 0;
  let cursorPruneTimer = null;

  // ---- Fase 4: HUD (combate/dados/iniciativa/barras) ao redor do
  // tabuleiro -- montado como IRMÃO de `app` (não filho), pra
  // sobreviver aos innerHTML de renderFullscreen()/renderList() sem
  // perder estado/Realtime, e montado UMA VEZ SÓ (não a cada abrir/
  // fechar tabuleiro) -- os drawers de Combate/Dados embutem telas
  // inteiras que não têm como "desmontar" sem vazar canal, então só
  // trocam de visível/escondido junto com a tela cheia. Ver comentário
  // completo em boardHud.js.
  const hud = renderBoardHud(app.parentElement, { session, profile, campaign, characterId, characterName, isMaster });
  // drawer "Cenário" (paredes, e depois luz) -- só mestre, empilhado abaixo do de Dados
  if (isMaster && hud.root) {
    mountDrawer(hud.root, {
      side: 'left',
      icon: '🧭',
      label: '',
      title: 'cenário: paredes e iluminação',
      stack: 1,
      mountBody(container) {
        sceneryPanel = mountSceneryPanel(container, sceneryApi);
      },
    });
  }

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
    remoteCursors.clear();
    loadView(boardId);
    walls = [];
    lights = [];
    wallTool = null;
    selectedWallId = null;
    editLightId = null;
    viewAsPlayer = false;
    wallEditor.clearHistory();
    render();
    ensureStageDims();
    try {
      tokens = await listBoardTokens(boardId);
      error = '';
    } catch (err) {
      error = err.message;
    }
    try {
      walls = await listBoardWalls(boardId);
    } catch (_) {
      walls = []; // migration db/060 ainda não aplicada: tabuleiro funciona sem paredes
    }
    try {
      lights = await listBoardLights(boardId);
    } catch (_) {
      lights = [];
    }
    render();
    resubscribeTokens();
    startCursorPruneTimer();
    hud.setVisible(true);
  }

  function closeBoard() {
    if (areaResizeObserver) {
      areaResizeObserver.disconnect();
      areaResizeObserver = null;
    }
    panPointers.clear();
    wallEditor.detach();
    lighting.stop();
    wallTool = null;
    selectedWallId = null;
    walls = [];
    lights = [];
    viewBoardId = null;
    tokens = [];
    remoteCursors.clear();
    stopCursorPruneTimer();
    if (tokensChannel) {
      supabase.removeChannel(tokensChannel);
      tokensChannel = null;
    }
    lastSubscribedBoardId = undefined;
    hud.setVisible(false);
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
    tokensChannel = subscribeBoard(viewBoardId, {
      onChange: () => {
        clearTimeout(tokensReloadTimer);
        tokensReloadTimer = setTimeout(reloadTokens, 400);
      },
      onCursor: handleRemoteCursor,
      onDrag: handleRemoteDrag,
      onWalls: () => {
        clearTimeout(wallsReloadTimer);
        wallsReloadTimer = setTimeout(reloadWalls, 300);
      },
      onLights: () => {
        clearTimeout(lightsReloadTimer);
        lightsReloadTimer = setTimeout(reloadLights, 300);
      },
    });
  }

  let tokensReloadTimer = null;
  async function reloadTokens() {
    if (!viewBoardId) return;
    try {
      const fresh = await listBoardTokens(viewBoardId);
      // preserva a posição/tamanho local otimista do token que ESTOU
      // arrastando/redimensionando agora -- sem isso, um evento de
      // realtime alheio (outro jogador mexendo em outro token)
      // chegando no meio do meu gesto faria a tela "puxar" meu token
      // de volta pro valor antigo do banco.
      if (dragTokenId) {
        const mine = fresh.find((t) => t.id === dragTokenId);
        const prevLocal = tokens.find((t) => t.id === dragTokenId);
        if (mine && prevLocal) {
          mine.x = prevLocal.x;
          mine.y = prevLocal.y;
        }
      }
      if (resizeTokenId) {
        const mine = fresh.find((t) => t.id === resizeTokenId);
        const prevLocal = tokens.find((t) => t.id === resizeTokenId);
        if (mine && prevLocal) mine.size = prevLocal.size;
      }
      tokens = fresh;
      render();
    } catch (err) {
      // realtime reload falhando não deveria travar a tela -- só ignora,
      // a próxima mudança tenta de novo.
    }
  }

  // ---- Fase 3: receber cursor/arrasto ao vivo de outros clientes ----
  // Broadcast não passa pela RLS/CHECK que uma coluna de tabela teria
  // -- qualquer membro autenticado da campanha pode mandar QUALQUER
  // payload pro canal (ex: via devtools, sem passar pela UI). Valida
  // o formato de `color` (só aceita hex, senão cai no padrão) e limita
  // o tamanho de `name` antes de jogar no DOM -- mesmo com escapeHtml
  // escapando `<`/`>`/`&`, um valor cru dentro de um atributo
  // style="..." ainda podia tentar fechar a aspa com `"` e injetar
  // outro atributo (escapeHtml não escapa aspas, só serve pra texto).
  function handleRemoteCursor(payload) {
    if (!payload || !payload.userId || payload.userId === session.user.id) return;
    if (payload.leave) {
      remoteCursors.delete(payload.userId);
      renderCursors();
      return;
    }
    const color = /^#[0-9a-fA-F]{3,8}$/.test(payload.color) ? payload.color : '#5ad4ff';
    const name = String(payload.name || 'alguém').slice(0, 40);
    remoteCursors.set(payload.userId, {
      x: Math.max(0, Math.min(100, Number(payload.x) || 0)),
      y: Math.max(0, Math.min(100, Number(payload.y) || 0)),
      color,
      name,
      lastSeen: Date.now(),
    });
    renderCursors();
  }

  function handleRemoteDrag(payload) {
    if (!payload || !payload.tokenId || payload.userId === session.user.id) return;
    // se EU tô mexendo nesse mesmo token agora (não deveria acontecer
    // com o modelo de permissão atual, mas é barato se proteger),
    // ignora pra não brigar com o meu próprio arrasto local.
    if (payload.tokenId === dragTokenId || payload.tokenId === resizeTokenId) return;
    const token = tokens.find((t) => t.id === payload.tokenId);
    // comparação por dataset em vez de montar um seletor CSS com
    // tokenId interpolado -- payload vem de Broadcast (sem CHECK/RLS
    // de coluna), um tokenId malicioso com aspas dentro de um
    // `querySelector(\`...[data-token-id="${x}"]\`)` lançaria uma
    // exceção não tratada ali dentro.
    const el = Array.from(app.querySelectorAll('.board-token')).find((n) => n.dataset.tokenId === payload.tokenId);
    // converte/limita ANTES de gravar em `token.x/y/size` -- esse valor
    // fica no estado e pode acabar indo direto (sem escapeHtml, porque
    // sempre foi numérico) pro atributo style="" de um render() futuro
    // (tokenHtml). Broadcast não tem CHECK/RLS de coluna -- sem isso,
    // um cliente malicioso da campanha podia mandar x/y como string
    // arbitrária e injetar HTML na próxima renderização.
    if (payload.x !== undefined && payload.y !== undefined) {
      const x = Math.max(0, Math.min(100, Number(payload.x)));
      const y = Math.max(0, Math.min(100, Number(payload.y)));
      if (Number.isFinite(x) && Number.isFinite(y)) {
        if (token) {
          token.x = x;
          token.y = y;
        }
        if (el) {
          el.style.left = x + '%';
          el.style.top = y + '%';
        }
        lighting.update();
      }
    }
    if (payload.size !== undefined) {
      const size = Math.max(2, Math.min(40, Number(payload.size)));
      if (Number.isFinite(size)) {
        if (token) token.size = size;
        if (el) el.style.width = size + '%';
      }
    }
  }

  function myDisplayName() {
    return characterName || profile.username || 'alguém';
  }

  // reaproveita a cor de destaque do próprio tema do viewer -- em vez
  // de inventar uma UI de escolher cor de cursor, cada um já "tem"
  // uma cor (a do tema que escolheu em character.js/masterCampaignHub.js).
  function myCursorColor() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return v || '#5ad4ff';
  }

  function maybeBroadcastCursor(x, y) {
    const now = Date.now();
    if (now - lastCursorSendAt < LIVE_THROTTLE_MS) return;
    lastCursorSendAt = now;
    broadcastCursor(tokensChannel, { userId: session.user.id, name: myDisplayName(), color: myCursorColor(), x, y });
  }

  function maybeBroadcastDrag(tokenId, { x, y, size } = {}) {
    const now = Date.now();
    if (now - lastDragSendAt < LIVE_THROTTLE_MS) return;
    lastDragSendAt = now;
    const payload = { tokenId, userId: session.user.id };
    if (x !== undefined) payload.x = x;
    if (y !== undefined) payload.y = y;
    if (size !== undefined) payload.size = size;
    broadcastDrag(tokensChannel, payload);
  }

  // desenha os cursores remotos direto no DOM (sem passar pelo render()
  // grande da tela) -- chegam a ~16/s por pessoa, refazer o innerHTML
  // do tabuleiro inteiro a cada um seria caro à toa e interromperia
  // qualquer coisa que o usuário local esteja fazendo (arrastar,
  // popover de edição aberto etc).
  function renderCursors() {
    const layer = $('board-cursor-layer');
    if (!layer) return;
    layer.innerHTML = Array.from(remoteCursors.values())
      .map(
        (c) => `
      <div class="board-cursor" style="left:${c.x}%; top:${c.y}%;">
        <svg viewBox="0 0 24 24" width="18" height="18" style="fill:${escapeHtml(c.color)};"><path d="M4 2l16 7.5-6.8 1.7L11 18z"/></svg>
        <span class="board-cursor-label" style="color:${escapeHtml(c.color)}; border-color:${escapeHtml(c.color)};">${escapeHtml(c.name)}</span>
      </div>`
      )
      .join('');
  }

  function startCursorPruneTimer() {
    stopCursorPruneTimer();
    cursorPruneTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      remoteCursors.forEach((c, uid) => {
        if (now - c.lastSeen > CURSOR_STALE_MS) {
          remoteCursors.delete(uid);
          changed = true;
        }
      });
      if (changed) renderCursors();
    }, 3000);
  }

  function stopCursorPruneTimer() {
    if (cursorPruneTimer) {
      clearInterval(cursorPruneTimer);
      cursorPruneTimer = null;
    }
  }

  function onBoardAreaPointerMove(e) {
    // se o ponteiro estiver sobre um token/alça/popover, o evento já
    // borbulha até aqui também (não precisa de listener separado) --
    // as coordenadas continuam relativas ao board-area inteiro.
    const stageEl = $('board-stage');
    if (!stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    maybeBroadcastCursor(x, y);
  }

  function onBoardAreaPointerLeave() {
    broadcastCursor(tokensChannel, { userId: session.user.id, leave: true });
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

  // marcador solto (Fase 2) -- sobe a imagem primeiro (se escolhida;
  // o path só depende do board, não precisa do token já existir) e só
  // depois cria a linha do token, já com a URL pronta.
  async function handleCreateFreeform() {
    const name = freeformName.trim();
    if (!name) {
      $('freeform-name-input')?.focus();
      return;
    }
    try {
      let imageUrl = null;
      if (freeformImageFile) imageUrl = await uploadTokenImage(viewBoardId, freeformImageFile);
      const token = await createFreeformToken(viewBoardId, campaignId, { label: name, imageUrl, x: 50, y: 50 });
      tokens = [...tokens, token];
      freeformName = '';
      freeformImageFile = null;
      addTokenOpen = false;
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

  // ---- aparência do token (Fase 2, só mestre -- ver tokenEditPopoverHtml) ----
  async function applyTokenAppearance(tokenId, fields) {
    try {
      await updateTokenAppearance(tokenId, fields);
      const token = tokens.find((t) => t.id === tokenId);
      if (token) {
        if (fields.size !== undefined) token.size = fields.size;
        if (fields.shape !== undefined) token.shape = fields.shape;
        if (fields.borderColor !== undefined) token.border_color = fields.borderColor;
        if (fields.zIndex !== undefined) token.z_index = fields.zIndex;
        if (fields.label !== undefined) token.label = fields.label;
        if (fields.imageUrl !== undefined) token.image_url = fields.imageUrl;
      }
      render();
    } catch (err) {
      error = err.message;
      render();
    }
  }

  function handleBringToFront(tokenId) {
    const maxZ = tokens.reduce((m, t) => Math.max(m, t.z_index || 0), 0);
    applyTokenAppearance(tokenId, { zIndex: maxZ + 1 });
  }

  function handleSendToBack(tokenId) {
    const minZ = tokens.reduce((m, t) => Math.min(m, t.z_index || 0), 0);
    applyTokenAppearance(tokenId, { zIndex: minZ - 1 });
  }

  async function handleEditImageChange(tokenId, file) {
    try {
      const url = await uploadTokenImage(viewBoardId, file);
      await applyTokenAppearance(tokenId, { imageUrl: url });
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
    const boardArea = $('board-stage'); // palco: o retângulo dele já inclui zoom/pan
    if (!boardArea) return;
    e.preventDefault();
    dragTokenId = tokenId;
    dragPointerId = e.pointerId;
    dragEl = el;
    dragStartClientX = e.clientX;
    dragStartClientY = e.clientY;
    dragStartXPct = token.x;
    dragStartYPct = token.y;
    dragLastX = token.x;
    dragLastY = token.y;
    dragBoardRect = boardArea.getBoundingClientRect();
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
  }

  function onTokenPointerMove(e) {
    if (!dragTokenId || e.pointerId !== dragPointerId || !dragEl || !dragBoardRect) return;
    const deltaXPct = ((e.clientX - dragStartClientX) / dragBoardRect.width) * 100;
    const deltaYPct = ((e.clientY - dragStartClientY) / dragBoardRect.height) * 100;
    const wantX = Math.max(0, Math.min(100, dragStartXPct + deltaXPct));
    const wantY = Math.max(0, Math.min(100, dragStartYPct + deltaYPct));
    const token = tokens.find((t) => t.id === dragTokenId);
    // colisão com as paredes (o mestre ignora segurando Shift)
    const { x, y } = token ? resolveTokenMove(token, wantX, wantY, isMaster && e.shiftKey) : { x: wantX, y: wantY };
    dragEl.style.left = x + '%';
    dragEl.style.top = y + '%';
    if (token) {
      token.x = x;
      token.y = y;
    }
    lighting.update();
    maybeBroadcastDrag(dragTokenId, { x, y });
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
      persistFacing(token);
    }
  }

  // ---- redimensionar (alça no canto, Fase 2) -- mesma mecânica do
  // arrasto de mover, só que lê o deslocamento horizontal do ponteiro
  // e converte pra `size` (% da LARGURA do tabuleiro). Como o token é
  // centralizado no próprio ponto (translate(-50%,-50%)), a alça no
  // canto inferior direito fica a size/2 de distância do centro --
  // por isso o delta é multiplicado por 2 (mover a alça 1% pra
  // direita cresce o raio em 1%, ou seja, o diâmetro/size em 2%).
  function onResizePointerDown(e) {
    const handle = e.currentTarget;
    e.stopPropagation();
    const tokenEl = handle.closest('.board-token');
    const tokenId = tokenEl && tokenEl.dataset.tokenId;
    const token = tokens.find((t) => t.id === tokenId);
    if (!token || !canMoveToken(token)) return;
    const boardArea = $('board-stage'); // palco: o retângulo dele já inclui zoom/pan
    if (!boardArea) return;
    e.preventDefault();
    resizeTokenId = tokenId;
    resizePointerId = e.pointerId;
    resizeEl = tokenEl;
    resizeStartClientX = e.clientX;
    resizeStartSize = token.size;
    resizeBoardRect = boardArea.getBoundingClientRect();
    handle.setPointerCapture(e.pointerId);
  }

  function onResizePointerMove(e) {
    if (!resizeTokenId || e.pointerId !== resizePointerId || !resizeEl || !resizeBoardRect) return;
    const deltaXPct = ((e.clientX - resizeStartClientX) / resizeBoardRect.width) * 100;
    const size = Math.max(2, Math.min(40, resizeStartSize + deltaXPct * 2));
    resizeEl.style.width = size + '%';
    const token = tokens.find((t) => t.id === resizeTokenId);
    if (token) token.size = size;
    maybeBroadcastDrag(resizeTokenId, { size });
  }

  async function onResizePointerUp(e) {
    if (!resizeTokenId || e.pointerId !== resizePointerId) return;
    const tokenId = resizeTokenId;
    const token = tokens.find((t) => t.id === tokenId);
    resizeTokenId = null;
    resizePointerId = null;
    resizeEl = null;
    resizeBoardRect = null;
    if (token) {
      try {
        await updateTokenAppearance(tokenId, { size: token.size });
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
    // remover/redimensionar token segue a MESMA permissão de mover ele
    // (dono do personagem vinculado ou mestre) -- ver db/055. Editar
    // aparência (cor/formato/camada, e pro marcador solto nome/imagem)
    // é só do mestre -- mesma régua de quem CRIA o token.
    const movable = canMoveToken(t);
    const shapeClass = t.shape === 'square' ? 'square' : 'circle';
    return `
      <div class="board-token ${shapeClass} ${movable ? 'movable' : ''}" data-token-id="${t.id}"
        ${t.character_id ? 'data-character-id="' + escapeHtml(t.character_id) + '"' : ''}
        style="left:${t.x}%; top:${t.y}%; width:${t.size}%; border-color:${escapeHtml(t.border_color)}; z-index:${t.z_index};"
        title="${escapeHtml(t.label || '?')}">
        ${avatarOrLetter(t)}
        ${isMaster ? `<button type="button" class="board-token-edit-btn" data-token-edit-open="${t.id}" title="editar aparência">⚙</button>` : ''}
        ${movable ? `<button type="button" class="board-token-del" data-token-del="${t.id}" title="tirar do tabuleiro">×</button>` : ''}
        ${movable ? `<div class="board-token-resize" data-token-resize="${t.id}" title="redimensionar"></div>` : ''}
        ${tokenLightButtonHtml(t)}
        ${tokenEditPopoverHtml(t)}
      </div>`;
  }

  // botão de acender/apagar a luz do token (mestre em qualquer um, dono só no dele)
  function tokenLightButtonHtml(t) {
    const l = lightOfToken(t.id);
    if (!l || !canToggleLight(l)) return '';
    const p = LIGHT_PRESETS[l.kind] || LIGHT_PRESETS.custom;
    return `<button type="button" class="board-token-light-btn ${l.enabled ? 'on' : ''}" data-token-light="${t.id}" title="${l.enabled ? 'apagar' : 'acender'} ${escapeHtml(p.label.toLowerCase())}">${p.icon}</button>`;
  }

  // popover de aparência (Fase 2, só mestre) -- cor/formato/camada pra
  // qualquer token, e nome/imagem só pro marcador solto (token de
  // personagem tem nome/foto vindos da ficha, ver createTokenForCharacter).
  function tokenEditPopoverHtml(t) {
    if (!isMaster || editTokenId !== t.id) return '';
    const isFreeform = !t.character_id;
    return `
      <div class="board-token-edit-popover">
        <div class="board-token-edit-row">
          <label>cor</label>
          <input type="color" value="${escapeHtml(t.border_color)}" data-edit-color="${t.id}">
          <label>formato</label>
          <div class="board-token-shape-toggle">
            <button type="button" class="${t.shape !== 'square' ? 'active' : ''}" data-edit-shape="${t.id}" data-shape-value="circle" title="círculo">○</button>
            <button type="button" class="${t.shape === 'square' ? 'active' : ''}" data-edit-shape="${t.id}" data-shape-value="square" title="quadrado">□</button>
          </div>
        </div>
        <div class="board-token-edit-row">
          <button type="button" class="btn btn-ghost" data-edit-front="${t.id}">trazer pra frente</button>
          <button type="button" class="btn btn-ghost" data-edit-back="${t.id}">mandar pra trás</button>
        </div>
        ${
          isFreeform
            ? `<div class="board-token-edit-row">
                 <input type="text" class="board-row-rename-input" placeholder="nome" value="${escapeHtml(t.label || '')}" data-edit-label="${t.id}">
               </div>
               <div class="board-token-edit-row">
                 <label class="btn btn-ghost">trocar imagem<input type="file" accept="image/*" data-edit-image="${t.id}" style="display:none;"></label>
               </div>`
            : ''
        }
        <div class="board-token-edit-row">
          <label>luz</label>
          <div class="board-token-shape-toggle">
            <button type="button" class="${!lightOfToken(t.id) ? 'active' : ''}" data-edit-light="${t.id}" data-light-kind="" title="sem luz">∅</button>
            ${['tocha', 'lanterna', 'magia', 'vela', 'visao'].map((k) => `<button type="button" class="${(lightOfToken(t.id) || {}).kind === k ? 'active' : ''}" data-edit-light="${t.id}" data-light-kind="${k}" title="${LIGHT_PRESETS[k].label}">${LIGHT_PRESETS[k].icon}</button>`).join('')}
          </div>
        </div>
        <button type="button" class="board-token-edit-close" data-edit-close="1">fechar</button>
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
    return `
      <div class="board-add-token-picker">
        <div class="board-add-token-head">
          <div class="board-add-token-tabs">
            <button type="button" class="${addTokenTab === 'character' ? 'active' : ''}" data-add-token-tab="character">personagem</button>
            <button type="button" class="${addTokenTab === 'freeform' ? 'active' : ''}" data-add-token-tab="freeform">marcador solto</button>
          </div>
          <button type="button" class="board-add-token-close" id="board-add-token-close">×</button>
        </div>
        ${addTokenTab === 'character' ? addTokenCharacterListHtml() : addTokenFreeformFormHtml()}
      </div>`;
  }

  function addTokenCharacterListHtml() {
    const placedIds = new Set(tokens.map((t) => t.character_id).filter(Boolean));
    const available = charactersInCampaign.filter((c) => !placedIds.has(c.id));
    return available.length
      ? available
          .map(
            (c) => `
          <button type="button" class="board-add-token-option" data-add-token-char="${c.id}">
            ${c.avatar_url ? `<img src="${escapeHtml(c.avatar_url)}" alt="">` : `<span class="board-token-placeholder">${escapeHtml((c.name || '?').charAt(0).toUpperCase())}</span>`}
            ${escapeHtml(c.name)}${c.is_npc ? ' <small>(NPC)</small>' : ''}
          </button>`
          )
          .join('')
      : '<div class="admin-empty">todo mundo já tem token neste tabuleiro</div>';
  }

  // marcador solto (Fase 2) -- nome+imagem digitados na hora, sem
  // ficha vinculada (ex: monstro avulso, objeto de cena). Só o mestre
  // vê essa aba (addTokenPickerHtml já garante isMaster).
  function addTokenFreeformFormHtml() {
    return `
      <div class="board-freeform-form">
        <input type="text" id="freeform-name-input" placeholder="nome do marcador" value="${escapeHtml(freeformName)}">
        <label class="btn btn-ghost board-freeform-image-label">
          ${freeformImageFile ? 'imagem escolhida ✓' : 'escolher imagem (opcional)'}
          <input type="file" accept="image/*" id="freeform-image-input" style="display:none;">
        </label>
        <button type="button" class="btn" id="freeform-create-btn">criar marcador</button>
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
        <div class="board-area ${isMaster && wallTool ? 'walls-editing' : ''}" id="board-area">
          <div class="board-stage" id="board-stage" style="${bg ? `background-image:url('${escapeHtml(bg)}');` : ''}">
            ${tokens.map(tokenHtml).join('')}
            <div class="board-light-layer" id="board-light-layer"><canvas class="board-dark"></canvas><canvas class="board-glow"></canvas><canvas class="board-gray"></canvas></div>
            <div class="board-light-markers" id="board-light-markers">${fixedLightMarkersHtml()}</div>
            <div class="board-walls-layer" id="board-walls-layer">${showWallsLayer() ? wallsLayerHtml(visibleWalls(), { selectedId: selectedWallId, editing: wallTool === 'editar', doorButtons: isMaster }) : ''}</div>
            <div class="board-cursor-layer" id="board-cursor-layer"></div>
          </div>
          ${isMaster ? `<button type="button" class="board-add-token-fab" id="board-add-token-fab" title="adicionar token de personagem">+ token</button>` : ''}
          ${addTokenPickerHtml()}
          <div class="board-zoom-ctl">
            <button type="button" data-zoom="in" title="aproximar">+</button>
            <button type="button" data-zoom="out" title="afastar">−</button>
            <button type="button" data-zoom="reset" title="enquadrar o mapa">⤢</button>
          </div>
        </div>
      </div>`;
    wireFullscreenEvents();
    applyView();
    ensureStageDims();
    wireDoorButtons();
    wireLightMarkers();
    syncWallCapture();
    lighting.attach($('board-light-layer'));
    // o board-area acabou de ser reconstruído do zero (innerHTML) --
    // redesenha os cursores que eu já conhecia na camada nova, senão
    // eles ficam "invisíveis" até a próxima mensagem de Broadcast
    // chegar (Fase 3).
    renderCursors();
    // tokens recriados do zero: devolve o anel de turno / mini-barra de HP
    // (o HUD é quem sabe o estado do combate, ver boardHud.js)
    if (hud.decorate) hud.decorate();
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
    app.querySelectorAll('[data-add-token-tab]').forEach((btn) => {
      btn.addEventListener('click', () => { addTokenTab = btn.dataset.addTokenTab; render(); });
    });
    app.querySelectorAll('[data-add-token-char]').forEach((btn) => {
      btn.addEventListener('click', () => handleAddToken(btn.dataset.addTokenChar));
    });

    // ---- marcador solto (Fase 2) ----
    const freeformNameInput = $('freeform-name-input');
    if (freeformNameInput) {
      freeformNameInput.addEventListener('input', (e) => { freeformName = e.target.value; });
      freeformNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleCreateFreeform(); });
    }
    const freeformImageInput = $('freeform-image-input');
    if (freeformImageInput) {
      freeformImageInput.addEventListener('change', () => {
        freeformImageFile = (freeformImageInput.files && freeformImageInput.files[0]) || null;
        render();
      });
    }
    const freeformCreateBtn = $('freeform-create-btn');
    if (freeformCreateBtn) freeformCreateBtn.addEventListener('click', handleCreateFreeform);

    // ---- remover token ----
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

    // ---- editar aparência (Fase 2, só mestre) ----
    app.querySelectorAll('[data-token-edit-open]').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        editTokenId = editTokenId === btn.dataset.tokenEditOpen ? null : btn.dataset.tokenEditOpen;
        render();
      });
    });
    app.querySelectorAll('.board-token-edit-popover').forEach((el) => {
      // qualquer clique dentro do popover (inclusive nos inputs) não
      // deve borbulhar pro token por baixo e iniciar um arrasto.
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
    });
    app.querySelectorAll('[data-edit-close]').forEach((btn) => {
      btn.addEventListener('click', () => { editTokenId = null; render(); });
    });
    app.querySelectorAll('[data-edit-color]').forEach((input) => {
      input.addEventListener('change', () => applyTokenAppearance(input.dataset.editColor, { borderColor: input.value }));
    });
    app.querySelectorAll('[data-edit-shape]').forEach((btn) => {
      btn.addEventListener('click', () => applyTokenAppearance(btn.dataset.editShape, { shape: btn.dataset.shapeValue }));
    });
    app.querySelectorAll('[data-edit-front]').forEach((btn) => {
      btn.addEventListener('click', () => handleBringToFront(btn.dataset.editFront));
    });
    app.querySelectorAll('[data-edit-back]').forEach((btn) => {
      btn.addEventListener('click', () => handleSendToBack(btn.dataset.editBack));
    });
    app.querySelectorAll('[data-edit-label]').forEach((input) => {
      input.addEventListener('change', () => applyTokenAppearance(input.dataset.editLabel, { label: input.value.trim() || 'Marcador' }));
    });
    app.querySelectorAll('[data-edit-image]').forEach((input) => {
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (file) handleEditImageChange(input.dataset.editImage, file);
      });
    });

    app.querySelectorAll('[data-token-light]').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const l = lightOfToken(btn.dataset.tokenLight);
        if (l) toggleLight(l.id);
      });
    });
    app.querySelectorAll('[data-edit-light]').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setTokenLight(btn.dataset.editLight, btn.dataset.lightKind);
      });
    });

    // ---- arrasto de mover ----
    app.querySelectorAll('.board-token').forEach((el) => {
      el.addEventListener('pointerdown', onTokenPointerDown);
      el.addEventListener('pointermove', onTokenPointerMove);
      el.addEventListener('pointerup', onTokenPointerUp);
      el.addEventListener('pointercancel', onTokenPointerUp);
    });

    // ---- arrasto de redimensionar (Fase 2) ----
    app.querySelectorAll('.board-token-resize').forEach((el) => {
      el.addEventListener('pointerdown', onResizePointerDown);
      el.addEventListener('pointermove', onResizePointerMove);
      el.addEventListener('pointerup', onResizePointerUp);
      el.addEventListener('pointercancel', onResizePointerUp);
    });

    // ---- cursor ao vivo (Fase 3) -- rastreia o ponteiro em cima do
    // board-area inteiro (inclusive quando tá em cima de um token,
    // que já borbulha até aqui) ----
    const boardAreaEl = $('board-area');
    if (boardAreaEl) {
      boardAreaEl.addEventListener('pointermove', onBoardAreaPointerMove);
      boardAreaEl.addEventListener('pointerleave', onBoardAreaPointerLeave);
      // zoom (roda/pinça) e pan (arrastar o fundo) -- locais
      boardAreaEl.addEventListener('pointerdown', onAreaPointerDown);
      boardAreaEl.addEventListener('pointermove', onAreaPointerMoveView);
      boardAreaEl.addEventListener('pointerup', onAreaPointerUpView);
      boardAreaEl.addEventListener('pointercancel', onAreaPointerUpView);
      boardAreaEl.addEventListener('wheel', onAreaWheel, { passive: false });
      boardAreaEl.querySelectorAll('[data-zoom]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const mode = btn.dataset.zoom;
          if (mode === 'reset') resetView();
          else {
            const r = boardAreaEl.getBoundingClientRect();
            zoomAt(r.left + r.width / 2, r.top + r.height / 2, mode === 'in' ? 1.25 : 0.8);
          }
        });
      });
      // janela/tela mudou de tamanho: reencaixa o palco
      if (areaResizeObserver) areaResizeObserver.disconnect();
      if (typeof ResizeObserver !== 'undefined') {
        areaResizeObserver = new ResizeObserver(() => applyView());
        areaResizeObserver.observe(boardAreaEl);
      }
    }
  }

  load();
  subscribeBoardsRealtime();
}
