const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' })
const dateLongFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
})

/** Datas "AAAA-MM-DD" do conteúdo são datas civis: interpretadas ao meio-dia para não trocar o dia por fuso. */
function toDate(value: string | Date): Date {
  if (value instanceof Date) return value
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00-03:00`) : new Date(value)
}

export const formatDate = (v: string | Date) => dateFmt.format(toDate(v))
export const formatDateLong = (v: string | Date) => dateLongFmt.format(toDate(v))
export const formatDateTime = (v: string | Date) => dateTimeFmt.format(toDate(v))

export function formatCnpj(v: string): string {
  const d = v.replace(/\D/g, '')
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : v
}

export function formatPhoneBr(e164: string): string {
  const d = e164.replace(/\D/g, '').replace(/^55/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return e164
}

/** Normalização para busca local: minúsculas, sem acentos e pontuação. */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const listFmt = new Intl.ListFormat('pt-BR', { style: 'long', type: 'conjunction' })

/** Lista em português: "A", "A e B", "A, B e C". */
export const formatList = (items: string[]) => listFmt.format(items)
