# Inventário RPG — multiplayer

Site estático (Vite + JS puro + Supabase) pra um grupo de RPG gerenciar inventário de personagens, com mestre e jogadores. Hospedado no GitHub Pages, dados no Supabase (Postgres + Auth + Realtime).

## Fases

- **Fase 1:** setup do projeto, login/cadastro, criação de campanha com código de convite, entrada via código, deploy no GitHub Pages. ✅
- **Fase 2a:** inventário pessoal ([`src/screens/character.js`](src/screens/character.js)) — itens, recipientes aninhados, equipados, moedas, temas, desfazer, log, busca, seleção em lote, cópia formatada. Um blob JSON por personagem em `characters.data`. ✅
- **Fase 2b (atual):** área pública ([`src/screens/publicArea.js`](src/screens/publicArea.js)) — compartimentos, recipientes e itens em tabelas relacionais de verdade, com Realtime (qualquer mudança aparece pros outros jogadores na hora). Botão "🚐 Baú compartilhado" na tela de personagem. Mestre concede `is_transport_admin` a um jogador; mestre/admin do baú criam compartimentos e concedem/revogam acesso por compartimento a jogadores específicos — quem não tem acesso vê o conteúdo (🔒 trancado) mas não mexe. Mover item entre Espaço Pessoal ↔ Público funciona nos dois sentidos. Transferência de moeda entre Pessoal/Avulso/compartimentos (só mostra compartimentos que você tem acesso, pra não travar a transferência no meio).
- **Fase 2b — pendente de teste ao vivo:** essa fase foi construída e revisada linha a linha, mas o teste de ponta a ponta com múltiplas contas (mestre + jogador + admin do baú) esbarrou no limite de e-mails de teste do Supabase (rate limit do provedor de e-mail padrão) antes de terminar. Vale testar na prática assim que possível — especialmente drag-and-drop entre compartimentos trancados/destrancados e a transferência de moeda.
- **Fase 3:** bot do Discord via Database Webhook + Edge Function.
- **Painel de super-admin** ([`src/screens/admin.js`](src/screens/admin.js)): fora da numeração de fases — é uma conta especial (`profiles.is_superadmin`), independente de qualquer campanha, que vê/cria/apaga todas as campanhas do sistema e abre o inventário de qualquer jogador (com edição e atualização ao vivo via Realtime). Só quem tiver essa flag marcada direto no banco cai nesse painel; ver `db/005_patch_superadmin.sql`.
- **Login por apelido + conta mestre** (substitui o cadastro por e-mail/código de convite): não há mais auto-cadastro nem confirmação de e-mail. Um único mestre (conta `Mestre`, veja abaixo) cria campanhas e contas de jogador (apelido + senha curta) já vinculadas a uma campanha específica; o jogador loga com apelido/senha e cai direto no personagem da campanha dele, sem código de convite. Ver [`src/nickname.js`](src/nickname.js) (apelido → e-mail sintético `@jogadores.local` + preenchimento de senha curta), [`src/auth.js`](src/auth.js) e a função `complete_player_account()` em `db/006_patch_player_account_creation.sql`.

## Setup do banco (Supabase)

No SQL Editor do seu projeto Supabase, rode **nesta ordem**:

1. [`db/schema.sql`](db/schema.sql) — tabelas, RLS e Realtime.
2. [`db/001_patch_auth_flow.sql`](db/001_patch_auth_flow.sql) — corrige políticas de RLS que faltavam para o fluxo de cadastro/onboarding funcionar (o schema original não tinha política de INSERT em `campaigns`/`profiles`; ver comentário no topo do arquivo).
3. [`db/002_patch_rls_recursion.sql`](db/002_patch_rls_recursion.sql) — corrige recursão infinita ("stack depth limit exceeded") nas funções auxiliares de RLS (`current_campaign_id`, `is_master`, etc.), que consultavam `profiles` sem `SECURITY DEFINER` dentro de uma política da própria `profiles`.
4. [`db/003_patch_ambiguous_column.sql`](db/003_patch_ambiguous_column.sql) — corrige "column reference campaign_id is ambiguous" em `create_campaign()`: a coluna de retorno `campaign_id` colidia com a coluna de mesmo nome em `profiles`.
5. [`db/004_patch_ambiguous_column_v2.sql`](db/004_patch_ambiguous_column_v2.sql) — a colisão do patch anterior também acontecia em `on conflict (campaign_id)` (não só na cláusula que eu tinha corrigido). A correção definitiva renomeia as colunas de retorno da função pra não colidir com nenhuma coluna de tabela. **Este patch usa `DROP FUNCTION` antes de recriar — rode as duas instruções (`drop function ...` e o resto) uma de cada vez, não junto**, porque se a segunda falhar dentro da mesma execução o banco desfaz o DROP também.
6. [`db/005_patch_superadmin.sql`](db/005_patch_superadmin.sql) — cria a flag `profiles.is_superadmin`, as políticas de RLS que deixam um super-admin ver/criar/editar/apagar qualquer campanha, perfil ou personagem, e habilita Realtime em `characters`. Depois de rodar, marque sua própria conta como super-admin (troque o e-mail):
   ```sql
   insert into profiles (id, username, role, is_superadmin)
   select id, 'Admin', 'master', true from auth.users where email = 'seu-email@exemplo.com'
   on conflict (id) do update set is_superadmin = true;
   ```
7. [`db/006_patch_player_account_creation.sql`](db/006_patch_player_account_creation.sql) — cria `complete_player_account()`, usada pelo mestre pra criar contas de jogador já vinculadas a uma campanha (não há política de INSERT direta em `profiles`/`characters` pra isso, só via função `SECURITY DEFINER`, mesmo padrão do patch 1).

A chave usada no cliente é a **publishable key** (`sb_publishable_...`, em Settings → API), configurada em [`src/config.js`](src/config.js). Ela não é secreta — todo o acesso é controlado por RLS no banco.

### Login por apelido — configuração obrigatória

Esse projeto não usa e-mail de verdade nem auto-cadastro. É preciso:

1. Em **Authentication → Sign In / Providers → Email**, desativar **"Confirm email"** (senão o `signUp()` interno de criação de conta de jogador vai exigir confirmação que nunca chega, já que os e-mails são sintéticos `@jogadores.local`).
2. Criar a conta mestre manualmente (nickname `Mestre`, senha à sua escolha) — via console do navegador com o app aberto, chame `supabase.auth.signUp({ email: 'mestre@jogadores.local', password: 'suasenha-cave9x' })` (o sufixo `-cave9x` é o `PASSWORD_PAD` de `src/nickname.js`), depois rode:
   ```sql
   insert into profiles (id, username, role, is_superadmin)
   select id, 'Mestre', 'master', true from auth.users where email = 'mestre@jogadores.local'
   on conflict (id) do update set is_superadmin = true, username = 'Mestre', role = 'master';
   ```
   Depois disso, o mestre loga normalmente pela tela de login (apelido `Mestre` + a senha escolhida) e cai direto no painel — dali ele cria campanhas e contas de jogador pela própria UI.

## Rodando localmente

```bash
npm install
npm run dev
```

## Deploy

Push para `main`/`master` dispara [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), que builda com Vite e publica no GitHub Pages.

**Configuração única no repositório** (Settings → Pages): em "Build and deployment" → "Source", selecione **GitHub Actions** (não "Deploy from a branch").

O `base` em [`vite.config.js`](vite.config.js) está fixo em `/CaveInventory/`, condizente com a URL `https://<seu-usuario>.github.io/CaveInventory/`.
