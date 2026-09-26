import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Caminhos derivados do local do módulo, válidos em `src/` (tsx) e em `dist/` (compilado).
 * Numa release, frontend/, backend/ e contracts/ ficam lado a lado: releases/<id>/{frontend,backend,contracts}.
 */
const here = dirname(fileURLToPath(import.meta.url))
export const BACKEND_ROOT = resolve(here, '../..')
export const REPO_ROOT = resolve(BACKEND_ROOT, '..')
export const CONTRACTS_DIR = resolve(REPO_ROOT, 'contracts')
export const FRONTEND_DIR = resolve(REPO_ROOT, 'frontend')
export const CONTENT_DIR = resolve(FRONTEND_DIR, 'content')
export const MIGRATIONS_DIR = resolve(BACKEND_ROOT, 'migrations')
