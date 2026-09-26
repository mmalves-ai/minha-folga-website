export type EditorialPhoto = 'planning' | 'conversation' | 'bia'
export function articlePhoto(slug: string): EditorialPhoto {
  if (slug === 'como-funciona-desconto-em-folha') return 'bia'
  if (slug === 'antes-de-contratar-credito' || slug === 'o-que-e-cet') return 'conversation'
  return 'planning'
}
