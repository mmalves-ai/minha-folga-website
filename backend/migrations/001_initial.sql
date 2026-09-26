-- Minha Folga — esquema inicial.
-- Banco exclusivo da Minha Folga. Dados pessoais de contato ficam cifrados (AES-256-GCM, na aplicação);
-- a deduplicação usa HMAC com chave própria (não é anonimização).
-- Convenções: ids uuid gerados na aplicação; timestamps timestamptz; estados com CHECK explícito.

-- Cadastro de interesse (lista de aviso) ------------------------------------------------------------
CREATE TABLE leads (
  id uuid PRIMARY KEY,
  preferred_name text NOT NULL CHECK (char_length(preferred_name) BETWEEN 1 AND 80),
  phone_ciphertext text NOT NULL,
  phone_hint text NOT NULL,
  dedup_key text NOT NULL UNIQUE,
  employment_type text NOT NULL CHECK (employment_type IN ('clt', 'domestico', 'rural', 'outro')),
  interest_topic text CHECK (interest_topic IN ('organizar_compromissos', 'entender_alternativa', 'entender_portabilidade', 'so_conhecer')),
  age_confirmed boolean NOT NULL CHECK (age_confirmed),
  state text NOT NULL CHECK (state IN ('received', 'verification_pending', 'verified', 'waiting', 'invited', 'unsubscribed', 'expired', 'human_support')),
  contact_verified_at timestamptz,
  source text NOT NULL,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  privacy_notice_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_interaction_at timestamptz NOT NULL DEFAULT now(),
  anonymized_at timestamptz
);
CREATE INDEX leads_created_at_idx ON leads (created_at);
CREATE INDEX leads_state_idx ON leads (state);
CREATE INDEX leads_last_interaction_idx ON leads (last_interaction_at);

-- Preferência vigente por finalidade. O histórico fica em lead_events.
CREATE TABLE lead_preferences (
  lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('launch_notice', 'marketing')),
  granted boolean NOT NULL,
  consent_text_version text NOT NULL,
  source text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_id, purpose)
);

-- Trilha do titular: mudanças de estado, preferências, verificação, anonimização.
CREATE TABLE lead_events (
  id uuid PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('state_changed', 'preference_changed', 'verification_requested', 'contact_verified', 'interest_updated', 'anonymized', 'invited')),
  from_state text,
  to_state text,
  purpose text,
  granted boolean,
  consent_text_version text,
  source text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('titular', 'admin', 'system', 'agent')),
  actor_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_events_lead_idx ON lead_events (lead_id, created_at);

