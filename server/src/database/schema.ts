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
  uniqueIndex
} from 'drizzle-orm/pg-core';

const createdAt = timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow();

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull().default('user'),
  isActive: boolean('is_active_bool').notNull().default(true),
  legacyIsActive: integer('is_active').notNull().default(1),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'string' }),
  createdAt,
  updatedAt
}, (table) => [
  uniqueIndex('users_email_unique').on(table.email),
  check('users_role_check', sql`${table.role} in ('admin', 'user')`)
]);

export const refreshTokens = pgTable('refresh_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'string' }),
  userAgent: text('user_agent'),
  ipHash: text('ip_hash'),
  deviceMeta: jsonb('device_meta').$type<Record<string, unknown>>().notNull().default({}),
  createdAt
}, (table) => [
  uniqueIndex('refresh_tokens_hash_unique').on(table.tokenHash),
  index('refresh_tokens_user_expiry_idx').on(table.userId, table.expiresAt),
  index('refresh_tokens_active_idx').on(table.userId, table.revokedAt, table.expiresAt)
]);

export const providers = pgTable('providers', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  providerType: text('type').notNull(),
  protocol: text('protocol').notNull().default('openai-compatible'),
  legacyBaseUrl: text('base_url'),
  rawBaseUrl: text('raw_base_url'),
  normalizedBaseUrl: text('normalized_base_url'),
  encryptedApiKey: text('api_key_enc').notNull(),
  encryptionVersion: integer('encryption_version').notNull().default(1),
  selectedModel: text('default_model').notNull(),
  discoveredModels: jsonb('discovered_models').$type<Array<Record<string, unknown>>>().notNull().default([]),
  capabilities: jsonb('capabilities').$type<Record<string, boolean | null>>().notNull().default({}),
  status: text('status').notNull().default('draft'),
  legacyValidationStatus: text('validation_status').notNull().default('untested'),
  legacyValidationErrorCode: text('validation_error_code'),
  legacyValidatedAt: timestamp('validated_at', { withTimezone: true, mode: 'string' }),
  lastCheckStatus: text('last_check_status'),
  lastCheckCode: text('last_check_code'),
  lastCheckMessage: text('last_check_message'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true, mode: 'string' }),
  lastLatencyMs: integer('last_latency_ms'),
  failureCount: integer('failure_count').notNull().default(0),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true, mode: 'string' }),
  isEnabled: boolean('is_enabled').notNull().default(true),
  isReady: boolean('is_ready').notNull().default(false),
  legacyIsActive: integer('is_active').notNull().default(1),
  createdAt,
  updatedAt
}, (table) => [
  index('providers_user_status_idx').on(table.userId, table.status, table.isEnabled),
  index('providers_user_ready_idx').on(table.userId, table.isReady, table.isEnabled),
  check('providers_status_check', sql`${table.status} in ('draft','testing','ready','temporarily_unavailable','invalid_credentials','disabled','configuration_error')`),
  check('providers_protocol_check', sql`${table.protocol} in ('openai-compatible','anthropic','gemini')`)
]);

export const providerModels = pgTable('provider_models', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull().references(() => providers.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  modelId: text('model_id').notNull(),
  name: text('name'),
  ownedBy: text('owned_by'),
  contextLength: integer('context_length'),
  capabilities: jsonb('capabilities').$type<Record<string, boolean | null>>().notNull().default({}),
  discoveredAt: timestamp('discovered_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull()
}, (table) => [
  uniqueIndex('provider_models_provider_model_unique').on(table.providerId, table.modelId),
  index('provider_models_user_expiry_idx').on(table.userId, table.expiresAt)
]);

export const integrations = pgTable('integrations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  name: text('name').notNull(),
  encryptedToken: text('token_enc').notNull(),
  encryptionVersion: integer('encryption_version').notNull().default(1),
  legacyMeta: text('meta'),
  meta: jsonb('meta_jsonb').$type<Record<string, unknown>>().notNull().default({}),
  validationStatus: text('validation_status').notNull().default('untested'),
  validationErrorCode: text('validation_error_code'),
  validatedAt: timestamp('validated_at', { withTimezone: true, mode: 'string' }),
  isEnabled: boolean('is_enabled').notNull().default(true),
  legacyIsActive: integer('is_active').notNull().default(1),
  createdAt,
  updatedAt
}, (table) => [
  index('integrations_user_type_idx').on(table.userId, table.type, table.isEnabled)
]);

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  createdAt,
  updatedAt
}, (table) => [index('projects_user_idx').on(table.userId, table.createdAt)]);

