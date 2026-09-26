-- Minha Folga — 004: interruptor do formulário de cadastro do site pelo painel.
-- Migração ADITIVA: a release anterior continua funcionando sobre este esquema (não lê a tabela nova).
--
-- Chave única por configuração operacional; sem dado pessoal. Quem mudou e por quê ficam também na auditoria
-- (admin.waitlist_form_paused / admin.waitlist_form_resumed, com a justificativa).
CREATE TABLE app_settings (
  key text PRIMARY KEY CHECK (key IN ('waitlist_form_paused')),
  value text NOT NULL,
  updated_at timestamptz NOT NULL,
  updated_by uuid REFERENCES admin_users (id) ON DELETE SET NULL
);