-- Desafios de verificação de contato (código de uso único enviado pelo canal oficial).
CREATE TABLE verification_challenges (
  id uuid PRIMARY KEY,
  purpose text NOT NULL CHECK (purpose IN ('waitlist', 'preferences_access')),
  dedup_key text NOT NULL,
  lead_id uuid REFERENCES leads (id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  -- Para número já cadastrado: alterações pendentes só são aplicadas após o titular confirmar o código.
  pending_payload_ciphertext text,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL,
  sends integer NOT NULL DEFAULT 1,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_challenges_dedup_idx ON verification_challenges (dedup_key, created_at);

-- Sessões do titular (após confirmar o contato), usadas por /preferencias e acompanhamento.
CREATE TABLE contact_sessions (
  id_hash text PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX contact_sessions_lead_idx ON contact_sessions (lead_id);

-- Links seguros de curta validade enviados pelo canal oficial (ex.: gerenciar preferências).
CREATE TABLE contact_access_tokens (
  token_hash text PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('preferences')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Supressão: contatos que pediram exclusão/oposição continuam bloqueados para novos envios.
CREATE TABLE suppression_list (
  dedup_key text PRIMARY KEY,
  reason text NOT NULL CHECK (reason IN ('deletion_request', 'opposition', 'abuse', 'other')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Comunicação (outbox) ------------------------------------------------------------------------------
-- Mensagens são gravadas na mesma transação do evento e enviadas por um worker com retentativa limitada.
-- `purpose` indica a finalidade que precisa estar autorizada no momento do envio
-- ('transactional' para verificação/atendimento solicitados pelo próprio titular).
CREATE TABLE outbox_messages (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('verification_code', 'preferences_link', 'launch_notice', 'marketing', 'support_notification', 'support_reply')),
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'webhook')),
  purpose text NOT NULL CHECK (purpose IN ('transactional', 'launch_notice', 'marketing', 'internal')),
  lead_id uuid REFERENCES leads (id) ON DELETE CASCADE,
  support_request_id uuid,
  recipient_ciphertext text,
  payload_ciphertext text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error text,
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX outbox_pending_idx ON outbox_messages (status, next_attempt_at);

-- Administração ---------------------------------------------------------------------------------------
CREATE TABLE admin_users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'support', 'privacy', 'marketing')),
  password_hash text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  mfa_secret_ciphertext text,
  mfa_enabled_at timestamptz,
  mfa_last_step integer,
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  disabled_at timestamptz,
  last_login_at timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_sessions (
  id_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  mfa_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip_hash text,
  user_agent text
);
CREATE INDEX admin_sessions_user_idx ON admin_sessions (user_id);

-- Auditoria de ações administrativas e de sistema. `metadata` nunca contém dados de contato ou mensagens.
CREATE TABLE audit_log (
  id uuid PRIMARY KEY,
  actor_type text NOT NULL CHECK (actor_type IN ('admin', 'system', 'titular', 'agent')),
  actor_id text,
  action text NOT NULL,
  resource_type text,
  resource_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at);
CREATE INDEX audit_log_resource_idx ON audit_log (resource_type, resource_id);

-- Atendimento -------------------------------------------------------------------------------------------
CREATE TABLE support_requests (
  id uuid PRIMARY KEY,
  protocol text NOT NULL UNIQUE,
  tracking_token_hash text NOT NULL,
  requester_name text NOT NULL,
  contact_method text NOT NULL CHECK (contact_method IN ('email', 'whatsapp')),
  contact_ciphertext text NOT NULL,
  contact_hint text NOT NULL,
  subject text NOT NULL,
  message_ciphertext text NOT NULL,
  status text NOT NULL CHECK (status IN ('received', 'in_progress', 'answered', 'closed')),
  assignee_id uuid REFERENCES admin_users (id) ON DELETE SET NULL,
  lead_id uuid REFERENCES leads (id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('web_form', 'agent')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  first_response_at timestamptz,
  closed_at timestamptz,
  anonymized_at timestamptz
);
CREATE INDEX support_requests_status_idx ON support_requests (status, created_at);

CREATE TABLE support_events (
  id uuid PRIMARY KEY,
  support_request_id uuid NOT NULL REFERENCES support_requests (id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('created', 'status_changed', 'assigned', 'note_added', 'reply_recorded', 'notification_queued', 'notification_failed')),
  from_status text,
  to_status text,
  assignee_id uuid,
  note_ciphertext text,
  visible_to_requester boolean NOT NULL DEFAULT false,
  actor_type text NOT NULL CHECK (actor_type IN ('admin', 'system', 'titular', 'agent')),
  actor_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_events_request_idx ON support_events (support_request_id, created_at);

-- Pedidos de titulares (LGPD) ------------------------------------------------------------------------
CREATE TABLE privacy_requests (
  id uuid PRIMARY KEY,
  request_type text NOT NULL CHECK (request_type IN ('access', 'correction', 'deletion', 'revocation', 'opposition', 'portability', 'information', 'other')),
  lead_id uuid REFERENCES leads (id) ON DELETE SET NULL,
  support_request_id uuid REFERENCES support_requests (id) ON DELETE SET NULL,
  channel text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'in_progress', 'fulfilled', 'rejected')),
  summary text NOT NULL,
  resolution text,
  received_at timestamptz NOT NULL,
  fulfilled_at timestamptz,
  handled_by uuid REFERENCES admin_users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Integrações --------------------------------------------------------------------------------------------
-- Proteção contra replay de webhooks (provedor + id do evento).
CREATE TABLE webhook_events (
  provider text NOT NULL,
  event_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);

-- Registro minimizado de chamadas de ferramenta da Bia: sem conteúdo de conversa.
CREATE TABLE agent_tool_calls (
  id uuid PRIMARY KEY,
  tool text NOT NULL,
  outcome text NOT NULL,
  credit_phase text NOT NULL,
  conversation_ref_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_tool_calls_created_idx ON agent_tool_calls (created_at);

-- Métricas agregadas (sem identificadores pessoais) ------------------------------------------------
CREATE TABLE metric_counters (
  day date NOT NULL,
  name text NOT NULL,
  dimension text NOT NULL DEFAULT '',
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, name, dimension)
);
