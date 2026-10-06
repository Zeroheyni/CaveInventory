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
      { id: 'branco-liso', label: 'Branca' },
      { id: 'amarelado-liso', label: 'Amarelada' },
      { id: 'reciclado', label: 'Reciclada' },
      { id: 'craft', label: 'Kraft' },
      { id: 'couro', label: 'Couro' },
      { id: 'marmorizado', label: 'Marmorizado' },
      { id: 'jornal', label: 'Jornal Velho' },
      { id: 'linho', label: 'Linho' },
      { id: 'aquarela', label: 'Aquarela' },
      { id: 'grafite', label: 'Grafite' },
    ],
    defaultVariant: 'branco-liso',
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
      { id: 'rasgado', label: 'Rasgado' },
      { id: 'elfico', label: 'Élfico' },
      { id: 'real', label: 'Real' },
      { id: 'queimado', label: 'Queimado' },
      { id: 'amaldicoado', label: 'Amaldiçoado' },
      { id: 'gelido', label: 'Gélido' },
      { id: 'nautico', label: 'Náutico' },
      { id: 'arcano', label: 'Arcano' },
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
      { id: 'ambar', label: 'Âmbar' },
      { id: 'azul-retro', label: 'Azul Retrô' },
      { id: 'alerta-vermelho', label: 'Alerta Vermelho' },
      { id: 'solarized', label: 'Solarized' },
      { id: 'synthwave', label: 'Synthwave' },
      { id: 'mono-claro', label: 'Mono Claro' },
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
    pageViewMode: 'spread', // caderno aberto por padrão: é o que dá a sensação de livro
    ruling: 'lisa',
    expandedView: false,
    activePageId: null,
    pages: [newPage('Página 1')],
  };
}

// pauta da folha (desenhada por CSS, alinhada à altura da linha do texto)
export const RULINGS = [
  { id: 'lisa', label: 'Lisa' },
  { id: 'pautada', label: 'Pautada' },
  { id: 'quadriculada', label: 'Quadriculada' },
  { id: 'pontilhada', label: 'Pontilhada' },
];

// cor da CAPA de cada caderno (lista de cadernos + moldura do livro aberto)
const COVERS = {
  papel: { 'branco-liso': '#2f4a73', 'amarelado-liso': '#6b4426', reciclado: '#4d6a47', craft: '#8a6238', couro: '#4a2a17', marmorizado: '#2d5f80', jornal: '#4b4d52', linho: '#7a6b54', aquarela: '#2f7a7a', grafite: '#33363b' },
  pergaminho: { velho: '#5a3a1e', novo: '#7a5a34', rasgado: '#3d2814', elfico: '#2f5a3a', real: '#5a2670', queimado: '#241610', amaldicoado: '#5a1a1f', gelido: '#2f4f66', nautico: '#1f5a60', arcano: '#3d2a66' },
};
export function coverColorOf(themeId, variant) {
  const t = COVERS[themeId];
  return (t && t[variant]) || '#4a2a17';
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
    pageViewMode: nb.pageViewMode === 'single' ? 'single' : 'spread',
    ruling: ['lisa', 'pautada', 'quadriculada', 'pontilhada'].includes(nb.ruling) ? nb.ruling : 'lisa',
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
  return data.map((nb) => {
    const pages = Array.isArray(nb.pages) ? nb.pages.map(normalizePage) : [];
    const norm = normalizeNotebook({ ...nb, id: nb.notebookId, name: nb.notebookName, pages: pages.length ? pages : null, activePageId: pages[0] && pages[0].id });
    return { ...norm, notebookId: nb.notebookId, notebookName: nb.notebookName || 'Caderno', pages };
  });
}

export async function uploadNotebookImage(characterId, file) {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `${characterId}/notebook/${genId('img')}.${ext}`;
  const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: false, cacheControl: '3600' });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}

