-- Web Push opt-in independente do cadastro de crédito. Nenhum CPF, telefone ou lead.
CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY,
  endpoint_key text NOT NULL UNIQUE,
  subscription_ciphertext text NOT NULL,
  owner_token_hash text NOT NULL,
  consent_version text NOT NULL,
  registration_key text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX push_subscriptions_created ON push_subscriptions(created_at, id);
CREATE INDEX push_subscriptions_registration ON push_subscriptions(registration_key, created_at);

CREATE TABLE push_grants (
  user_id uuid PRIMARY KEY REFERENCES admin_users(id) ON DELETE CASCADE,
  granted_by uuid NOT NULL REFERENCES admin_users(id),
  granted_at timestamptz NOT NULL
);

CREATE TABLE push_campaigns (
  id uuid PRIMARY KEY,
  request_key uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES admin_users(id),
  title text NOT NULL,
  body text NOT NULL,
  target_url text NOT NULL,
  audience_count integer NOT NULL,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE(created_by, request_key)
);
CREATE INDEX push_campaigns_created ON push_campaigns(created_at DESC);

CREATE TABLE push_deliveries (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES push_campaigns(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES push_subscriptions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','accepted','failed','expired','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  locked_until timestamptz,
  lease_token uuid,
  last_error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(campaign_id, subscription_id)
);
CREATE INDEX push_deliveries_pending ON push_deliveries(status, next_attempt_at);
