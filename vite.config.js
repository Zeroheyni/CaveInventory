import { defineConfig } from 'vite';

// Identificador desta versão do site: vai embutido no JS (__BUILD_ID__) e também em version.json (publicado junto).
// src/versionCheck.js compara os dois: se o site foi atualizado enquanto a aba estava aberta, avisa pra recarregar.
const BUILD_ID = String(Date.now());

export default defineConfig({
  base: '/CaveInventory/',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    {
      name: 'emit-version-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) });
      },
    },
  ],
});
