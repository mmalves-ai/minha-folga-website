import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { MIGRATIONS_DIR } from '../src/config/paths.js'
import { createDatabase } from '../src/db/database.js'
import { migrate, pendingMigrations } from '../src/db/migrate.js'

it('002 aplica sobre um banco que já tem a 001 e dados: backfill dos envios de código e padrões novos', async () => {
  const onlyFirst = mkdtempSync(join(tmpdir(), 'mf-mig-'))
  copyFileSync(join(MIGRATIONS_DIR, '001_initial.sql'), join(onlyFirst, '001_initial.sql'))
  const db = await createDatabase('pglite://memory')
  try {
    expect((await migrate(db, onlyFirst)).applied).toEqual(['001_initial'])
    expect(await pendingMigrations(db)).toEqual(['002_limits_and_links', '003_d1_cadastro_halai', '004_interruptor_e_revisao', '005_web_push'])
    const real = randomUUID()
    const blind = randomUUID()
    for (const [id, hash, sends] of [
      [real, 'hmac-do-codigo', 2],
      [blind, '!blind:marcador', 3],
    ] as const) {
      await db.query(
        `INSERT INTO verification_challenges (id, purpose, dedup_key, code_hash, expires_at, max_attempts, sends)
         VALUES ($1, 'waitlist', 'chave', $2, now(), 5, $3)`,
        [id, hash, sends],
      )
    }
    await db.query("INSERT INTO admin_users (id, email, display_name, role, password_hash) VALUES ($1, 'a@equipe.test', 'A', 'admin', 'h')", [
      randomUUID(),
    ])

    const second = await migrate(db)
    expect(second).toEqual({ applied: ['002_limits_and_links', '003_d1_cadastro_halai', '004_interruptor_e_revisao', '005_web_push'], alreadyApplied: ['001_initial'] })
    const rows = await db.query('SELECT id, codes_sent, code_send, origin_hash FROM verification_challenges ORDER BY sends')
    expect(rows.rows).toEqual([
      { id: real, codes_sent: 2, code_send: 2, origin_hash: null },
      { id: blind, codes_sent: 0, code_send: null, origin_hash: null },
    ])
    const user = await db.query('SELECT mfa_failed_count, mfa_failed_since FROM admin_users')
    expect(user.rows[0]).toEqual({ mfa_failed_count: 0, mfa_failed_since: null })
    expect(await pendingMigrations(db)).toEqual([])
  } finally {
    await db.close()
    rmSync(onlyFirst, { recursive: true, force: true })
  }
})

it('003 (D1) é aditiva: dados da release anterior continuam válidos e as restrições só foram ampliadas', async () => {
  const upTo2 = mkdtempSync(join(tmpdir(), 'mf-mig-'))
  for (const f of ['001_initial.sql', '002_limits_and_links.sql']) copyFileSync(join(MIGRATIONS_DIR, f), join(upTo2, f))
  const db = await createDatabase('pglite://memory')
  try {
    await migrate(db, upTo2)
    const lead = randomUUID()
    await db.query(
      `INSERT INTO leads (id, preferred_name, phone_ciphertext, phone_hint, dedup_key, employment_type, age_confirmed, state, source, privacy_notice_version)
       VALUES ($1, 'Ana', 'cifra', 'dica', 'chave-antiga', 'clt', true, 'waiting', 'avise-me', '1.0')`,
      [lead],
    )
    await db.query(
      `INSERT INTO outbox_messages (id, kind, channel, purpose, payload_ciphertext, idempotency_key, status)
       VALUES ($1, 'verification_code', 'whatsapp', 'transactional', 'x', 'legado', 'pending')`,
      [randomUUID()],
    )
    expect((await migrate(db)).applied).toEqual(['003_d1_cadastro_halai', '004_interruptor_e_revisao', '005_web_push'])
    // Linha antiga continua lá, com as colunas novas vazias.
    const row = await db.query<Record<string, unknown>>('SELECT state, full_name, cpf_key, uf FROM leads WHERE id = $1', [lead])
    expect(row.rows[0]).toEqual({ state: 'waiting', full_name: null, cpf_key: null, uf: null })
    // Restrições ampliadas: canal halai, template e eventos novos aceitos; valores fora da lista continuam recusados.
    await db.query(
      `INSERT INTO outbox_messages (id, kind, channel, purpose, payload_ciphertext, idempotency_key, status, recipient_key)
       VALUES ($1, 'halai_template', 'halai', 'launch_notice', 'x', 'novo', 'pending', 'k')`,
      [randomUUID()],
    )
    await db.query(`INSERT INTO lead_events (id, lead_id, event_type, source, actor_type) VALUES ($1, $2, 'submission_held', 'avise-me', 'titular')`, [randomUUID(), lead])
    await expect(db.query(`UPDATE leads SET uf = 'XX' WHERE id = $1`, [lead])).rejects.toThrow()
    await expect(db.query(`UPDATE leads SET income_range = 'muito' WHERE id = $1`, [lead])).rejects.toThrow()
    // CPF único entre cadastros com chave.
    await db.query(`UPDATE leads SET cpf_key = 'cpf-1' WHERE id = $1`, [lead])
    await expect(
      db.query(
        `INSERT INTO leads (id, preferred_name, phone_ciphertext, phone_hint, dedup_key, cpf_key, employment_type, age_confirmed, state, source, privacy_notice_version)
         VALUES ($1, 'Bia', 'c', 'd', 'outra-chave', 'cpf-1', 'clt', true, 'received', 'bia', '1.1')`,
        [randomUUID()],
      ),
    ).rejects.toThrow()
    // Tabelas antigas não foram removidas.
    const tables = await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
    const names = tables.rows.map((t) => t.table_name)
    for (const t of ['verification_challenges', 'webhook_events', 'lead_submissions', 'form_token_uses', 'form_attempts']) expect(names, t).toContain(t)
    // 004: interruptor do formulário (só chaves conhecidas).
    await db.query(`INSERT INTO app_settings (key, value, updated_at) VALUES ('waitlist_form_paused', 'true', now())`)
    await expect(db.query(`INSERT INTO app_settings (key, value, updated_at) VALUES ('outra', 'x', now())`)).rejects.toThrow()
  } finally {
    await db.close()
    rmSync(upTo2, { recursive: true, force: true })
  }
})
