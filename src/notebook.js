// Fase 7 — camada de dados do caderno de anotações. Um personagem tem
// vários cadernos (characters.notebook_data.notebooks), cada um com
// seu próprio tema/material/fonte e páginas -- é assim que dá pra ter
// "1 caderno velho e 1 terminal" ao mesmo tempo, por exemplo. Ver
// db/026 e db/027_patch_notebook_multi.sql: notebook_data é coluna
// própria (não entra no `data` genérico do inventário, que já é
// escrito de forma independente pelo autosave de character.js -- ver
// comentário completo na migration 026) e a leitura de quem não é o
// dono passa pela RPC get_notebook_shared_pages, que devolve só os
// cadernos/páginas marcados como visíveis ao mestre.
import { supabase } from './supabaseClient.js';

// cada tema escolhe uma "família" de navegação (physical = folha que
// vira, digital = abas) e um conjunto de variantes de material +
// fontes sugeridas -- mas a fonte final pode ser qualquer uma
// (ver customFont em getFontFamily).
export const NOTEBOOK_THEMES = [
  {
    id: 'papel',
    label: 'Caderno de Papel',
    family: 'physical',
    variants: [
      { id: 'branco-pautado', label: 'Branca, com linha' },
      { id: 'branco-liso', label: 'Branca, lisa' },
      { id: 'amarelado-pautado', label: 'Amarelada, com linha' },
      { id: 'amarelado-liso', label: 'Amarelada, lisa' },
    ],
    defaultVariant: 'branco-pautado',
    fonts: [
      { label: 'Caveat', family: "'Caveat', cursive" },
      { label: 'Kalam', family: "'Kalam', cursive" },
      { label: 'Shadows Into Light', family: "'Shadows Into Light', cursive" },
      { label: 'Patrick Hand', family: "'Patrick Hand', cursive" },
      { label: 'Indie Flower', family: "'Indie Flower', cursive" },
    ],
  },
  {
    id: 'pergaminho',
    label: 'Pergaminho Antigo',
    family: 'physical',
    variants: [
      { id: 'velho', label: 'Pergaminho velho' },
      { id: 'novo', label: 'Pergaminho novo' },
    ],
    defaultVariant: 'velho',
    fonts: [
      { label: 'IM Fell English', family: "'IM Fell English', serif" },
      { label: 'Cinzel', family: "'Cinzel', serif" },
      { label: 'MedievalSharp', family: "'MedievalSharp', cursive" },
      { label: 'UnifrakturMaguntia', family: "'UnifrakturMaguntia', cursive" },
    ],
  },
  {
    id: 'digital',
    label: 'Terminal Digital',
    family: 'digital',
    variants: [
      { id: 'classico', label: 'Terminal Clássico' },
      { id: 'cmd', label: 'CMD do Windows' },
      { id: 'cyberpunk', label: 'Cyberpunk' },
      { id: 'moderno', label: 'Bloco Moderno' },
    ],
    defaultVariant: 'classico',
    fonts: [
      { label: 'JetBrains Mono', family: "'JetBrains Mono', monospace" },
      { label: 'Share Tech Mono', family: "'Share Tech Mono', monospace" },
      { label: 'VT323', family: "'VT323', monospace" },
      { label: 'Space Mono', family: "'Space Mono', monospace" },
      { label: 'Fira Code', family: "'Fira Code', monospace" },
      { label: 'Inter', family: "'Inter', sans-serif" },
    ],
  },
];

export const TEXT_COLORS = ['#e8e6df', '#ff6b6b', '#ffb020', '#ffe066', '#4ade80', '#5ad4ff', '#b98bff', '#ff8fd6'];

