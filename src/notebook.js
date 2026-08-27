// Fase 7 — camada de dados do caderno de anotações do player. Ver
// db/026_patch_notebook.sql: notebook_data é coluna própria (não entra
// no `data` genérico do inventário) e a leitura de quem não é o dono
// passa pela RPC get_notebook_shared_pages, que filtra só as páginas
// marcadas como visíveis ao mestre.
import { supabase } from './supabaseClient.js';

// cada tema escolhe uma "família" de navegação: 'physical' (páginas
// que viram, tipo caderno/pergaminho) ou 'digital' (abas, tipo
// terminal/bloco moderno) -- ver notebook.css.
export const NOTEBOOK_THEMES = [
  { id: 'papel', label: 'Caderno de Papel', family: 'physical', font: "'Caveat', cursive" },
  { id: 'pergaminho', label: 'Pergaminho Antigo', family: 'physical', font: "'IM Fell English', serif" },
  { id: 'terminal', label: 'Terminal Digital', family: 'digital', font: "'JetBrains Mono', monospace" },
  { id: 'moderno', label: 'Bloco Moderno', family: 'digital', font: "'Inter', sans-serif" },
];

function genId() {
  return 'pg_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function defaultNotebook() {
  return {
    theme: 'papel',
    activePageId: null,
    pages: [{ id: genId(), title: 'Página 1', html: '', visibleToMaster: false }],
  };
}

function normalizeNotebook(raw) {
  const nb = raw && typeof raw === 'object' ? raw : {};
  const pages = Array.isArray(nb.pages) && nb.pages.length > 0 ? nb.pages : defaultNotebook().pages;
  const theme = NOTEBOOK_THEMES.some((t) => t.id === nb.theme) ? nb.theme : 'papel';
  const activePageId = pages.some((p) => p.id === nb.activePageId) ? nb.activePageId : pages[0].id;
  return {
    theme,
    activePageId,
    pages: pages.map((p) => ({
      id: p.id || genId(),
      title: p.title || 'Sem título',
      html: typeof p.html === 'string' ? p.html : '',
      visibleToMaster: !!p.visibleToMaster,
    })),
  };
}

export function newPage(title) {
  return { id: genId(), title: title || 'Nova página', html: '', visibleToMaster: false };
}

// dono: lê o próprio caderno inteiro (RLS já cobre isso via
// "personagem: dono vê e edita", select direto).
export async function loadOwnNotebook(characterId) {
  const { data, error } = await supabase.from('characters').select('notebook_data').eq('id', characterId).maybeSingle();
  if (error) throw error;
  return normalizeNotebook(data && data.notebook_data);
}

export async function saveOwnNotebook(characterId, notebook) {
  const { error } = await supabase.from('characters').update({ notebook_data: notebook }).eq('id', characterId);
  if (error) throw error;
}

// mestre (ou mestre global) olhando o caderno de alguém: só as páginas
// marcadas como compartilhadas, via RPC (select direto vazaria tudo,
// já que RLS não filtra dentro do JSONB -- ver comentário na migration).
export async function loadSharedNotebookPages(characterId) {
  const { data, error } = await supabase.rpc('get_notebook_shared_pages', { p_character_id: characterId });
  if (error) throw error;
  const theme = NOTEBOOK_THEMES.some((t) => t.id === (data && data.theme)) ? data.theme : 'papel';
  const pages = data && Array.isArray(data.pages) ? data.pages : [];
  return { theme, pages };
}

export async function uploadNotebookImage(characterId, file) {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `${characterId}/notebook/${genId()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: false, cacheControl: '3600' });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}

// allowlist simples de tags/atributos -- o editor é contenteditable
// (HTML de verdade), então isso é a única barreira contra HTML/script
// malicioso acabar salvo e depois renderizado (pro próprio dono, ou
// pro mestre quando a página é compartilhada).
const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'UL', 'OL', 'LI', 'BR', 'P', 'DIV', 'SPAN', 'IMG']);

export function sanitizeNotebookHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstChild;

  function clean(node) {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) return;
      if (child.nodeType !== Node.ELEMENT_NODE || !ALLOWED_TAGS.has(child.tagName)) {
        // desconhecido/perigoso (script, style, on* via tag inválida) --
        // mantém só o texto de dentro, descarta a tag.
        const text = doc.createTextNode(child.textContent || '');
        child.replaceWith(text);
        return;
      }
      [...child.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        if (child.tagName === 'IMG' && (name === 'src' || name === 'alt')) return;
        if (name === 'style') {
          // só permite width/height inline (é o que o resize usa) --
          // remove qualquer outra declaração (url(), position, etc).
          const safe = attr.value
            .split(';')
            .map((s) => s.trim())
            .filter((s) => /^(width|height)\s*:\s*[\d.]+(px|%)$/i.test(s))
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
