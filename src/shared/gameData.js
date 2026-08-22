export const TAG_ICONS = {
  arma: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 20l9-9"/><path d="M13 11l4-4 3 3-4 4"/><path d="M14 6l3-3"/><path d="M17 3l1 1"/></svg>',
  bolsa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 9c0-3 1.8-5 4-5s4 2 4 5"/><path d="M6 9h12l1 10a2 2 0 01-2 2H7a2 2 0 01-2-2z"/></svg>',
  vestimenta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 4l4 2 4-2 4 3-2 3-2-1v10H8V9L6 10 4 7z"/></svg>',
  alimento: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 8c-3 0-5 2.2-5 5.3 0 3 2 6.2 5 6.2s5-3.2 5-6.2C17 10.2 15 8 12 8z"/><path d="M12 8c0-2 1-3 2.5-3.3"/><path d="M11 5.5c-.8-1-2-1.3-3-1"/></svg>',
  pocao: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 3h4v4l4 8a3 3 0 01-3 4H9a3 3 0 01-3-4l4-8z"/><path d="M9 3h6"/><path d="M8.5 14h7"/></svg>',
  ferramenta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14.7 6.3a4 4 0 00-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 005.4-5.4l-2.3 2.3-2-2z"/></svg>',
  material: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 14l4-9 8 2 4 7-6 6z"/></svg>',
  acessorio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="14" r="5"/><path d="M9 9l3-6 3 6"/></svg>',
  municao: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3l3 3v9a3 3 0 01-6 0V6z"/><path d="M9 9h6"/></svg>',
  consumivel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="9" y="3" width="6" height="18" rx="2"/><path d="M9 10h6"/><path d="M12 7v6"/></svg>',
  quest: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3l2.5 6.5L21 10l-5 4.5L17.5 21 12 17l-5.5 4L8 14.5 3 10l6.5-.5z"/></svg>',
  recipiente: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 8l9-4 9 4-9 4z"/><path d="M3 8v8l9 4 9-4V8"/><path d="M12 12v8"/></svg>',
  tesouro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="10" width="16" height="9" rx="1.5"/><path d="M4 10a8 4 0 0116 0"/><path d="M9 14h6"/></svg>',
  outro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 3v18M4 7.5l8 4.5 8-4.5"/></svg>',
};

export const TAGS = {
  arma: { label: 'Arma', emoji: '⚔️' },
  bolsa: { label: 'Bolsa', emoji: '🎒' },
  vestimenta: { label: 'Vestimenta', emoji: '🛡️' },
  alimento: { label: 'Alimento', emoji: '🍞' },
  pocao: { label: 'Poção', emoji: '🧪' },
  ferramenta: { label: 'Ferramenta', emoji: '🛠️' },
  material: { label: 'Material', emoji: '🧱' },
  acessorio: { label: 'Acessório', emoji: '💍' },
  municao: { label: 'Munição', emoji: '🎯' },
  consumivel: { label: 'Consumível', emoji: '💊' },
  quest: { label: 'Quest', emoji: '⭐' },
  recipiente: { label: 'Recipiente', emoji: '📦' },
  tesouro: { label: 'Tesouro', emoji: '💰' },
  outro: { label: 'Outros', emoji: '❔' },
};

export const TAG_ORDER = [
  'arma', 'vestimenta', 'acessorio', 'alimento', 'pocao', 'consumivel', 'ferramenta',
  'material', 'municao', 'quest', 'tesouro', 'recipiente', 'bolsa', 'outro',
];

export function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

export function round(n) {
  return Math.round(n * 100) / 100;
}