export const chats = pgTable('chats', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  title: text('title').notNull().default('New chat'),
  providerId: text('provider_id').references(() => providers.id, { onDelete: 'set null' }),
  model: text('model'),
  mode: text('mode').notNull().default('agent'),
  createdAt,
  updatedAt
}, (table) => [
  index('chats_user_updated_idx').on(table.userId, table.updatedAt),
  index('chats_provider_idx').on(table.providerId),
  check('chats_mode_check', sql`${table.mode} in ('chat','agent','multi-agent')`)
]);

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  chatId: text('chat_id').references(() => chats.id, { onDelete: 'cascade' }),
  rootPath: text('root_path').notNull(),
  storagePrefix: text('storage_prefix'),
  status: text('status').notNull().default('active'),
  createdAt,
  updatedAt
}, (table) => [
  index('workspaces_user_idx').on(table.userId),
  uniqueIndex('workspaces_chat_unique').on(table.chatId)
]);

export const files = pgTable('files', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  storageKey: text('storage_key').notNull(),
  mimeType: text('mime_type'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
  checksum: text('checksum'),
  createdAt,
  updatedAt
}, (table) => [
  uniqueIndex('files_workspace_path_unique').on(table.workspaceId, table.path),
  index('files_user_workspace_idx').on(table.userId, table.workspaceId)
]);

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sequence: bigint('sequence', { mode: 'number' }).notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  legacyToolCalls: text('tool_calls'),
  toolCalls: jsonb('tool_calls_jsonb').$type<Array<Record<string, unknown>>>().notNull().default([]),
  idempotencyKey: text('idempotency_key'),
  createdAt
}, (table) => [
  uniqueIndex('messages_chat_sequence_unique').on(table.chatId, table.sequence),
  uniqueIndex('messages_chat_idempotency_unique').on(table.chatId, table.idempotencyKey),
  index('messages_chat_created_idx').on(table.chatId, table.createdAt),
  check('messages_role_check', sql`${table.role} in ('system','user','assistant','tool')`)
]);

export const attachments = pgTable('attachments', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  storagePath: text('storage_path').notNull(),
  sha256: text('sha256').notNull(),
  createdAt
}, (table) => [
  index('attachments_chat_message_idx').on(table.chatId, table.messageId),
  index('attachments_user_created_idx').on(table.userId, table.createdAt)
]);

export const agentRuns = pgTable('agent_runs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  chatId: text('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').references(() => providers.id, { onDelete: 'set null' }),
  model: text('model'),
  status: text('status').notNull(),
  legacyLog: text('log'),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
  legacyCompletedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
  cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true, mode: 'string' }),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  totalTokens: integer('total_tokens'),
  estimatedCost: numeric('estimated_cost', { precision: 18, scale: 8 }),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  createdAt,
  updatedAt
}, (table) => [
  index('agent_runs_chat_status_idx').on(table.chatId, table.status),
  index('agent_runs_user_created_idx').on(table.userId, table.createdAt),
  check('agent_runs_status_check', sql`${table.status} in ('queued','running','completed','failed','cancelled')`)
]);

export const agentSteps = pgTable('agent_steps', {
  id: text('id').primaryKey(),
  agentRunId: text('agent_run_id').notNull().references(() => agentRuns.id, { onDelete: 'cascade' }),
  stepNumber: integer('step_number').notNull(),
  type: text('type').notNull(),
  status: text('status').notNull(),
  inputMeta: jsonb('input_meta').$type<Record<string, unknown>>().notNull().default({}),
  outputMeta: jsonb('output_meta').$type<Record<string, unknown>>().notNull().default({}),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
  durationMs: integer('duration_ms'),
  errorCode: text('error_code'),
  errorMessage: text('error_message')
}, (table) => [
  uniqueIndex('agent_steps_run_number_unique').on(table.agentRunId, table.stepNumber),
  index('agent_steps_run_status_idx').on(table.agentRunId, table.status)
]);

export const toolExecutions = pgTable('tool_executions', {
  id: text('id').primaryKey(),
  agentRunId: text('agent_run_id').notNull().references(() => agentRuns.id, { onDelete: 'cascade' }),
  agentStepId: text('agent_step_id').references(() => agentSteps.id, { onDelete: 'cascade' }),
  toolName: text('tool_name').notNull(),
  status: text('status').notNull(),
  arguments: jsonb('arguments').$type<Record<string, unknown>>().notNull().default({}),
  resultMeta: jsonb('result_meta').$type<Record<string, unknown>>().notNull().default({}),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
  durationMs: integer('duration_ms'),
  errorCode: text('error_code'),
  errorMessage: text('error_message')
}, (table) => [
  index('tool_executions_run_step_idx').on(table.agentRunId, table.agentStepId),
  index('tool_executions_tool_status_idx').on(table.toolName, table.status)
]);

export const websocketTickets = pgTable('websocket_tickets', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  purpose: text('purpose').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true, mode: 'string' }),
  createdAt
}, (table) => [
  uniqueIndex('websocket_tickets_hash_unique').on(table.tokenHash),
  index('websocket_tickets_expiry_idx').on(table.expiresAt, table.usedAt)
]);

export type UserRow = typeof users.$inferSelect;
export type ProviderRow = typeof providers.$inferSelect;
export type ChatRow = typeof chats.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