function genId(prefix) {
  return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function themeDef(themeId) {
  return NOTEBOOK_THEMES.find((t) => t.id === themeId) || NOTEBOOK_THEMES[0];
}

export function newPage(title) {
  return { id: genId('pg'), title: title || 'Nova página', html: '', visibleToMaster: false };
}

export function newNotebook(name, themeId) {
  const theme = themeDef(themeId);
  return {
    id: genId('nb'),
    name: name || 'Novo caderno',
    themeId: theme.id,
    variant: theme.defaultVariant,
    font: theme.fonts[0].family,
    customFont: null,
    pageViewMode: 'single',
    expandedView: false,
    activePageId: null,
    pages: [newPage('Página 1')],
  };
}

function normalizePage(p) {
  return {
    id: p.id || genId('pg'),
    title: p.title || 'Sem título',
    html: typeof p.html === 'string' ? p.html : '',
    visibleToMaster: !!p.visibleToMaster,
  };
}

function normalizeNotebook(nb) {
  const theme = themeDef(nb.themeId);
  const pages = Array.isArray(nb.pages) && nb.pages.length > 0 ? nb.pages.map(normalizePage) : [newPage('Página 1')];
  const activePageId = pages.some((p) => p.id === nb.activePageId) ? nb.activePageId : pages[0].id;
  const variant = theme.variants.some((v) => v.id === nb.variant) ? nb.variant : theme.defaultVariant;
  return {
    id: nb.id || genId('nb'),
    name: nb.name || 'Caderno',
    themeId: theme.id,
    variant,
    font: typeof nb.font === 'string' && nb.font ? nb.font : theme.fonts[0].family,
    customFont: typeof nb.customFont === 'string' ? nb.customFont : null,
    pageViewMode: nb.pageViewMode === 'spread' ? 'spread' : 'single',
    expandedView: !!nb.expandedView,
    activePageId,
    pages,
  };
}

// dados antigos (antes de existir "vários cadernos") guardavam
// {theme, activePageId, pages} direto na raiz -- migra isso pra um
// único caderno na lista nova, sem perder nada que já foi escrito.
function normalizeNotebookData(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  let notebooks = Array.isArray(data.notebooks) ? data.notebooks : null;

  if (!notebooks) {
    if (Array.isArray(data.pages) && data.pages.length > 0) {
      notebooks = [normalizeNotebook({ name: 'Caderno', themeId: data.theme, activePageId: data.activePageId, pages: data.pages })];
    } else {
      notebooks = [newNotebook('Caderno 1', 'papel')];
    }
  }
  if (notebooks.length === 0) notebooks = [newNotebook('Caderno 1', 'papel')];

  const normalized = notebooks.map(normalizeNotebook);
  const activeNotebookId = normalized.some((n) => n.id === data.activeNotebookId) ? data.activeNotebookId : normalized[0].id;
  return { activeNotebookId, notebooks: normalized };
}

export async function loadOwnNotebookData(characterId) {
  const { data, error } = await supabase.from('characters').select('notebook_data').eq('id', characterId).maybeSingle();
  if (error) throw error;
  return normalizeNotebookData(data && data.notebook_data);
}

export async function saveOwnNotebookData(characterId, notebookData) {
  const { error } = await supabase.from('characters').update({ notebook_data: notebookData }).eq('id', characterId);
  if (error) throw error;
}

// mestre (ou mestre global) olhando os cadernos de alguém: só os
// cadernos/páginas marcados como compartilhados, via RPC (select
// direto vazaria tudo, já que RLS não filtra dentro do JSONB).
export async function loadSharedNotebooks(characterId) {
  const { data, error } = await supabase.rpc('get_notebook_shared_pages', { p_character_id: characterId });
  if (error) throw error;
  if (!Array.isArray(data)) return [];
  return data.map((nb) => ({
    notebookId: nb.notebookId,
    notebookName: nb.notebookName || 'Caderno',
    themeId: NOTEBOOK_THEMES.some((t) => t.id === nb.themeId) ? nb.themeId : 'papel',
    pages: Array.isArray(nb.pages) ? nb.pages.map(normalizePage) : [],
  }));
}

export async function uploadNotebookImage(characterId, file) {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `${characterId}/notebook/${genId('img')}.${ext}`;
  const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: false, cacheControl: '3600' });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}

export function getFontFamily(notebook) {
  if (notebook.customFont) return `'${notebook.customFont}', ${themeDef(notebook.themeId).family === 'digital' ? 'monospace' : 'cursive'}`;
  return notebook.font;
}

// injeta o <link> do Google Fonts pra uma fonte "livre" (fora da lista
// sugerida) só na primeira vez que ela é escolhida -- as sugeridas já
// vêm carregadas no index.html.
const loadedCustomFonts = new Set();
export function ensureCustomFontLoaded(fontName) {
  if (!fontName || loadedCustomFonts.has(fontName)) return;
  loadedCustomFonts.add(fontName);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName).replace(/%20/g, '+')}:wght@400;700&display=swap`;
  document.head.appendChild(link);
}

// allowlist simples de tags/atributos -- o editor é contenteditable
// (HTML de verdade), então isso é a única barreira contra HTML/script
// malicioso acabar salvo e depois renderizado (pro próprio dono, ou
// pro mestre quando a página é compartilhada). Roda tanto ao salvar
// quanto ao exibir (defesa em profundidade -- alguém podia adulterar
// o próprio registro via devtools pra tentar atacar quem lê a página).
const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'UL', 'OL', 'LI', 'BR', 'P', 'DIV', 'SPAN', 'FONT', 'IMG']);
const SAFE_STYLE_DECL = /^(width|height)\s*:\s*[\d.]+(px|%)$/i;
const SAFE_COLOR = /^#[0-9a-f]{3,8}$/i;

export function sanitizeNotebookHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstChild;

  function clean(node) {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) return;
      if (child.nodeType !== Node.ELEMENT_NODE || !ALLOWED_TAGS.has(child.tagName)) {
        const text = doc.createTextNode(child.textContent || '');
        child.replaceWith(text);
        return;
      }
      [...child.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        if (child.tagName === 'IMG' && (name === 'src' || name === 'alt')) return;
        if (child.tagName === 'FONT' && name === 'color' && SAFE_COLOR.test(attr.value)) return;
        if (name === 'style') {
          const safe = attr.value
            .split(';')
            .map((s) => s.trim())
            .filter((s) => SAFE_STYLE_DECL.test(s) || (/^color\s*:\s*/i.test(s) && SAFE_COLOR.test(s.split(':')[1].trim())))
            .join('; ');
          if (safe) child.setAttribute('style', safe);
          else child.removeAttribute('style');
          return;
        }
        child.removeAttribute(attr.name);
      });
      if (child.tagName === 'IMG') {
        const src = child.getAttribute('src') || '';
        if (!/^https?:\/\//i.test(src)) child.remove();
      }
      clean(child);
    });
  }

  clean(root);
  return root.innerHTML;
}
