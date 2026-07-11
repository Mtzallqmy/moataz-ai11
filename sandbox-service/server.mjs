import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const port = Number(process.env.PORT || 8080);
const token = process.env.SANDBOX_TOKEN || '';
const workspaceRoot = path.resolve(process.env.SANDBOX_WORKSPACE_DIR || '/workspace');
const defaultTimeoutMs = positiveInt(process.env.SANDBOX_DEFAULT_TIMEOUT_MS, 120_000);
const maxTimeoutMs = positiveInt(process.env.SANDBOX_MAX_TIMEOUT_MS, 300_000);
const maxOutputBytes = positiveInt(process.env.SANDBOX_MAX_OUTPUT_BYTES, 1_048_576);
const maxBodyBytes = positiveInt(process.env.SANDBOX_MAX_BODY_BYTES, 65_536);

if (token.length < 32) {
  console.error('SANDBOX_TOKEN must be at least 32 characters.');
  process.exit(1);
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function requestId(req) {
  const supplied = req.headers['x-request-id'];
  return typeof supplied === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(supplied) ? supplied : crypto.randomUUID();
}

function send(res, status, payload, id) {
  const body = JSON.stringify({ ...payload, requestId: id });
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Request-Id': id
  });
  res.end(body);
}

function authorized(req) {
  const header = req.headers.authorization || '';
  const candidate = /^Bearer\s+(.+)$/i.exec(header)?.[1] || '';
  if (candidate.length !== token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(token));
}

async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBodyBytes) throw Object.assign(new Error('request_too_large'), { status: 413, code: 'request_too_large' });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error('invalid_json'), { status: 400, code: 'invalid_json' }); }
}

function safeUserId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : 'default';
}

function minimalEnvironment(home) {
  const env = {
    HOME: home,
    PWD: home,
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    LANG: process.env.LANG || 'C.UTF-8',
    CI: 'true'
  };
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

async function execute(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('invalid_request'), { status: 400, code: 'invalid_request' });
  const command = typeof body.command === 'string' ? body.command.trim() : '';
  if (!command || command.length > 8192) throw Object.assign(new Error('invalid_command'), { status: 422, code: 'invalid_command' });
  const requestedTimeout = positiveInt(body.timeoutMs, defaultTimeoutMs);
  const timeoutMs = Math.min(requestedTimeout, maxTimeoutMs);
  const userId = safeUserId(body.userId);
  const cwd = path.join(workspaceRoot, userId);
  await fs.mkdir(cwd, { recursive: true, mode: 0o700 });

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn('/bin/bash', ['--noprofile', '--norc', '-lc', command], {
      cwd,
      env: minimalEnvironment(cwd),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let timedOut = false;

    const capture = (target, chunk, kind) => {
      const current = kind === 'stdout' ? stdoutBytes : stderrBytes;
      const remaining = Math.max(0, maxOutputBytes - current);
      if (remaining === 0) { truncated = true; return; }
      const value = chunk.subarray(0, remaining);
      target.push(value);
      if (kind === 'stdout') stdoutBytes += value.length; else stderrBytes += value.length;
      if (value.length < chunk.length) truncated = true;
    };
    child.stdout.on('data', (chunk) => capture(stdout, Buffer.from(chunk), 'stdout'));
    child.stderr.on('data', (chunk) => capture(stderr, Buffer.from(chunk), 'stderr'));
    child.on('error', (error) => resolve({ ok: false, code: null, signal: null, stdout: '', stderr: error.message, truncated: false, timedOut: false, durationMs: Date.now() - startedAt }));
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, 1500).unref();
    }, timeoutMs);
    timer.unref();
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        truncated,
        timedOut,
        durationMs: Date.now() - startedAt
      });
    });
  });
}

await fs.mkdir(workspaceRoot, { recursive: true, mode: 0o700 });

const server = http.createServer(async (req, res) => {
  const id = requestId(req);
  try {
    if (req.method === 'GET' && req.url === '/health') {
      send(res, 200, { ok: true, service: 'moataz-external-sandbox', version: '1.0.0' }, id);
      return;
    }
    if (!authorized(req)) {
      send(res, 401, { ok: false, error: 'unauthorized' }, id);
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/execute') {
      const result = await execute(await readJson(req));
      send(res, result.ok ? 200 : result.timedOut ? 504 : 422, result, id);
      return;
    }
    send(res, 404, { ok: false, error: 'not_found' }, id);
  } catch (error) {
    const status = Number(error?.status) || 500;
    const code = typeof error?.code === 'string' ? error.code : 'internal_error';
    send(res, status, { ok: false, error: code }, id);
  }
});

server.requestTimeout = maxTimeoutMs + 10_000;
server.headersTimeout = 15_000;
server.listen(port, '0.0.0.0', () => console.log(`sandbox_ready port=${port}`));

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
