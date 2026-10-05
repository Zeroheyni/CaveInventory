// Gestão de CONTAS (auth.users) -- única coisa que o navegador não pode fazer sozinho (precisa de service role).
// Substitui o truque antigo de trocar a sessão do navegador pra criar conta de jogador (e some a senha em texto).
//
// Quem pode o quê (sempre validado AQUI, com o JWT do chamador; nunca confia no cliente):
//   ADM                 create_master, create_player (qualquer campanha), reset_password (qualquer um),
//                       set_account_kind, delete_account
//   Mestre              create_player (conta de jogador SEM mesa; campaign_id é opcional e, se vier, tem que ser mesa DELE),
//                       reset_password (jogadores das mesas DELE ou contas ainda sem mesa)
//   Jogador             nada
// O papel dentro de cada campanha vem de campaign_members (db/062); profiles.role = 'master' | 'player' é só o
// TIPO da conta (conta de mestre pode criar campanhas).
//
// Autocontido de propósito (sem ../_shared): o editor do Dashboard não enxerga fora da pasta da function.
// "Verify JWT" fica LIGADO (é chamada pelo app com o JWT do usuário).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ---- mesma lógica de src/nickname.js ----
const DIACRITICS = /[̀-ͯ]/g;
function nicknameToEmail(nickname: string): string {
  const slug = (nickname || '')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return slug + '@jogadores.local';
}
const PASSWORD_PAD = '-cave9x';
const padPassword = (p: string) => (p || '') + PASSWORD_PAD;

