import './styles/theme.css';
import './styles/auth.css';
import { supabase } from './supabaseClient.js';
import { renderApp } from './router.js';

document.querySelector('#app').classList.add('wrap');

supabase.auth.onAuthStateChange(() => renderApp());
renderApp();
