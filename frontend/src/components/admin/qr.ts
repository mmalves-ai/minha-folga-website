/**
 * QR do autenticador: o servidor gera o SVG e o painel o exibe como imagem (data URL base64),
 * nunca como HTML inline — um <img> não executa scripts nem estilos do documento.
 */
export function svgToDataUrl(svg: string): string | null {
  const text = svg.trim()
  if (!/^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)) return null
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return `data:image/svg+xml;base64,${btoa(binary)}`
}

/** Chave em blocos de 4 para digitação manual (sem alterar o valor). */
export function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ')
}

/** Dados do otpauth:// para orientar a pessoa (emissor e período). */
export function otpauthInfo(url: string): { issuer: string | null; period: number } {
  try {
    const u = new URL(url)
    const period = Number(u.searchParams.get('period') ?? '30')
    return { issuer: u.searchParams.get('issuer'), period: Number.isFinite(period) && period > 0 ? period : 30 }
  } catch {
    return { issuer: null, period: 30 }
  }
}
