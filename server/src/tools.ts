import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { Octokit } from '@octokit/rest';
import TelegramBot from 'node-telegram-bot-api';
import { z } from 'zod';
import { config } from './config.js';
import { AppError } from './errors.js';
import { redactSecrets } from './redaction.js';
import { upstreamAppError } from './upstream-errors.js';
import { fetchWithValidatedRedirects, htmlToText, readLimitedText } from './network.js';

export type IntegrationCredential = {
  type: string;
  token: string;
  meta: Record<string, unknown>;
};

export type ToolRole = 'admin' | 'user';
export type ToolRisk = 'low' | 'medium' | 'high';
export type ToolContext = {
  userId: string;
  role: ToolRole;
  confirmed: boolean;
  integrations?: readonly IntegrationCredential[];
};

export type ToolDefinition = {
  name: string;
  description: string;
  risk: ToolRisk;
  requiresConfirmation: boolean;
  roles: readonly ToolRole[];
  inputSchema: z.ZodType<Record<string, unknown>>;
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<unknown>;
};

const protectedNames = new Set(['.git', '.ssh', 'node_modules', 'secrets', 'credentials']);

function pathSegments(input: string): string[] {
  return input.split(/[\\/]+/).filter((segment) => segment !== '' && segment !== '.');
}

function assertSafeRelativePath(input: unknown, allowRoot = true): string {
  if (typeof input !== 'string') throw new AppError('invalid_path', 400);
  if (input.includes('\0')) throw new AppError('invalid_path', 400);
  if (path.isAbsolute(input) || path.win32.isAbsolute(input)) throw new AppError('absolute_path_not_allowed', 400);
  const segments = pathSegments(input);
  if (segments.includes('..')) throw new AppError('path_traversal', 400);
  if (!allowRoot && segments.length === 0) throw new AppError('invalid_path', 400);
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (lower === '.env' || lower.startsWith('.env.') || protectedNames.has(lower)) {
      throw new AppError('protected_path', 403);
    }
  }
  return segments.join(path.sep) || '.';
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function ensureNoSymlinkSegments(root: string, relativePath: string, requireAll = true): Promise<void> {
  const segments = pathSegments(relativePath);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new AppError('symlink_not_allowed', 403);
    } catch (error) {
      if (error instanceof AppError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' && !requireAll) return;
      throw error;
    }
  }
}

export async function ensureWorkspaceRoot(root: string): Promise<string> {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const real = await fs.realpath(root);
  const stat = await fs.lstat(real);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new AppError('invalid_workspace', 500);
  return real;
}

export async function getUserRoot(userId: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) throw new AppError('invalid_user_id', 400);
  const base = await ensureWorkspaceRoot(path.resolve(config.workspaceDir));
  const candidate = path.resolve(base, userId);
  if (!isWithin(base, candidate)) throw new AppError('invalid_workspace', 500);
  return ensureWorkspaceRoot(candidate);
}

export async function resolveExistingPath(root: string, input: unknown): Promise<string> {
  const relative = assertSafeRelativePath(input);
  const rootReal = await ensureWorkspaceRoot(root);
  await ensureNoSymlinkSegments(rootReal, relative, true);
  const candidate = path.resolve(rootReal, relative);
  const real = await fs.realpath(candidate);
  if (!isWithin(rootReal, real)) throw new AppError('path_outside_workspace', 403);
  return real;
}

export async function resolveWriteTarget(root: string, input: unknown): Promise<string> {
  const relative = assertSafeRelativePath(input, false);
  const rootReal = await ensureWorkspaceRoot(root);
  const candidate = path.resolve(rootReal, relative);
  if (!isWithin(rootReal, candidate)) throw new AppError('path_outside_workspace', 403);

  await ensureNoSymlinkSegments(rootReal, relative, false);
  let parent = path.dirname(candidate);
  while (!fss.existsSync(parent)) {
    const next = path.dirname(parent);
    if (next === parent) throw new AppError('path_outside_workspace', 403);
    parent = next;
  }
  const parentReal = await fs.realpath(parent);
  if (!isWithin(rootReal, parentReal)) throw new AppError('path_outside_workspace', 403);
  const parentStat = await fs.lstat(parentReal);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new AppError('invalid_parent_path', 400);

  if (fss.existsSync(candidate)) {
    const targetStat = await fs.lstat(candidate);
    if (targetStat.isSymbolicLink()) throw new AppError('symlink_not_allowed', 403);
    const targetReal = await fs.realpath(candidate);
    if (!isWithin(rootReal, targetReal)) throw new AppError('path_outside_workspace', 403);
  }
  return candidate;
}

