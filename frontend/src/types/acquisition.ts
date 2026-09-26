import type { ChatMessage } from './content'

/** Copy editorial compartilhada por home e landing; conteúdo em pages/aquisicao.yaml. */
export interface AcquisitionContent {
  hero: {
    eyebrow: string
    titleStart: string
    titleEnd: string
    titleAccentStart: string
    titleAccentEnd: string
    acquisitionTitle: string
    acquisitionTitleAccent: string
    lead: string
    acquisitionLead: string
    primaryCta: string
    closedCta: string
    biaCta: string
    note: string
    whyNow: string
    photoAlt: string
    caption: string
    captionAccent: string
    photoCredit: string
    valuesLabel: string
    values: { icon: 'phone' | 'spark' | 'list'; text: string }[]
  }
  value: {
    eyebrow: string; title: string; titleEnd: string; intro: string
    closedCta: string; photoCredit: string; note: string
    opportunities: { id: string; photo: 'planning' | 'aliviar-parcelas'; alt: string; tag: string; title: string; text: string; link: string; icon: 'home' | 'hand' }[]
  }
  mobileCta: { label: string; text: string; note: string }
  bia: {
    flowTitle: string
    flow: { icon: 'user' | 'spark' | 'chat' | 'check-circle'; title: string; text: string }[]
    eyebrow: string
    title: string
    titleMiddle: string
    titleAccent: string
    lead: string
    support: string
    webchatCta: string
    whatsappCta: string
    whatsappHint: string
    fallbackCta: string
    pending: string
    technology: { label: string; name: string }
    demo: { title: string; label: string; note: string; messages: ChatMessage[] }
  }
  steps: {
    eyebrow: string
    title: string
    link: string
    titleClosed: string
    first: { tag: string; tagClosed: string; title: string; text: string; textClosed: string }
    second: { tag: string; title: string; text: string }
    third: { tag: string; title: string; text: string }
    note: string
  }
  signup: {
    titleClosed: string
    titleAccentClosed: string
    leadClosed: string
    eyebrow: string
    title: string
    titleAccent: string
    lead: string
    reasons: string[]
    privacy: string
    privacyLink: string
    note: string
  }
  reason: {
    eyebrow: string; title: string; titleAccent: string; text: string
    cta: string; closedCta: string; note: string; question: string; answer: string
    guide: string; guideCta: string
  }
  trust: { title: string; cnpjLabel: string; pendingIdentity: string; aboutLink: string; supportLink: string }
  landing: {
    faq: { eyebrow: string; title: string; titleEnd: string; text: string; link: string }
    closing: { primaryCta: string; closedCta: string; note: string }
  }
}