// Desenho a lápis/caneta feito num papel que não é o da página (ex.: papel bege) fica com um "retângulo" em volta. Aqui o papel
// da imagem vira transparência: (1) estima a cor do papel (percentil alto de cada canal), (2) divide a imagem por ela -- o papel
// vira branco e o grafite fica como estava ("flat-field"), (3) converte claridade em opacidade de um grafite escuro. O traço
// passa a valer em QUALQUER página (clara, escura, quadriculada) e o papel some de verdade. Devolve um File PNG.
export async function paperlessImageFile(src, maxSide = 1800) {
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous'; // o storage público libera CORS; sem isso o canvas ficaria "sujo" e não leríamos os pixels
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('não consegui abrir a imagem'));
    im.src = src + (src.includes('?') ? '&' : '?') + 'cb=' + Date.now(); // evita pegar a cópia em cache sem CORS
  });
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;

  // cor do papel: percentil 88 de cada canal numa amostra (o papel é a maior parte da imagem)
  const sample = [[], [], []];
  const step = Math.max(1, Math.floor((w * h) / 40000));
  for (let i = 0; i < w * h; i += step) {
    sample[0].push(px[i * 4]);
    sample[1].push(px[i * 4 + 1]);
    sample[2].push(px[i * 4 + 2]);
  }
  const pct = (arr) => {
    arr.sort((a, b) => a - b);
    return Math.max(60, arr[Math.min(arr.length - 1, Math.floor(arr.length * 0.88))]);
  };
  const paper = [pct(sample[0]), pct(sample[1]), pct(sample[2])];

  const BLACK = 0.1; // abaixo disso é grafite cheio
  const WHITE = 0.93; // acima disso é papel (some) -- engole o grão do papel
  const [gr, gg, gb] = [48, 42, 36]; // cor do grafite
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const r = Math.min(255, (px[o] * 255) / paper[0]);
    const g = Math.min(255, (px[o + 1] * 255) / paper[1]);
    const b = Math.min(255, (px[o + 2] * 255) / paper[2]);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const L = Math.max(0, Math.min(1, (lum - BLACK) / (WHITE - BLACK)));
    const alpha = Math.pow(1 - L, 0.9) * (px[o + 3] / 255);
    px[o] = gr;
    px[o + 1] = gg;
    px[o + 2] = gb;
    px[o + 3] = Math.round(alpha * 255);
  }
  ctx.putImageData(data, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('não consegui gerar a imagem');
  return new File([blob], 'sem-fundo.png', { type: 'image/png' });
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
const SAFE_STYLE_DECL = /^(width|height)\s*:\s*([\d.]+(px|%)|auto)$/i;
// acabamento da figura: sem sombra (desenho sem fundo), mesclada, ocupando a página, centralizada
const IMG_CLASSES = new Set(['notebook-img-flat', 'notebook-img-blend', 'notebook-img-full', 'notebook-img-center']);
const SAFE_COLOR = /^#[0-9a-f]{3,8}$/i;

export function sanitizeNotebookHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstChild;

  function clean(node) {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) return;
      if (child.nodeType === Node.COMMENT_NODE) {
        child.remove(); // <!--StartFragment--> / <!--EndFragment--> do clipboard: nunca pode virar texto
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE || !ALLOWED_TAGS.has(child.tagName)) {
        const text = doc.createTextNode(child.textContent || '');
        child.replaceWith(text);
        return;
      }
      [...child.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        if (child.tagName === 'IMG' && (name === 'src' || name === 'alt')) return;
        if (child.tagName === 'FONT' && name === 'color' && SAFE_COLOR.test(attr.value)) return;
        if (name === 'class' && child.tagName === 'IMG') {
          // acabamento da figura: sem sombra (desenho sem fundo) ou mesclada com o papel da página
          const cls = attr.value.split(/\s+/).filter((c) => IMG_CLASSES.has(c));
          if (cls.length) child.setAttribute('class', [...new Set(cls)].join(' '));
          else child.removeAttribute('class');
          return;
        }
        if (name === 'class') {
          // única classe permitida -- e sempre grava só ela, nunca junto
          // com "revealed" (classe que o clique de "revelar" adiciona só
          // no DOM ao vivo, nunca deve ir pro banco -- senão um spoiler
          // salvo bem na hora em que alguém clicou pra espiar ficava
          // permanentemente revelado da próxima vez que a página abrisse).
          if (child.tagName === 'SPAN' && attr.value.split(/\s+/).includes('notebook-spoiler')) {
            child.setAttribute('class', 'notebook-spoiler');
          } else {
            child.removeAttribute('class');
          }
          return;
        }
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