async function assertRegularFile(file: string): Promise<import('node:fs').Stats> {
  const stat = await fs.lstat(file);
  if (stat.isSymbolicLink()) throw new AppError('symlink_not_allowed', 403);
  if (!stat.isFile()) throw new AppError('not_a_regular_file', 400);
  return stat;
}

async function createParentDirectories(root: string, target: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const relativeParent = path.relative(root, path.dirname(target));
  await ensureNoSymlinkSegments(root, relativeParent, true);
  const parentReal = await fs.realpath(path.dirname(target));
  if (!isWithin(root, parentReal)) throw new AppError('path_outside_workspace', 403);
}

async function atomicWrite(root: string, target: string, content: string): Promise<void> {
  await createParentDirectories(root, target);
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temp, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

function enforceOutputLimit(result: unknown): unknown {
  const redacted = redactSecrets(result);
  const encoded = JSON.stringify(redacted);
  if (Buffer.byteLength(encoded, 'utf8') > config.maxToolOutputBytes) {
    throw new AppError('tool_output_too_large', 413);
  }
  return redacted;
}

const listSchema = z.object({
  path: z.string().default('.'),
  recursive: z.boolean().default(false),
  maxDepth: z.number().int().min(0).max(config.maxListDepth).optional()
}).strict();
const pathSchema = z.object({ path: z.string() }).strict();
const writeSchema = z.object({ path: z.string(), content: z.string() }).strict();
const moveSchema = z.object({ from: z.string(), to: z.string() }).strict();
const githubRepoSchema = z.object({ repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/) }).strict();
const githubIssueSchema = githubRepoSchema.extend({ title: z.string().min(1).max(256), body: z.string().max(65_536).default('') }).strict();
const telegramSchema = z.object({ chatId: z.union([z.string(), z.number()]).optional(), text: z.string().min(1).max(4096) }).strict();
const shellSchema = z.object({ command: z.string().min(1).max(8192), timeoutMs: z.number().int().min(1000).max(300_000).optional() }).strict();
const webFetchSchema = z.object({ url: z.string().url().max(2048), maxChars: z.number().int().min(500).max(100_000).default(20_000) }).strict();
const webSearchSchema = z.object({ query: z.string().trim().min(1).max(500), count: z.number().int().min(1).max(10).default(5) }).strict();

async function listEntries(root: string, directory: string, recursive: boolean, maxDepth: number): Promise<Array<Record<string, unknown>>> {
  const output: Array<Record<string, unknown>> = [];
  const walk = async (current: string, depth: number): Promise<void> => {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (output.length >= config.maxListEntries) throw new AppError('listing_limit_exceeded', 413);
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute);
      try {
        assertSafeRelativePath(relative);
      } catch (error) {
        if (error instanceof AppError && error.code === 'protected_path') continue;
        throw error;
      }
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) continue;
      const type = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
      output.push({ path: relative.split(path.sep).join('/'), type, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() });
      if (recursive && stat.isDirectory() && depth < maxDepth) await walk(absolute, depth + 1);
    }
  };
  await walk(directory, 0);
  return output;
}

function requiredIntegration(context: ToolContext, type: string): IntegrationCredential {
  const integration = context.integrations?.find((entry) => entry.type === type);
  if (!integration) throw new AppError(`${type}_integration_not_configured`, 400);
  return integration;
}

function parseJsonPayload<T>(raw: string, service: string, status: number): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new AppError('integration_invalid_response', 502, `${service} returned invalid JSON.`, { upstreamStatus: status });
  }
}