function validateCredentials(nickname: unknown, password: unknown): string | null {
  if (typeof nickname !== 'string' || nickname.trim().length < 2 || nickname.trim().length > 30) {
    return 'o apelido precisa ter de 2 a 30 caracteres';
  }
  if (nicknameToEmail(nickname) === '@jogadores.local') return 'o apelido precisa ter pelo menos uma letra ou número';
  if (typeof password !== 'string' || password.length < 4 || password.length > 64) {
    return 'a senha precisa ter de 4 a 64 caracteres';
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'método não permitido' });

  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- quem está chamando ----
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'não autenticado' });
  const { data: userData, error: userErr } = await svc.auth.getUser(authHeader.slice('Bearer '.length));
  if (userErr || !userData?.user) return json(401, { error: 'sessão inválida' });
  const { data: me } = await svc.from('profiles').select('id, role, is_superadmin').eq('id', userData.user.id).maybeSingle();
  if (!me) return json(403, { error: 'conta sem perfil' });
  const isAdmin = !!me.is_superadmin;

  async function isMasterOf(campaignId: string): Promise<boolean> {
    if (isAdmin) return true;
    const { data: camp } = await svc.from('campaigns').select('master_id').eq('id', campaignId).maybeSingle();
    if (camp?.master_id === me!.id) return true;
    const { data: m } = await svc
      .from('campaign_members')
      .select('role')
      .eq('campaign_id', campaignId)
      .eq('user_id', me!.id)
      .maybeSingle();
    return m?.role === 'master';
  }

  async function isAnyMaster(): Promise<boolean> {
    if (isAdmin || me!.role === 'master') return true;
    const { count: a } = await svc.from('campaign_members').select('campaign_id', { count: 'exact', head: true }).eq('user_id', me!.id).eq('role', 'master');
    if ((a ?? 0) > 0) return true;
    const { count: b } = await svc.from('campaigns').select('id', { count: 'exact', head: true }).eq('master_id', me!.id);
    return (b ?? 0) > 0;
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch (_) {
    return json(400, { error: 'corpo inválido' });
  }
  const action = String(body.action ?? '');

  // cria a conta no Auth + perfil; desfaz a conta se o perfil falhar (nada de conta órfã)
  async function createAccount(nickname: string, password: string, kind: 'master' | 'player') {
    const bad = validateCredentials(nickname, password);
    if (bad) return { error: bad, status: 400 };
    const email = nicknameToEmail(nickname);
    const { data: created, error: cErr } = await svc.auth.admin.createUser({
      email,
      password: padPassword(password),
      email_confirm: true,
    });
    if (cErr || !created?.user) {
      const dup = /already|registered|exists/i.test(cErr?.message ?? '');
      return { error: dup ? 'já existe uma conta com esse apelido' : (cErr?.message ?? 'não consegui criar a conta'), status: dup ? 409 : 400 };
    }
    const id = created.user.id;
    const { error: pErr } = await svc.from('profiles').upsert({ id, username: nickname.trim(), role: kind }, { onConflict: 'id' });
    if (pErr) {
      await svc.auth.admin.deleteUser(id);
      return { error: 'não consegui criar o perfil: ' + pErr.message, status: 500 };
    }
    return { id, status: 200 };
  }

  try {
    switch (action) {
      case 'create_master': {
        if (!isAdmin) return json(403, { error: 'só o ADM cria contas de mestre' });
        const r = await createAccount(String(body.nickname ?? ''), String(body.password ?? ''), 'master');
        return r.error ? json(r.status, { error: r.error }) : json(200, { ok: true, id: r.id });
      }

      case 'create_player': {
        // conta de jogador não é vinculada a mesa; quem vincula à mesa é o personagem (db/069)
        const campaignId = String(body.campaign_id ?? '');
        if (campaignId) {
          if (!(await isMasterOf(campaignId))) return json(403, { error: 'só o mestre da campanha cria jogadores nela' });
        } else if (!(await isAnyMaster())) {
          return json(403, { error: 'só mestre ou ADM cria contas de jogador' });
        }
        const r = await createAccount(String(body.nickname ?? ''), String(body.password ?? ''), 'player');
        if (r.error) return json(r.status, { error: r.error });
        const { error: mErr } = campaignId
          ? await svc.from('campaign_members').insert({ campaign_id: campaignId, user_id: r.id, role: 'player' })
          : { error: null };
        if (mErr) {
          await svc.auth.admin.deleteUser(r.id!);
          return json(500, { error: 'não consegui vincular à campanha: ' + mErr.message });
        }
        return json(200, { ok: true, id: r.id });
      }

      case 'reset_password': {
        const userId = String(body.user_id ?? '');
        const password = String(body.password ?? '');
        if (!userId) return json(400, { error: 'faltou a conta' });
        if (password.length < 4 || password.length > 64) return json(400, { error: 'a senha precisa ter de 4 a 64 caracteres' });
        if (!isAdmin) {
          // mestre: só conta de JOGADOR que seja membro de uma campanha dele
          const { data: target } = await svc.from('profiles').select('role, is_superadmin').eq('id', userId).maybeSingle();
          if (!target || target.is_superadmin || target.role !== 'player') return json(403, { error: 'sem permissão pra mexer nessa conta' });
          const { data: shared } = await svc.from('campaign_members').select('campaign_id').eq('user_id', userId);
          // conta ainda sem mesa (recém-criada): qualquer mestre pode ajustar a senha
          let allowed = (shared ?? []).length === 0 && (await isAnyMaster());
          for (const row of shared ?? []) {
            if (await isMasterOf(row.campaign_id)) { allowed = true; break; }
          }
          if (!allowed) return json(403, { error: 'essa conta não é de uma mesa sua' });
        }
        const { error } = await svc.auth.admin.updateUserById(userId, { password: padPassword(password) });
        return error ? json(400, { error: error.message }) : json(200, { ok: true });
      }

      case 'set_account_kind': {
        if (!isAdmin) return json(403, { error: 'só o ADM muda o tipo da conta' });
        const userId = String(body.user_id ?? '');
        const kind = String(body.kind ?? '');
        if (!userId || !['master', 'player'].includes(kind)) return json(400, { error: 'pedido inválido' });
        if (userId === me.id) return json(400, { error: 'não dá pra mudar o tipo da própria conta' });
        const { error } = await svc.from('profiles').update({ role: kind }).eq('id', userId);
        return error ? json(400, { error: error.message }) : json(200, { ok: true });
      }

      case 'delete_account': {
        if (!isAdmin) return json(403, { error: 'só o ADM exclui contas' });
        const userId = String(body.user_id ?? '');
        if (!userId) return json(400, { error: 'faltou a conta' });
        if (userId === me.id) return json(400, { error: 'não dá pra excluir a própria conta' });
        const { data: target } = await svc.from('profiles').select('is_superadmin').eq('id', userId).maybeSingle();
        if (target?.is_superadmin) return json(403, { error: 'conta de ADM não se exclui por aqui' });
        // nunca apaga personagem junto: excluir a conta apagaria os personagens por cascade
        const { count: chars } = await svc.from('characters').select('id', { count: 'exact', head: true }).eq('owner_id', userId);
        if ((chars ?? 0) > 0) return json(409, { error: `essa conta ainda tem ${chars} personagem(ns) -- passe-os pra outra conta ou exclua antes` });
        const { count: owned } = await svc.from('campaigns').select('id', { count: 'exact', head: true }).eq('master_id', userId);
        if ((owned ?? 0) > 0) return json(409, { error: `essa conta é dona de ${owned} campanha(s) -- passe-as pra outro mestre antes` });
        const { error } = await svc.auth.admin.deleteUser(userId);
        return error ? json(400, { error: error.message }) : json(200, { ok: true });
      }

      default:
        return json(400, { error: 'ação desconhecida' });
    }
  } catch (err) {
    console.error(err);
    return json(500, { error: String(err) });
  }
});
