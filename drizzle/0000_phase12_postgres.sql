CREATE OR REPLACE FUNCTION moataz_safe_jsonb(value text)
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email varchar(254) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name varchar(100) NOT NULL,
  role varchar(20) NOT NULL DEFAULT 'user',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at timestamptz
);
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE users ALTER COLUMN is_active DROP DEFAULT;
ALTER TABLE users ALTER COLUMN is_active TYPE boolean USING CASE WHEN lower(is_active::text) IN ('1','true','t','yes') THEN true ELSE false END;
ALTER TABLE users ALTER COLUMN is_active SET DEFAULT true;
ALTER TABLE users ALTER COLUMN is_active SET NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS providers (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  type varchar(40) NOT NULL,
  base_url text,
  api_key_enc text NOT NULL,
  default_model varchar(300) NOT NULL,
  validation_status varchar(40) NOT NULL DEFAULT 'untested',
  validation_error_code varchar(120),
  validated_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
ALTER TABLE providers ADD COLUMN IF NOT EXISTS protocol varchar(40);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS raw_base_url text;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS normalized_base_url text;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS encryption_version integer NOT NULL DEFAULT 1;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS selected_model varchar(300);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS discovered_models jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS status varchar(40) NOT NULL DEFAULT 'draft';
ALTER TABLE providers ADD COLUMN IF NOT EXISTS last_check_status varchar(60);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS last_check_code varchar(120);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS last_check_message text;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS last_latency_ms integer;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS is_ready boolean NOT NULL DEFAULT false;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE providers ALTER COLUMN is_active DROP DEFAULT;
ALTER TABLE providers ALTER COLUMN is_active TYPE boolean USING CASE WHEN lower(is_active::text) IN ('1','true','t','yes') THEN true ELSE false END;
ALTER TABLE providers ALTER COLUMN is_active SET DEFAULT true;
ALTER TABLE providers ALTER COLUMN is_active SET NOT NULL;
UPDATE providers SET
  protocol = COALESCE(protocol, CASE WHEN type = 'anthropic' THEN 'anthropic' WHEN type = 'gemini' THEN 'gemini' ELSE 'openai-compatible' END),
  raw_base_url = COALESCE(raw_base_url, base_url),
  normalized_base_url = COALESCE(normalized_base_url, base_url),
  selected_model = COALESCE(selected_model, default_model),
  status = CASE
    WHEN status IS NOT NULL AND status <> 'draft' THEN status
    WHEN validation_status = 'verified' THEN 'ready'
    WHEN validation_status = 'failed' AND validation_error_code LIKE '%authentication%' THEN 'invalid_credentials'
    WHEN validation_status = 'failed' THEN 'configuration_error'
    ELSE 'draft'
  END,
  is_ready = CASE WHEN validation_status = 'verified' THEN true ELSE COALESCE(is_ready, false) END,
  is_enabled = CASE WHEN is_active THEN COALESCE(is_enabled, true) ELSE false END,
  last_check_code = COALESCE(last_check_code, validation_error_code),
  last_checked_at = COALESCE(last_checked_at, validated_at);
ALTER TABLE providers ALTER COLUMN protocol SET NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS provider_models (
  id text PRIMARY KEY,
  provider_id text NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id varchar(500) NOT NULL,
  name varchar(500),
  owned_by varchar(300),
  context_length integer,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  discovered_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL,
  UNIQUE(provider_id, model_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS integrations (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type varchar(40) NOT NULL,
  name varchar(100) NOT NULL,
  token_enc text NOT NULL,
  meta text,
  validation_status varchar(40) NOT NULL DEFAULT 'untested',
  validation_error_code varchar(120),
  validated_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS meta_json jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE integrations ALTER COLUMN is_active DROP DEFAULT;
ALTER TABLE integrations ALTER COLUMN is_active TYPE boolean USING CASE WHEN lower(is_active::text) IN ('1','true','t','yes') THEN true ELSE false END;
ALTER TABLE integrations ALTER COLUMN is_active SET DEFAULT true;
ALTER TABLE integrations ALTER COLUMN is_active SET NOT NULL;
UPDATE integrations SET meta_json = CASE WHEN meta_json = '{}'::jsonb THEN moataz_safe_jsonb(meta) ELSE meta_json END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS chats (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  provider_id text REFERENCES providers(id) ON DELETE SET NULL,
  model varchar(300),
  mode varchar(30) NOT NULL DEFAULT 'agent',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
ALTER TABLE chats ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  root_path text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS chat_id text REFERENCES chats(id) ON DELETE SET NULL;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS status varchar(30) NOT NULL DEFAULT 'active';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS storage_prefix text;
ALTER TABLE workspaces ALTER COLUMN root_path DROP NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS files (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path text NOT NULL,
  storage_key text NOT NULL,
  mime_type varchar(200) NOT NULL,
  size_bytes bigint NOT NULL,
  checksum varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id, path)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY,
  chat_id text NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE CASCADE,
  role varchar(30) NOT NULL,
  content text NOT NULL,
  tool_calls text,
  idempotency_key varchar(128),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sequence bigint;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS tool_calls_json jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS user_id text REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS idempotency_key varchar(128);
UPDATE messages SET tool_calls_json = CASE
  WHEN tool_calls_json = '[]'::jsonb AND tool_calls IS NOT NULL THEN
    CASE WHEN jsonb_typeof(moataz_safe_jsonb(tool_calls)) = 'array' THEN moataz_safe_jsonb(tool_calls) ELSE '[]'::jsonb END
  ELSE tool_calls_json
END;
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY chat_id ORDER BY created_at ASC, id ASC) AS seq
  FROM messages
  WHERE sequence IS NULL
)
UPDATE messages SET sequence = ordered.seq FROM ordered WHERE messages.id = ordered.id;
ALTER TABLE messages ALTER COLUMN sequence SET NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS attachments (
  id text PRIMARY KEY,
  chat_id text NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id text REFERENCES messages(id) ON DELETE SET NULL,
  name varchar(180) NOT NULL,
  mime_type varchar(160) NOT NULL,
  size_bytes bigint NOT NULL,
  storage_path text NOT NULL,
  sha256 varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_runs (
  id text PRIMARY KEY,
  chat_id text NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE CASCADE,
  status varchar(30) NOT NULL,
  log text NOT NULL DEFAULT '',
  error_code varchar(120),
  started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS provider_id text REFERENCES providers(id) ON DELETE SET NULL;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS model varchar(300);
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS finished_at timestamptz;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS input_tokens integer;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS output_tokens integer;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS total_tokens integer;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS estimated_cost numeric(18,8);
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS summary jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE agent_runs SET
  user_id = COALESCE(agent_runs.user_id, chats.user_id),
  finished_at = COALESCE(agent_runs.finished_at, agent_runs.completed_at, CASE WHEN agent_runs.status IN ('completed','failed','cancelled') THEN agent_runs.created_at END),
  summary = CASE WHEN summary = '{}'::jsonb THEN moataz_safe_jsonb(log) ELSE summary END
FROM chats WHERE chats.id = agent_runs.chat_id;
ALTER TABLE agent_runs ALTER COLUMN user_id SET NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_steps (
  id text PRIMARY KEY,
  agent_run_id text NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_number integer NOT NULL,
  type varchar(60) NOT NULL,
  status varchar(30) NOT NULL,
  input_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at timestamptz,
  duration_ms integer,
  error_code varchar(120),
  error_message text,
  UNIQUE(agent_run_id, step_number)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS tool_executions (
  id text PRIMARY KEY,
  agent_run_id text NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  agent_step_id text REFERENCES agent_steps(id) ON DELETE SET NULL,
  tool_name varchar(120) NOT NULL,
  status varchar(30) NOT NULL,
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at timestamptz,
  duration_ms integer,
  error_code varchar(120),
  error_message text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_agent varchar(500),
  ip_hash varchar(64)
);
--> statement-breakpoint
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS websocket_tickets (
  id text PRIMARY KEY,
  token_hash varchar(64) NOT NULL UNIQUE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose varchar(60) NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  action varchar(160) NOT NULL,
  resource_type varchar(100),
  resource_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id varchar(160),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','user'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'providers_status_check') THEN
    ALTER TABLE providers ADD CONSTRAINT providers_status_check CHECK (status IN ('draft','testing','ready','temporarily_unavailable','invalid_credentials','disabled','configuration_error'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'providers_protocol_check') THEN
    ALTER TABLE providers ADD CONSTRAINT providers_protocol_check CHECK (protocol IN ('openai-compatible','anthropic','gemini'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'providers_failure_count_check') THEN
    ALTER TABLE providers ADD CONSTRAINT providers_failure_count_check CHECK (failure_count >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chats_mode_check') THEN
    ALTER TABLE chats ADD CONSTRAINT chats_mode_check CHECK (mode IN ('chat','agent','multi-agent'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_role_check') THEN
    ALTER TABLE messages ADD CONSTRAINT messages_role_check CHECK (role IN ('system','user','assistant','tool'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_status_check') THEN
    ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_status_check CHECK (status IN ('queued','running','completed','failed','cancelled'));
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS messages_chat_sequence_unique ON messages(chat_id, sequence);
CREATE UNIQUE INDEX IF NOT EXISTS messages_chat_idempotency_role_unique ON messages(chat_id, idempotency_key, role) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_chat_created_idx ON messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS providers_user_status_idx ON providers(user_id, status, is_enabled);
CREATE INDEX IF NOT EXISTS providers_user_ready_idx ON providers(user_id, is_ready, is_enabled);
CREATE INDEX IF NOT EXISTS provider_models_user_provider_idx ON provider_models(user_id, provider_id);
CREATE INDEX IF NOT EXISTS provider_models_expires_idx ON provider_models(expires_at);
CREATE INDEX IF NOT EXISTS integrations_user_type_idx ON integrations(user_id, type, is_active);
CREATE INDEX IF NOT EXISTS projects_user_updated_idx ON projects(user_id, updated_at);
CREATE INDEX IF NOT EXISTS chats_user_updated_idx ON chats(user_id, updated_at);
CREATE INDEX IF NOT EXISTS chats_user_project_idx ON chats(user_id, project_id);
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_user_name_unique ON workspaces(user_id, name);
CREATE INDEX IF NOT EXISTS workspaces_user_project_idx ON workspaces(user_id, project_id);
CREATE INDEX IF NOT EXISTS files_user_workspace_idx ON files(user_id, workspace_id);
CREATE INDEX IF NOT EXISTS attachments_chat_message_idx ON attachments(chat_id, message_id, created_at);
CREATE INDEX IF NOT EXISTS attachments_user_pending_idx ON attachments(user_id, chat_id, message_id);
CREATE INDEX IF NOT EXISTS agent_runs_user_chat_idx ON agent_runs(user_id, chat_id, created_at);
CREATE INDEX IF NOT EXISTS agent_runs_chat_status_idx ON agent_runs(chat_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_one_running_unique ON agent_runs(chat_id) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS agent_steps_run_status_idx ON agent_steps(agent_run_id, status);
CREATE INDEX IF NOT EXISTS tool_executions_run_step_idx ON tool_executions(agent_run_id, agent_step_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_expiry_idx ON refresh_tokens(user_id, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS websocket_tickets_hash_unique ON websocket_tickets(token_hash);
CREATE INDEX IF NOT EXISTS websocket_tickets_expiry_idx ON websocket_tickets(expires_at);
CREATE INDEX IF NOT EXISTS audit_logs_user_created_idx ON audit_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS audit_logs_resource_idx ON audit_logs(resource_type, resource_id);
--> statement-breakpoint
DROP FUNCTION IF EXISTS moataz_safe_jsonb(text);
