// Converte um apelido em um "e-mail" sintetico, so pra usar como identificador
// unico de login no Supabase Auth -- nunca e enviado nem exibido de verdade.
const DIACRITICS = /[̀-ͯ]/g;

export function nicknameToEmail(nickname) {
  const slug = (nickname || '')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return slug + '@jogadores.local';
}

// O Supabase exige senha com pelo menos 6 caracteres. Como aqui a ideia é
// senha curta e simples (tipo um PIN), completamos por trás dos panos com um
// sufixo fixo antes de mandar pro Supabase -- quem usa o app nunca vê isso,
// digita sempre só a senha curta mesmo.
const PASSWORD_PAD = '-cave9x';

export function padPassword(password) {
  return (password || '') + PASSWORD_PAD;
}
