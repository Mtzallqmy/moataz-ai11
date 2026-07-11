-- Moataz AI phase 2: PostgreSQL/Supabase + Drizzle.
-- This migration is additive and intentionally keeps legacy columns until all deployed nodes use the new repositories.

CREATE OR REPLACE FUNCTION moataz_try_jsonb(value text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF value IS NULL OR btrim(value) = '' THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN value::jsonb;
EXCEPTION WHEN others THEN
  RETURN '{}'::jsonb;
END;
$$;

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'user',
  is_active integer NOT NULL DEFAULT 1,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent text,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS providers (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL,
  base_url text,
  api_key_enc text NOT NULL,
  default_model text NOT NULL,
  validation_status text NOT NULL DEFAULT 'untested',
  validation_error_code text,
  validated_at timestamptz,
  is_active integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integrations (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  name text NOT NULL,
  token_enc text NOT NULL,
  meta text,
  validation_status text NOT NULL DEFAULT 'untested',
  validation_error_code text,
  validated_at timestamptz,
  is_active integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chats (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New chat',
  provider_id text REFERENCES providers(id) ON DELETE SET NULL,
  model text,
  mode text NOT NULL DEFAULT 'agent',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY,
  chat_id text NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  tool_calls text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id text PRIMARY KEY,
  chat_id text NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL,
  log text,
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id text REFERENCES chats(id) ON DELETE CASCADE,
  root_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attachments (
  id text PRIMARY KEY,
  chat_id text NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id text REFERENCES messages(id) ON DELETE CASCADE,
  name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  storage_path text NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS websocket_tickets (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active_bool boolean NOT NULL DEFAULT true;
UPDATE users SET is_active_bool = (is_active <> 0) WHERE is_active_bool IS DISTINCT FROM (is_active <> 0);

ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS device_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE providers ADD COLUMN IF NOT EXISTS protocol text NOT NULL DEFAULT 'openai-compatible';
ALTER TABLE providers ADD COLUMN IF NOT EXISTS raw_base_url text;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS normalized_base_url text;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS encryption_version integer NOT NULL DEFAULT 1;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS discovered_models jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';
ALTER TABLE providers ADD COLUMN IF NOT EXISTS last_check_status text;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS last_check_code text;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS last_check_message text;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS last_latency_ms integer;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS is_ready boolean NOT NULL DEFAULT false;
UPDATE providers
SET raw_base_url = COALESCE(raw_base_url, base_url),
    normalized_base_url = COALESCE(normalized_base_url, base_url),
    protocol = CASE WHEN type = 'anthropic' THEN 'anthropic' WHEN type = 'gemini' THEN 'gemini' ELSE 'openai-compatible' END,
    status = CASE
      WHEN is_active = 0 THEN 'disabled'
      WHEN validation_status = 'verified' THEN 'ready'
      WHEN validation_status = 'failed' AND validation_error_code LIKE '%authentication%' THEN 'invalid_credentials'
      WHEN validation_status = 'failed' THEN 'configuration_error'
      ELSE 'draft'
    END,
    is_enabled = (is_active <> 0),
    is_ready = (is_active <> 0 AND validation_status = 'verified'),
    last_check_code = COALESCE(last_check_code, validation_error_code),
    last_checked_at = COALESCE(last_checked_at, validated_at);

ALTER TABLE integrations ADD COLUMN IF NOT EXISTS encryption_version integer NOT NULL DEFAULT 1;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS meta_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true;
UPDATE integrations SET meta_jsonb = moataz_try_jsonb(meta), is_enabled = (is_active <> 0);

ALTER TABLE chats ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE SET NULL;

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS storage_prefix text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE messages ADD COLUMN IF NOT EXISTS sequence bigint;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS tool_calls_jsonb jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE messages SET tool_calls_jsonb = CASE
  WHEN tool_calls IS NULL OR btrim(tool_calls) = '' THEN '[]'::jsonb
  ELSE moataz_try_jsonb(tool_calls)
END;
CREATE SEQUENCE IF NOT EXISTS messages_sequence_seq;
WITH ranked AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS seq
  FROM messages
  WHERE sequence IS NULL
)
UPDATE messages SET sequence = ranked.seq FROM ranked WHERE messages.id = ranked.id;
SELECT setval('messages_sequence_seq', GREATEST(COALESCE((SELECT max(sequence) FROM messages), 0), 1), true);
ALTER TABLE messages ALTER COLUMN sequence SET DEFAULT nextval('messages_sequence_seq');
ALTER TABLE messages ALTER COLUMN sequence SET NOT NULL;

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS provider_id text REFERENCES providers(id) ON DELETE SET NULL;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS finished_at timestamptz;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS input_tokens integer;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS output_tokens integer;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS total_tokens integer;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS estimated_cost numeric(18,8);
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
UPDATE agent_runs SET finished_at = COALESCE(finished_at, completed_at);

CREATE TABLE IF NOT EXISTS provider_models (
  id text PRIMARY KEY,
  provider_id text NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id text NOT NULL,
  name text,
  owned_by text,
  context_length integer,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE(provider_id, model_id)
);

CREATE TABLE IF NOT EXISTS files (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path text NOT NULL,
  storage_key text NOT NULL,
  mime_type text,
  size_bytes bigint NOT NULL DEFAULT 0,
  checksum text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, path)
);

CREATE TABLE IF NOT EXISTS agent_steps (
  id text PRIMARY KEY,
  agent_run_id text NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_number integer NOT NULL,
  type text NOT NULL,
  status text NOT NULL,
  input_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  error_code text,
  error_message text,
  UNIQUE(agent_run_id, step_number)
);

CREATE TABLE IF NOT EXISTS tool_executions (
  id text PRIMARY KEY,
  agent_run_id text NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  agent_step_id text REFERENCES agent_steps(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  status text NOT NULL,
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  error_code text,
  error_message text
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_hash_unique ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_expiry_idx ON refresh_tokens(user_id, expires_at);
CREATE INDEX IF NOT EXISTS providers_user_status_idx ON providers(user_id, status, is_enabled);
CREATE INDEX IF NOT EXISTS providers_user_ready_idx ON providers(user_id, is_ready, is_enabled);
CREATE INDEX IF NOT EXISTS provider_models_user_expiry_idx ON provider_models(user_id, expires_at);
CREATE INDEX IF NOT EXISTS integrations_user_type_idx ON integrations(user_id, type, is_enabled);
CREATE INDEX IF NOT EXISTS projects_user_idx ON projects(user_id, created_at);
CREATE INDEX IF NOT EXISTS chats_user_updated_idx ON chats(user_id, updated_at);
CREATE INDEX IF NOT EXISTS chats_provider_idx ON chats(provider_id);
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_chat_unique ON workspaces(chat_id) WHERE chat_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS files_workspace_path_unique ON files(workspace_id, path);
CREATE UNIQUE INDEX IF NOT EXISTS messages_chat_sequence_unique ON messages(chat_id, sequence);
CREATE UNIQUE INDEX IF NOT EXISTS messages_chat_idempotency_unique ON messages(chat_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_chat_created_idx ON messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS attachments_chat_message_idx ON attachments(chat_id, message_id);
CREATE INDEX IF NOT EXISTS agent_runs_chat_status_idx ON agent_runs(chat_id, status);
CREATE INDEX IF NOT EXISTS agent_steps_run_status_idx ON agent_steps(agent_run_id, status);
CREATE INDEX IF NOT EXISTS tool_executions_run_step_idx ON tool_executions(agent_run_id, agent_step_id);
CREATE INDEX IF NOT EXISTS websocket_tickets_expiry_idx ON websocket_tickets(expires_at, used_at);

DO $$ BEGIN
  ALTER TABLE providers ADD CONSTRAINT providers_status_check CHECK (status IN ('draft','testing','ready','temporarily_unavailable','invalid_credentials','disabled','configuration_error')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE providers ADD CONSTRAINT providers_protocol_check CHECK (protocol IN ('openai-compatible','anthropic','gemini')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE chats ADD CONSTRAINT chats_mode_check CHECK (mode IN ('chat','agent','multi-agent')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE messages ADD CONSTRAINT messages_role_check CHECK (role IN ('system','user','assistant','tool')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP FUNCTION IF EXISTS moataz_try_jsonb(text);