const definitions: ToolDefinition[] = [
  {
    name: 'list_files', description: 'List workspace files', risk: 'low', requiresConfirmation: false, roles: ['admin', 'user'], inputSchema: listSchema,
    execute: async (args, context) => {
      const input = listSchema.parse(args);
      const root = await getUserRoot(context.userId);
      const directory = await resolveExistingPath(root, input.path);
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory()) throw new AppError('not_a_directory', 400);
      return { entries: await listEntries(root, directory, input.recursive, input.maxDepth ?? config.maxListDepth) };
    }
  },
  {
    name: 'read_file', description: 'Read a workspace text file', risk: 'low', requiresConfirmation: false, roles: ['admin', 'user'], inputSchema: pathSchema,
    execute: async (args, context) => {
      const input = pathSchema.parse(args);
      const root = await getUserRoot(context.userId);
      const file = await resolveExistingPath(root, input.path);
      const stat = await assertRegularFile(file);
      if (stat.size > config.maxFileBytes) throw new AppError('file_too_large', 413);
      return { path: input.path, content: await fs.readFile(file, 'utf8'), sizeBytes: stat.size };
    }
  },
  {
    name: 'write_file', description: 'Create or update a workspace text file atomically', risk: 'medium', requiresConfirmation: false, roles: ['admin', 'user'], inputSchema: writeSchema,
    execute: async (args, context) => {
      const input = writeSchema.parse(args);
      const bytes = Buffer.byteLength(input.content, 'utf8');
      if (bytes > config.maxFileBytes) throw new AppError('file_too_large', 413);
      const root = await getUserRoot(context.userId);
      const file = await resolveWriteTarget(root, input.path);
      if (fss.existsSync(file)) await assertRegularFile(file);
      await atomicWrite(root, file, input.content);
      return { path: input.path, sizeBytes: bytes, written: true };
    }
  },
  {
    name: 'create_directory', description: 'Create a workspace directory', risk: 'medium', requiresConfirmation: false, roles: ['admin', 'user'], inputSchema: pathSchema,
    execute: async (args, context) => {
      const input = pathSchema.parse(args);
      const root = await getUserRoot(context.userId);
      const directory = await resolveWriteTarget(root, input.path);
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await ensureNoSymlinkSegments(root, path.relative(root, directory), true);
      return { path: input.path, created: true };
    }
  },
  {
    name: 'delete_file', description: 'Delete a regular workspace file', risk: 'high', requiresConfirmation: true, roles: ['admin', 'user'], inputSchema: pathSchema,
    execute: async (args, context) => {
      const input = pathSchema.parse(args);
      const root = await getUserRoot(context.userId);
      const file = await resolveExistingPath(root, input.path);
      await assertRegularFile(file);
      await fs.unlink(file);
      return { path: input.path, deleted: true };
    }
  },
  {
    name: 'move_path', description: 'Move or rename a workspace file or directory', risk: 'high', requiresConfirmation: true, roles: ['admin', 'user'], inputSchema: moveSchema,
    execute: async (args, context) => {
      const input = moveSchema.parse(args);
      const root = await getUserRoot(context.userId);
      const source = await resolveExistingPath(root, input.from);
      const sourceStat = await fs.lstat(source);
      if (sourceStat.isSymbolicLink() || (!sourceStat.isFile() && !sourceStat.isDirectory())) throw new AppError('unsupported_file_type', 400);
      const target = await resolveWriteTarget(root, input.to);
      if (fss.existsSync(target)) throw new AppError('target_exists', 409);
      await createParentDirectories(root, target);
      await fs.rename(source, target);
      return { from: input.from, to: input.to, moved: true };
    }
  },
  {
    name: 'file_stat', description: 'Get safe metadata for a workspace path', risk: 'low', requiresConfirmation: false, roles: ['admin', 'user'], inputSchema: pathSchema,
    execute: async (args, context) => {
      const input = pathSchema.parse(args);
      const root = await getUserRoot(context.userId);
      const target = await resolveExistingPath(root, input.path);
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink()) throw new AppError('symlink_not_allowed', 403);
      return { path: input.path, type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other', sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() };
    }
  },
  {
    name: 'shell', description: 'Run a command in a configured external sandbox service', risk: 'high', requiresConfirmation: true, roles: ['admin'], inputSchema: shellSchema,
    execute: async (args, context) => {
      const input = shellSchema.parse(args);
      const integration = requiredIntegration(context, 'sandbox');
      const baseUrl = typeof integration.meta.baseUrl === 'string' ? integration.meta.baseUrl.trim().replace(/\/$/, '') : '';
      if (!baseUrl) throw new AppError('sandbox_base_url_required', 400);
      const response = await fetchWithValidatedRedirects(`${baseUrl}/v1/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${integration.token}` },
        body: JSON.stringify({ command: input.command, timeoutMs: input.timeoutMs ?? config.sandboxTimeoutMs, userId: context.userId })
      }, { timeoutMs: input.timeoutMs ?? config.sandboxTimeoutMs, maxRedirects: 0 });
      const text = await readLimitedText(response, config.maxToolOutputBytes);
      let payload: unknown = text;
      try { payload = JSON.parse(text) as unknown; } catch { /* return text */ }
      if (!response.ok) throw new AppError('sandbox_execution_failed', 502, 'The sandbox execution failed.', { upstreamStatus: response.status, response: payload });
      return { status: response.status, output: payload };
    }
  },
  {
    name: 'web_fetch', description: 'Fetch and extract readable text from a public HTTP or HTTPS page', risk: 'low', requiresConfirmation: false, roles: ['admin', 'user'], inputSchema: webFetchSchema,
    execute: async (args) => {
      const input = webFetchSchema.parse(args);
      const response = await fetchWithValidatedRedirects(input.url, {
        method: 'GET', headers: { Accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5', 'User-Agent': 'MoatazAI/1.0' }
      }, { timeoutMs: config.webFetchTimeoutMs, maxRedirects: 3 });
      const raw = await readLimitedText(response, config.maxWebFetchBytes);
      const contentType = response.headers.get('content-type') ?? '';
      const text = /text\/html|application\/xhtml\+xml/i.test(contentType) ? htmlToText(raw) : raw.trim();
      if (!response.ok) throw new AppError('web_fetch_failed', 502, 'The page returned an error.', { upstreamStatus: response.status, url: response.url });
      return { url: response.url, status: response.status, contentType, text: text.slice(0, input.maxChars), truncated: text.length > input.maxChars };
    }
  },
  {
    name: 'web_search', description: 'Search the public web using a verified Brave Search or Tavily integration', risk: 'low', requiresConfirmation: false, roles: ['admin', 'user'], inputSchema: webSearchSchema,
    execute: async (args, context) => {
      const input = webSearchSchema.parse(args);
      const integration = context.integrations?.find((entry) => entry.type === 'brave_search' || entry.type === 'tavily');
      if (!integration) throw new AppError('web_search_integration_not_configured', 400);
      if (integration.type === 'brave_search') {
        const url = new URL('https://api.search.brave.com/res/v1/web/search');
        url.searchParams.set('q', input.query);
        url.searchParams.set('count', String(input.count));
        const response = await fetchWithValidatedRedirects(url.toString(), {
          method: 'GET', headers: { Accept: 'application/json', 'X-Subscription-Token': integration.token }
        }, { timeoutMs: config.webFetchTimeoutMs, maxRedirects: 0 });
        const raw = await readLimitedText(response, config.maxWebFetchBytes);
        const payload = parseJsonPayload<{ web?: { results?: Array<{ title?: string; url?: string; description?: string }> } }>(raw, 'Brave Search', response.status);
        if (!response.ok) throw new AppError('web_search_failed', 502, 'Brave Search returned an error.', { upstreamStatus: response.status });
        return { provider: 'brave_search', results: (payload.web?.results ?? []).slice(0, input.count).map((item) => ({ title: item.title ?? '', url: item.url ?? '', snippet: item.description ?? '' })) };
      }
      const response = await fetchWithValidatedRedirects('https://api.tavily.com/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: integration.token, query: input.query, max_results: input.count, search_depth: 'basic' })
      }, { timeoutMs: config.webFetchTimeoutMs, maxRedirects: 0 });
      const raw = await readLimitedText(response, config.maxWebFetchBytes);
      const payload = parseJsonPayload<{ results?: Array<{ title?: string; url?: string; content?: string }> }>(raw, 'Tavily', response.status);
      if (!response.ok) throw new AppError('web_search_failed', 502, 'Tavily returned an error.', { upstreamStatus: response.status });
      return { provider: 'tavily', results: (payload.results ?? []).slice(0, input.count).map((item) => ({ title: item.title ?? '', url: item.url ?? '', snippet: item.content ?? '' })) };
    }
  },
  {
    name: 'github_repo_info', description: 'Read GitHub repository metadata', risk: 'low', requiresConfirmation: false, roles: ['admin', 'user'], inputSchema: githubRepoSchema,
    execute: async (args, context) => {
      const input = githubRepoSchema.parse(args);
      const integration = requiredIntegration(context, 'github');
      const [owner, repo] = input.repo.split('/') as [string, string];
      try {
        const response = await new Octokit({ auth: integration.token }).repos.get({ owner, repo });
        return { name: response.data.full_name, description: response.data.description, defaultBranch: response.data.default_branch, stars: response.data.stargazers_count };
      } catch (error) {
        throw upstreamAppError('integration', 'github', error);
      }
    }
  },
  {
    name: 'github_create_issue', description: 'Create a GitHub issue after explicit confirmation', risk: 'high', requiresConfirmation: true, roles: ['admin', 'user'], inputSchema: githubIssueSchema,
    execute: async (args, context) => {
      const input = githubIssueSchema.parse(args);
      const integration = requiredIntegration(context, 'github');
      const [owner, repo] = input.repo.split('/') as [string, string];
      try {
        const response = await new Octokit({ auth: integration.token }).issues.create({ owner, repo, title: input.title, body: input.body });
        return { url: response.data.html_url, number: response.data.number };
      } catch (error) {
        throw upstreamAppError('integration', 'github', error);
      }
    }
  },
  {
    name: 'telegram_send', description: 'Send a Telegram message after explicit confirmation', risk: 'high', requiresConfirmation: true, roles: ['admin', 'user'], inputSchema: telegramSchema,
    execute: async (args, context) => {
      const input = telegramSchema.parse(args);
      const integration = requiredIntegration(context, 'telegram');
      const configuredChatId = integration.meta.chatId;
      const chatId = input.chatId ?? (typeof configuredChatId === 'string' || typeof configuredChatId === 'number' ? configuredChatId : undefined);
      if (chatId === undefined) throw new AppError('telegram_chat_id_required', 400);
      const bot = new TelegramBot(integration.token, { polling: false });
      try {
        const sent = await bot.sendMessage(chatId, input.text);
        return { sent: true, messageId: sent.message_id, chatId: sent.chat.id };
      } catch (error) {
        throw upstreamAppError('integration', 'telegram', error);
      }
    }
  }
];

