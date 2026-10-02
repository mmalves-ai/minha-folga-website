/// <reference types="vitest/config" />
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'
import { mfContent } from './build/content-plugin.ts'
import { renderSitemap } from './build/sitemap.ts'
import { renderRobots, seoBuildConfig } from './build/seo-config.ts'
import { ARTICLE_BASE, ROUTES } from './src/router/manifest.ts'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, r('.'), ['VITE_', 'MF_'])
  // Modo estrito (release pública): scripts/build.sh --release define MF_STRICT_RELEASE=1.
  const strict = env.MF_STRICT_RELEASE === '1'
  const publicConfigFile = env.MF_PUBLIC_CONFIG_FILE || r('./config/public-config.dev.json')
  const publicConfig = JSON.parse(readFileSync(publicConfigFile, 'utf8'))
  const { siteUrl, indexable } = seoBuildConfig(env, publicConfig)
  const apiTarget = env.MF_DEV_API_TARGET || 'http://127.0.0.1:3170'
  // Diretório de saída (padrão dist/). Permite builds de verificação em paralelo sem sobrescrever dist/.
  const outDir = env.MF_OUT_DIR || r('./dist')

  const articleSlugs = readdirSync(r('./content/articles'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
  const prerenderPaths = [
    ...ROUTES.filter((x) => x.prerender).map((x) => x.path),
    ...articleSlugs.map((s) => `${ARTICLE_BASE}/${s}`),
  ]
  const indexablePaths = [
    ...ROUTES.filter((x) => x.indexable).map((x) => x.path),
    ...articleSlugs.map((s) => `${ARTICLE_BASE}/${s}`),
  ]

  return {
    define: {
      'import.meta.env.VITE_SITE_URL': JSON.stringify(siteUrl),
      'import.meta.env.VITE_SITE_INDEXABLE': JSON.stringify(indexable ? '1' : '0'),
    },
    plugins: [
      mfContent({ contentDir: r('./content'), contractsDir: r('../contracts'), publicConfigFile, strict, siteUrl }),
      vue(),
    ],
    resolve: {
      alias: {
        '@': r('./src'),
        '@content': r('./content'),
        '@contracts': r('../contracts'),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 5180,
      strictPort: true,
      proxy: { '/api': { target: apiTarget, changeOrigin: false } },
      fs: { allow: [r('.'), r('../contracts')] },
    },
    build: {
      target: 'es2022',
      sourcemap: false,
      assetsInlineLimit: 0,
      cssCodeSplit: true,
      outDir,
      emptyOutDir: true,
    },
    // Testes de unidade (vitest). A suíte e2e (e2e/) roda com o Playwright, não com o vitest.
    test: {
      include: ['src/**/*.test.ts', 'build/**/*.test.ts', 'scripts/**/*.test.ts'],
      exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
      environment: 'node',
    },
    ssgOptions: {
      dirStyle: 'flat',
      script: 'async',
      formatting: 'none',
      beastiesOptions: false,
      includedRoutes: () => prerenderPaths,
      onFinished() {
        // <lastmod> só com datas reais de revisão/aprovação registradas no conteúdo (build/sitemap.ts).
        const notices = JSON.parse(readFileSync(r('../contracts/consents.json'), 'utf8')).notices
        writeFileSync(`${outDir}/sitemap.xml`, renderSitemap(siteUrl, indexablePaths, { contentDir: r('./content'), notices }))
        writeFileSync(`${outDir}/robots.txt`, renderRobots(siteUrl, indexable))
      },
    },
  }
})
