import { supabase } from './supabaseClient.js';
import { nicknameToEmail, padPassword } from './nickname.js';

export function signIn(nickname, password) {
  // quem tem conta com e-mail de verdade (ex.: o ADM antigo) pode digitar o e-mail inteiro no lugar do apelido
  const email = String(nickname || '').includes('@') ? String(nickname).trim().toLowerCase() : nicknameToEmail(nickname);
  return supabase.auth.signInWithPassword({ email, password: padPassword(password) });
}

export function signOut() {
  return supabase.auth.signOut();
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}

// Enquanto o mestre cria uma conta de jogador, a sessão do navegador troca
// brevemente pro usuário novo (signUp) e depois volta pra do mestre --
// sem isso o listener de auth em main.js re-renderiza a tela inteira nesse
// meio-tempo, perdendo o estado da UI (ex: banner de conta criada).
let rerenderSuppressed = false;

export function setRerenderSuppressed(value) {
  rerenderSuppressed = value;
}

export function isRerenderSuppressed() {
  return rerenderSuppressed;
}