const toolParameters: Record<string, Record<string, unknown>> = {
  list_files: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, recursive: { type: 'boolean' }, maxDepth: { type: 'integer', minimum: 0 } } },
  read_file: { type: 'object', additionalProperties: false, required: ['path'], properties: { path: { type: 'string' } } },
  write_file: { type: 'object', additionalProperties: false, required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } },
  create_directory: { type: 'object', additionalProperties: false, required: ['path'], properties: { path: { type: 'string' } } },
  delete_file: { type: 'object', additionalProperties: false, required: ['path'], properties: { path: { type: 'string' } } },
  move_path: { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' } } },
  file_stat: { type: 'object', additionalProperties: false, required: ['path'], properties: { path: { type: 'string' } } },
  shell: { type: 'object', additionalProperties: false, required: ['command'], properties: { command: { type: 'string' }, timeoutMs: { type: 'integer', minimum: 1000, maximum: 300000 } } },
  web_fetch: { type: 'object', additionalProperties: false, required: ['url'], properties: { url: { type: 'string', format: 'uri' }, maxChars: { type: 'integer', minimum: 500, maximum: 100000 } } },
  web_search: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string' }, count: { type: 'integer', minimum: 1, maximum: 10 } } },
  github_repo_info: { type: 'object', additionalProperties: false, required: ['repo'], properties: { repo: { type: 'string' } } },
  github_create_issue: { type: 'object', additionalProperties: false, required: ['repo', 'title'], properties: { repo: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } } },
  telegram_send: { type: 'object', additionalProperties: false, required: ['text'], properties: { chatId: { anyOf: [{ type: 'string' }, { type: 'number' }] }, text: { type: 'string' } } }
};

export const toolRegistry = new Map(definitions.map((definition) => [definition.name, definition] as const));
export const toolCatalog = definitions.map(({ name, description, risk, requiresConfirmation, roles }) => ({ name, description, risk, requiresConfirmation, roles, parameters: toolParameters[name] ?? { type: 'object', additionalProperties: true } }));

export async function runTool(name: string, args: unknown, context: ToolContext): Promise<unknown> {
  const definition = toolRegistry.get(name);
  if (!definition) throw new AppError('unknown_tool', 404);
  if (!definition.roles.includes(context.role)) throw new AppError('tool_forbidden', 403);
  if (definition.requiresConfirmation && !context.confirmed) throw new AppError('confirmation_required', 409);
  const parsed = definition.inputSchema.safeParse(args);
  if (!parsed.success) throw new AppError('invalid_tool_arguments', 400, 'invalid_tool_arguments', parsed.error.issues);
  const result = await definition.execute(parsed.data, context);
  return enforceOutputLimit(result);
}
