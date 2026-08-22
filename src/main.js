import './styles/theme.css';
import './styles/auth.css';
import './styles/campaign-strip.css';
import { supabase } from './supabaseClient.js';
import { renderApp } from './router.js';

let lastUserId;

supabase.auth.onAuthStateChange((_event, session) => {
  const userId = session?.user?.id ?? null;
  if (userId === lastUserId) return; // ignora refresh de token etc, só re-renderiza em troca real de sessão
  lastUserId = userId;
  renderApp();
});
