-- Minha Folga — 003: decisão D1 (docs/DECISOES.md). WhatsApp e Bia 100% na Hal-AI; cadastro com CPF e empregador;
-- anti-robô próprio; placeholder de template da Hal-AI.
-- Migração ADITIVA: nenhuma tabela é removida; colunas novas são anuláveis e as restrições só são ampliadas, então a
-- release anterior continua funcionando sobre este esquema.
--
-- Tabelas que ficam SEM USO a partir desta release (mantidas para a release anterior e para histórico; a revisão de
-- retenção continua removendo os itens vencidos e a anonimização continua alcançando-as):
--   verification_challenges — códigos de confirmação por WhatsApp (cadastro e acesso às preferências) saíram.
-- webhook_events continua em uso (proteção contra replay das chamadas assinadas da Bia); a rota
-- /api/webhooks/whatsapp saiu. outbox_messages continua para o aviso interno de atendimento (webhook) e para o
-- placeholder de template da Hal-AI (canal 'halai'); itens antigos do canal 'whatsapp' são cancelados pelo worker.

-- Cadastro: dados úteis do formulário -------------------------------------------------------------------------
-- CPF, e-mail e empregador só cifrados (AES-256-GCM na aplicação, contexto por campo: lead.cpf:<id>,
-- lead.email:<id>, lead.employer:<id>). cpf_key = HMAC do CPF (chave de deduplicação, domínio 'cpf').
-- Dicas mascaradas para o painel e para o titular. Faixas e UF em claro (códigos de contracts/validation.json).
ALTER TABLE leads ADD COLUMN full_name text CHECK (full_name IS NULL OR char_length(full_name) BETWEEN 2 AND 120);
ALTER TABLE leads ADD COLUMN cpf_ciphertext text;
ALTER TABLE leads ADD COLUMN cpf_hint text;
ALTER TABLE leads ADD COLUMN cpf_key text;
ALTER TABLE leads ADD COLUMN email_ciphertext text;
ALTER TABLE leads ADD COLUMN email_hint text;
ALTER TABLE leads ADD COLUMN employer_ciphertext text;
ALTER TABLE leads ADD COLUMN job_tenure text CHECK (job_tenure IN ('menos_3_meses', '3_a_12_meses', '1_a_3_anos', 'mais_3_anos'));
ALTER TABLE leads ADD COLUMN income_range text CHECK (income_range IN ('ate_2000', '2000_a_4000', '4000_a_7000', 'acima_7000', 'nao_informar'));
ALTER TABLE leads ADD COLUMN city text CHECK (city IS NULL OR char_length(city) BETWEEN 1 AND 80);
ALTER TABLE leads ADD COLUMN uf text CHECK (uf IN ('AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'));
-- Um CPF pertence a no máximo um cadastro ativo (a anonimização apaga a chave).
CREATE UNIQUE INDEX leads_cpf_key_idx ON leads (cpf_key) WHERE cpf_key IS NOT NULL;
CREATE INDEX leads_uf_idx ON leads (uf);

-- Trilha do titular: dados cadastrais alterados (sem valores) e submissão guardada para revisão.
ALTER TABLE lead_events DROP CONSTRAINT lead_events_event_type_check;
ALTER TABLE lead_events ADD CONSTRAINT lead_events_event_type_check CHECK (event_type IN ('state_changed', 'preference_changed', 'verification_requested', 'contact_verified', 'interest_updated', 'anonymized', 'invited', 'profile_updated', 'submission_held'));

-- Submissões que NÃO sobrescrevem um cadastro existente -----------------------------------------------------------
-- O site não altera cadastro existente (telefone ou CPF já cadastrados): a nova submissão fica aqui, cifrada
-- (contexto lead_submission:<id>), para revisão da equipe de privacidade. Também guarda as submissões da Bia que
-- precisam de revisão (CPF de outro cadastro, CPF diferente do cadastrado, número suprimido).
CREATE TABLE lead_submissions (
  id uuid PRIMARY KEY,
  lead_id uuid REFERENCES leads (id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('site', 'bia')),
  source text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('existing_phone', 'existing_cpf', 'existing_phone_and_cpf', 'cpf_conflict', 'cpf_mismatch', 'suppressed')),
  phone_key text,
  cpf_key text,
  payload_ciphertext text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'applied', 'discarded')),
  created_at timestamptz NOT NULL,
  reviewed_at timestamptz
);
CREATE INDEX lead_submissions_lead_idx ON lead_submissions (lead_id, created_at);
CREATE INDEX lead_submissions_phone_key_idx ON lead_submissions (phone_key);
CREATE INDEX lead_submissions_cpf_key_idx ON lead_submissions (cpf_key);
CREATE INDEX lead_submissions_created_idx ON lead_submissions (created_at);

-- Anti-robô próprio ------------------------------------------------------------------------------------------------
-- Token do formulário é de uso único: o hash (sha256) fica gravado até a validade do token acabar.
CREATE TABLE form_token_uses (
  token_hash text PRIMARY KEY,
  purpose text NOT NULL CHECK (purpose IN ('waitlist', 'opt_out')),
  used_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX form_token_uses_expires_idx ON form_token_uses (expires_at);

-- Submissões aceitas, para os limites por IP (HMAC da rede de origem), CPF e telefone (HMAC). Sem dado em claro;
-- itens com mais de 2 dias são removidos (limpeza oportunista e revisão de retenção).
CREATE TABLE form_attempts (
  id uuid PRIMARY KEY,
  purpose text NOT NULL CHECK (purpose IN ('waitlist', 'opt_out')),
  ip_key text NOT NULL,
  cpf_key text,
  phone_key text,
  created_at timestamptz NOT NULL
);
CREATE INDEX form_attempts_ip_idx ON form_attempts (purpose, ip_key, created_at);
CREATE INDEX form_attempts_cpf_idx ON form_attempts (purpose, cpf_key, created_at);
CREATE INDEX form_attempts_phone_idx ON form_attempts (purpose, phone_key, created_at);

-- Outbox: canal da Hal-AI (placeholder de template) ----------------------------------------------------------------
-- recipient_key = HMAC do telefone (mesma chave da deduplicação): "no máximo um template por número em 30 dias".
ALTER TABLE outbox_messages DROP CONSTRAINT outbox_messages_kind_check;
ALTER TABLE outbox_messages ADD CONSTRAINT outbox_messages_kind_check CHECK (kind IN ('verification_code', 'preferences_link', 'launch_notice', 'marketing', 'support_notification', 'support_reply', 'halai_template'));
ALTER TABLE outbox_messages DROP CONSTRAINT outbox_messages_channel_check;
ALTER TABLE outbox_messages ADD CONSTRAINT outbox_messages_channel_check CHECK (channel IN ('whatsapp', 'webhook', 'halai'));
ALTER TABLE outbox_messages ADD COLUMN recipient_key text;
CREATE INDEX outbox_recipient_key_idx ON outbox_messages (kind, recipient_key, created_at);
CREATE INDEX outbox_kind_created_idx ON outbox_messages (kind, created_at);
