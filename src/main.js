import './styles/theme.css';
import './styles/auth.css';
import './styles/campaign-strip.css';
import './styles/admin.css';
import './styles/publicArea.css';
import './styles/combat.css';
import './styles/ficha.css';
import './styles/npcBank.css';
import './styles/notebook.css';
import './styles/dice.css';
import './styles/sessionJournal.css';
import { supabase } from './supabaseClient.js';
import { renderApp } from './router.js';
import { isRerenderSuppressed } from './auth.js';

let lastUserId;

supabase.auth.onAuthStateChange((_event, session) => {
  if (isRerenderSuppressed()) return; // troca de sessão interna (ex: mestre criando conta de jogador)
  const userId = session?.user?.id ?? null;
  if (userId === lastUserId) return; // ignora refresh de token etc, só re-renderiza em troca real de sessão
  lastUserId = userId;
  renderApp();
});
