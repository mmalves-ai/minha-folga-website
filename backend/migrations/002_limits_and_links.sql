-- Minha Folga — 002: orçamento de envio de códigos, MFA com contador próprio e chave de contato nos atendimentos.
-- Migração aditiva: a release anterior continua funcionando com estas colunas (todas com padrão ou anuláveis).

-- Verificação de contato ----------------------------------------------------------------------------
-- origin_hash: HMAC da rede de origem (IP agrupado; nunca o IP) de quem pediu o código.
-- codes_sent: quantos códigos deste desafio foram de fato para a fila de envio (desafio cego não conta).
-- code_send: número do envio do código vigente; o worker só entrega a mensagem desse envio.
-- Os três alimentam o limite de mensagens por contato, por finalidade e por origem.
ALTER TABLE verification_challenges ADD COLUMN origin_hash text;
ALTER TABLE verification_challenges ADD COLUMN codes_sent integer NOT NULL DEFAULT 0;
ALTER TABLE verification_challenges ADD COLUMN code_send integer;
UPDATE verification_challenges SET codes_sent = sends, code_send = sends WHERE code_hash NOT LIKE '!blind:%';
CREATE INDEX verification_challenges_purpose_idx ON verification_challenges (dedup_key, purpose, created_at);

-- Administração: falhas de MFA contadas à parte das falhas de senha --------------------------------------
-- Login com senha correta não zera este contador; só um código TOTP aceito (ou a janela vencida) zera.
ALTER TABLE admin_users ADD COLUMN mfa_failed_count integer NOT NULL DEFAULT 0;
ALTER TABLE admin_users ADD COLUMN mfa_failed_since timestamptz;

-- Atendimento: chave HMAC do contato (mesma chave da deduplicação de cadastros) ------------------------
-- Permite localizar todos os atendimentos de um titular num pedido de exclusão, sem guardar o contato em claro.
ALTER TABLE support_requests ADD COLUMN contact_key text;
CREATE INDEX support_requests_contact_key_idx ON support_requests (contact_key);
