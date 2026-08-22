# Inventário RPG — multiplayer

Site estático (Vite + JS puro + Supabase) pra um grupo de RPG gerenciar inventário de personagens, com mestre e jogadores. Hospedado no GitHub Pages, dados no Supabase (Postgres + Auth + Realtime).

## Fases

- **Fase 1 (atual):** setup do projeto, login/cadastro, criação de campanha com código de convite, entrada via código, deploy no GitHub Pages.
- **Fase 2:** portar a UI de inventário pessoal e a área pública (com Realtime), permissões de compartimento.
- **Fase 3:** bot do Discord via Database Webhook + Edge Function.

## Setup do banco (Supabase)

No SQL Editor do seu projeto Supabase, rode **nesta ordem**:

1. [`db/schema.sql`](db/schema.sql) — tabelas, RLS e Realtime.
2. [`db/001_patch_auth_flow.sql`](db/001_patch_auth_flow.sql) — corrige políticas de RLS que faltavam para o fluxo de cadastro/onboarding funcionar (o schema original não tinha política de INSERT em `campaigns`/`profiles`; ver comentário no topo do arquivo).

A chave usada no cliente é a **publishable key** (`sb_publishable_...`, em Settings → API), configurada em [`src/config.js`](src/config.js). Ela não é secreta — todo o acesso é controlado por RLS no banco.

> Se o seu projeto Supabase exigir confirmação de e-mail (padrão), confirme o e-mail antes de tentar entrar após criar a conta — ou desative "Confirm email" em Authentication → Providers → Email pra testar mais rápido.

## Rodando localmente

```bash
npm install
npm run dev
```

## Deploy

Push para `main`/`master` dispara [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), que builda com Vite e publica no GitHub Pages.

**Configuração única no repositório** (Settings → Pages): em "Build and deployment" → "Source", selecione **GitHub Actions** (não "Deploy from a branch").

O `base` em [`vite.config.js`](vite.config.js) está fixo em `/CaveInventory/`, condizente com a URL `https://<seu-usuario>.github.io/CaveInventory/`.
