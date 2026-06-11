-- ============================================================================
-- Passkeys (WebAuthn) para login del admin con Windows Hello / huella / Face ID
-- ============================================================================
-- Permite registrar credenciales de autenticadores de plataforma para
-- iniciar sesión en /admin sin escribir la contraseña, usando biometría.

BEGIN;

CREATE TABLE IF NOT EXISTS admin_passkeys (
  id            SERIAL PRIMARY KEY,
  credential_id TEXT NOT NULL UNIQUE,
  public_key    TEXT NOT NULL,
  counter       BIGINT NOT NULL DEFAULT 0,
  device_name   TEXT,
  transports    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ
);

COMMIT;
