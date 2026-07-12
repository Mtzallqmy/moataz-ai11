import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
};

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: varchar('email', { length: 254 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  role: varchar('role', { length: 20 }).notNull().default('user'),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
  lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'string' })
}, (table) => [
  uniqueIndex('users_email_unique').on(table.email),
  check('users_role_check', sql`${table.role} IN ('admin', 'user')`)
]);

export const providers = pgTable('providers', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  providerType: varchar('type', { length: 40 }).notNull(),
  protocol: varchar('protocol', { length: 40 }).notNull().default('openai-compatible'),
  rawBaseUrl: text('raw_base_url'),
  normalizedBaseUrl: text('normalized_base_url'),
  legacyBaseUrl: text('base_url'),
  encryptedApiKey: text('api_key_enc').notNull(),
  encryptionVersion: integer('encryption_version').notNull().default(1),
  selectedModel: varchar('selected_model', { length: 300 }),
  legacyDefaultModel: varchar('default_model', { length: 300 }).notNull(),
  discoveredModels: jsonb('discovered_models').$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  capabilities: jsonb('capabilities').$type<Record<string, boolean | null>>().notNull().default(sql`'{}'::jsonb`),
  status: varchar('status', { length: 40 }).notNull().default('draft'),
  lastCheckStatus: varchar('last_check_status', { length: 60 }),
  lastCheckCode: varchar('last_check_code', { length: 120 }),
  lastCheckMessage: text('last_check_message'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true, mode: 'string' }),
  lastLatencyMs: integer('last_latency_ms'),
  failureCount: integer('failure_count').notNull().default(0),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true, mode: 'string' }),
  isEnabled: boolean('is_enabled').notNull().default(true),
  isReady: boolean('is_ready').notNull().default(false),
  legacyValidationStatus: varchar('validation_status', { length: 40 }).notNull().default('untested'),
  legacyValidationErrorCode: varchar('validation_error_code', { length: 120 }),
  legacyValidatedAt: timestamp('validated_at', { withTimezone: true, mode: 'string' }),
  legacyIsActive: boolean('is_active').notNull().default(true),
  ...timestamps
}, (table) => [
  index('providers_user_status_idx').on(table.userId, table.status, table.isEnabled),
  index('providers_user_ready_idx').on(table.userId, table.isReady, table.isEnabled),
  check('providers_status_check', sql`${table.status} IN ('draft','testing','ready','temporarily_unavailable','invalid_credentials','disabled','configuration_error')`),
  check('providers_protocol_check', sql`${table.protocol} IN ('openai-compatible','anthropic','gemini')`),
  check('providers_failure_count_check', sql`${table.failureCount} >= 0`)
]);

export const providerModels = pgTable('provider_models', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull().references(() => providers.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  modelId: varchar('model_id', { length: 500 }).notNull(),
  name: varchar('name', { length: 500 }),
  ownedBy: varchar('owned_by', { length: 300 }),
  contextLength: integer('context_length'),
  capabilities: jsonb('capabilities').$type<Record<string, boolean | null>>().notNull().default(sql`'{}'::jsonb`),
  discoveredAt: timestamp('discovered_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull()
}, (table) => [
  uniqueIndex('provider_models_provider_model_unique').on(table.providerId, table.modelId),
  index('provider_models_user_provider_idx').on(table.userId, table.providerId),
  index('provider_models_expires_idx').on(table.expiresAt)
]);

export const integrations = pgTable('integrations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 40 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  encryptedToken: text('token_enc').notNull(),
  meta: jsonb('meta_json').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  legacyMeta: text('meta'),
  validationStatus: varchar('validation_status', { length: 40 }).notNull().default('untested'),
  validationErrorCode: varchar('validation_error_code', { length: 120 }),
  validatedAt: timestamp('validated_at', { withTimezone: true, mode: 'string' }),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps
}, (table) => [index('integrations_user_type_idx').on(table.userId, table.type, table.isActive)]);

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 160 }).notNull(),
  description: text('description'),
  ...timestamps
}, (table) => [index('projects_user_updated_idx').on(table.userId, table.updatedAt)]);

export const chats = pgTable('chats', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 200 }).notNull(),
  providerId: text('provider_id').references(() => providers.id, { onDelete: 'set null' }),
  model: varchar('model', { length: 300 }),
  mode: varchar('mode', { length: 30 }).notNull().default('agent'),
  ...timestamps
}, (table) => [
  index('chats_user_updated_idx').on(table.userId, table.updatedAt),
  index('chats_user_project_idx').on(table.userId, table.projectId),
  check('chats_mode_check', sql`${table.mode} IN ('chat','agent','multi-agent')`)
]);

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  chatId: text('chat_id').references(() => chats.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 160 }).notNull(),
  status: varchar('status', { length: 30 }).notNull().default('active'),
  storagePrefix: text('storage_prefix'),
  legacyRootPath: text('root_path'),
  ...timestamps
}, (table) => [
  index('workspaces_user_project_idx').on(table.userId, table.projectId),
  uniqueIndex('workspaces_user_name_unique').on(table.userId, table.name),
  check('workspaces_status_check', sql`${table.status} IN ('active','archived','deleted')`)
]);

