/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SITE_URL: string
  /** Derivada pelo build de MF_INDEXABLE; não configurar manualmente. */
  readonly VITE_SITE_INDEXABLE: '0' | '1'
  readonly VITE_API_BASE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

/** Arquivos YAML de content/: campos `_md` chegam como HTML seguro (markdown-it sem HTML bruto). */
declare module '*.yaml' {
  const data: any
  export default data
}

/** Páginas legais em Markdown: { meta, html }. */
declare module '@content/legal/*.md' {
  const doc: { meta: Record<string, any>; html: string }
  export default doc
}

declare module 'virtual:mf-articles' {
  import type { Article } from '@/types/content'
  const articles: Article[]
  export default articles
}

declare module 'virtual:mf-public-config' {
  import type { PublicConfig } from '@/types/public-config'
  const config: PublicConfig
  export default config
}
