import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { flowMapIssue, flowMapKeysWithoutValue } from './content-plugin'

const CONTENT_DIR = fileURLToPath(new URL('../content', import.meta.url))

function contentFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? contentFiles(join(dir, e.name)) : /\.(yaml|md)$/.test(e.name) ? [join(dir, e.name)] : [],
  )
}

describe('texto com vírgula sem aspas em mapa em linha', () => {
  it('encontra a chave espúria criada pela vírgula e a linha dela', () => {
    const source = 'links:\n  - { label: A Minha Folga, to: /sobre }\n  - { label: Bia, nossa IA, to: /bia }\n'
    expect(flowMapKeysWithoutValue(source)).toEqual([{ key: 'nossa IA', line: 3 }])
  })

  it('aceita valores com aspas, nulos explícitos, textos em bloco e listas em linha', () => {
    const source = [
      "a: { label: 'Bia, nossa IA', to: /bia }",
      'b: { approvedAt: null, approvedBy: ~, note: }',
      'c: A solicitação foi concluída. Se precisar, abra uma nova solicitação.',
      'd: [home, consignado]',
      'e: { text: "Uma frase, com vírgula." }',
    ].join('\n')
    expect(flowMapKeysWithoutValue(source)).toEqual([])
  })

  it('também confere o front matter dos Markdown, com a linha contada no arquivo', () => {
    const md = '---\ntitle: Artigo\nsources:\n  - { label: Banco Central, CET, url: https://www.bcb.gov.br }\n---\nCorpo, com vírgula.\n'
    expect(flowMapIssue('articles/x.md', md)).toMatch(/linha 4, "CET"/)
    expect(flowMapIssue('articles/y.md', '---\ntitle: Ok\n---\nTexto { a, b } no corpo não é YAML.\n')).toBeNull()
  })

  it('nenhum arquivo de conteúdo tem texto truncado por vírgula sem aspas', () => {
    const issues = contentFiles(CONTENT_DIR)
      .map((file) => flowMapIssue(relative(CONTENT_DIR, file), readFileSync(file, 'utf8')))
      .filter(Boolean)
    expect(issues).toEqual([])
  })
})