export const files = pgTable('files', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  storageKey: text('storage_key').notNull(),
  mimeType: varchar('mime_type', { length: 200 }).notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  checksum: varchar('checksum', { length: 128 }).notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex('files_workspace_path_unique').on(table.workspaceId, table.path),
  index('files_user_workspace_idx').on(table.userId, table.workspaceId)
]);

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  sequence: bigint('sequence', { mode: 'number' }).notNull(),
  role: varchar('role', { length: 30 }).notNull(),
  content: text('content').notNull(),
  toolCalls: jsonb('tool_calls_json').$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  legacyToolCalls: text('tool_calls'),
  idempotencyKey: varchar('idempotency_key', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('messages_chat_sequence_unique').on(table.chatId, table.sequence),
  uniqueIndex('messages_chat_idempotency_role_unique').on(table.chatId, table.idempotencyKey, table.role),
  index('messages_chat_created_idx').on(table.chatId, table.createdAt),
  check('messages_role_check', sql`${table.role} IN ('system','user','assistant','tool')`)
]);

export const attachments = pgTable('attachments', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  messageId: text('message_id').references(() => messages.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 180 }).notNull(),
  mimeType: varchar('mime_type', { length: 160 }).notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  storagePath: text('storage_path').notNull(),
  sha256: varchar('sha256', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
}, (table) => [
  index('attachments_chat_message_idx').on(table.chatId, table.messageId, table.createdAt),
  index('attachments_user_pending_idx').on(table.userId, table.chatId, table.messageId)
]);

export const agentRuns = pgTable('agent_runs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  chatId: text('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').references(() => providers.id, { onDelete: 'set null' }),
  model: varchar('model', { length: 300 }),
  status: varchar('status', { length: 30 }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
  legacyCompletedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
  cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true, mode: 'string' }),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  totalTokens: integer('total_tokens'),
  estimatedCost: numeric('estimated_cost', { precision: 18, scale: 8 }),
  errorCode: varchar('error_code', { length: 120 }),
  errorMessage: text('error_message'),
  summary: jsonb('summary').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  legacyLog: text('log').notNull().default(''),
  ...timestamps
}, (table) => [
  index('agent_runs_user_chat_idx').on(table.userId, table.chatId, table.createdAt),
  index('agent_runs_chat_status_idx').on(table.chatId, table.status),
  uniqueIndex('agent_runs_one_running_unique').on(table.chatId).where(sql`${table.status} = 'running'`),
  check('agent_runs_status_check', sql`${table.status} IN ('queued','running','completed','failed','cancelled')`)
]);

export const agentSteps = pgTable('agent_steps', {
  id: text('id').primaryKey(),
  agentRunId: text('agent_run_id').notNull().references(() => agentRuns.id, { onDelete: 'cascade' }),
  stepNumber: integer('step_number').notNull(),
  type: varchar('type', { length: 60 }).notNull(),
  status: varchar('status', { length: 30 }).notNull(),
  inputMetadata: jsonb('input_metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  outputMetadata: jsonb('output_metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
  durationMs: integer('duration_ms'),
  errorCode: varchar('error_code', { length: 120 }),
  errorMessage: text('error_message')
}, (table) => [
  uniqueIndex('agent_steps_run_number_unique').on(table.agentRunId, table.stepNumber),
  index('agent_steps_run_status_idx').on(table.agentRunId, table.status)
]);

export const toolExecutions = pgTable('tool_executions', {
  id: text('id').primaryKey(),
  agentRunId: text('agent_run_id').notNull().references(() => agentRuns.id, { onDelete: 'cascade' }),
  agentStepId: text('agent_step_id').references(() => agentSteps.id, { onDelete: 'set null' }),
  toolName: varchar('tool_name', { length: 120 }).notNull(),
  status: varchar('status', { length: 30 }).notNull(),
  arguments: jsonb('arguments').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  resultMetadata: jsonb('result_metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
  durationMs: integer('duration_ms'),
  errorCode: varchar('error_code', { length: 120 }),
  errorMessage: text('error_message')
}, (table) => [index('tool_executions_run_step_idx').on(table.agentRunId, table.agentStepId)]);

export const refreshTokens = pgTable('refresh_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  userAgent: varchar('user_agent', { length: 500 }),
  ipHash: varchar('ip_hash', { length: 64 })
}, (table) => [
  uniqueIndex('refresh_tokens_hash_unique').on(table.tokenHash),
  index('refresh_tokens_user_expiry_idx').on(table.userId, table.expiresAt)
]);

export const websocketTickets = pgTable('websocket_tickets', {
  id: text('id').primaryKey(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  purpose: varchar('purpose', { length: 60 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('websocket_tickets_hash_unique').on(table.tokenHash),
  index('websocket_tickets_expiry_idx').on(table.expiresAt)
]);

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 160 }).notNull(),
  resourceType: varchar('resource_type', { length: 100 }),
  resourceId: text('resource_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  requestId: varchar('request_id', { length: 160 }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
}, (table) => [
  index('audit_logs_user_created_idx').on(table.userId, table.createdAt),
  index('audit_logs_resource_idx').on(table.resourceType, table.resourceId)
]);

export type UserRow = typeof users.$inferSelect;
export type ProviderRow = typeof providers.$inferSelect;
export type IntegrationRow = typeof integrations.$inferSelect;
export type ChatRow = typeof chats.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;
export type AgentRunRow = typeof agentRuns.$inferSelect;
