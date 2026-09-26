import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Cada arquivo cria o próprio banco PGlite em memória; o isolamento por arquivo é suficiente.
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
