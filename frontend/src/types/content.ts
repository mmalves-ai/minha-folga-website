export interface LinkItem {
  label: string
  to: string
}

export interface ChatMessage {
  from: 'person' | 'bia'
  text: string
}

export interface ArticleSource {
  title: string
  publisher: string
  url: string
  accessedAt: string
}

export interface Article {
  slug: string
  order?: number
  title: string
  summary: string
  category: string
  author: string
  draftedAt: string
  publishedAt: string | null
  review: { status: 'pending' | 'approved'; reviewedAt: string | null; reviewer: string | null }
  sources: ArticleSource[]
  related: string[]
  cta: 'bia' | 'ajuda'
  seo?: { title?: string; description?: string }
  words: number
  readingMinutes: number
  headings: { id: string; text: string }[]
  /** HTML seguro (markdown-it sem HTML bruto). */
  html: string
}

export interface FaqItem {
  id: string
  category: string
  showOn: string[]
  question: string
  /** HTML seguro. */
  answer_md: string
  related: LinkItem[]
}

export interface FaqBase {
  categories: { id: string; label: string }[]
  items: FaqItem[]
}
