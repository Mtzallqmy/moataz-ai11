import type { Express } from 'express';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { z } from 'zod';
import { auth, type AuthRequest, requireAdmin } from './auth.js';
import { config } from './config.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';
import { parseInput } from './validation.js';
import { consumeTerminalTicket, issueTerminalTicket } from './ws-tickets.js';

const inputSchema = z.object({ type: z.literal('input'), data: z.string() }).strict();

type TerminalSocket = WebSocket & {
  isAlive: boolean;
  userId: string;
  child?: ChildProcessWithoutNullStreams;
  idleTimer?: NodeJS.Timeout;
  sessionTimer?: NodeJS.Timeout;
};

export type TerminalController = {
  close: () => Promise<void>;
  activeConnections: () => number;
};

function shellEnvironment(userRoot: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { HOME: userRoot, PWD: userRoot, TERM: 'xterm-256color' };
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'LANGUAGE']) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

function allowedOrigin(origin: string | undefined): boolean {
  if (!origin) return !config.isProduction;
  try {
    const normalized = new URL(origin).origin;
    if (config.isProduction) return config.corsOrigins.includes(normalized);
    return normalized === config.appOrigin || /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(normalized);
  } catch {
    return false;
  }
}

function rejectUpgrade(request: IncomingMessage, socket: import('node:stream').Duplex, status: number, code: string): void {
  logger.warn('terminal_upgrade_rejected', { status, code, origin: request.headers.origin });
  socket.write(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Forbidden'}\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ error: code })}`);
  socket.destroy();
}

function sendJson(ws: WebSocket, value: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
}

function stopChild(child: ChildProcessWithoutNullStreams | undefined): void {
  if (!child || child.killed) return;
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch {
    child.kill('SIGKILL');
  }
}

export function terminalRoutes(app: Express): void {
  app.post('/api/auth/ws-ticket', auth, requireAdmin, async (req: AuthRequest, res, next): Promise<void> => {
    try {
      parseInput(z.object({}).strict(), req.body ?? {});
      if (!config.shellAvailable) throw new AppError('shell_unavailable', 503);
      const result = await issueTerminalTicket(req.user!.id);
      res.status(201).json({ ...result, purpose: 'terminal' });
    } catch (error) {
      next(error);
    }
  });
}

export function attachTerminal(server: HttpServer): TerminalController {
  const wss = new WebSocketServer({ noServer: true, clientTracking: true });
  const connectionsByUser = new Map<string, number>();
  const children = new Set<ChildProcessWithoutNullStreams>();

  const upgradeHandler = (request: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer): void => {
    void (async () => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      if (url.pathname !== '/ws/terminal') return;
      if (!config.shellAvailable) {
        rejectUpgrade(request, socket, 503, 'shell_unavailable');
        return;
      }
      if (!allowedOrigin(request.headers.origin)) {
        rejectUpgrade(request, socket, 403, 'origin_not_allowed');
        return;
      }
      const ticket = url.searchParams.get('ticket');
      if (!ticket || ticket.length > 256) {
        rejectUpgrade(request, socket, 401, 'invalid_ticket');
        return;
      }
      const user = await consumeTerminalTicket(ticket);
      if (!user) {
        rejectUpgrade(request, socket, 401, 'invalid_ticket');
        return;
      }
      const current = connectionsByUser.get(user.id) ?? 0;
      if (current >= config.terminalMaxConnectionsPerUser) {
        rejectUpgrade(request, socket, 429, 'terminal_connection_limit');
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        const terminalSocket = ws as TerminalSocket;
        terminalSocket.userId = user.id;
        terminalSocket.isAlive = true;
        connectionsByUser.set(user.id, current + 1);
        wss.emit('connection', terminalSocket, request);
      });
    })().catch((error: unknown) => {
      logger.error('terminal_upgrade_failed', { error: error instanceof Error ? error.message : String(error) });
      if (!socket.destroyed) rejectUpgrade(request, socket, 500, 'internal_error');
    });
  };

  server.on('upgrade', upgradeHandler);

  wss.on('connection', (ws: TerminalSocket) => {
    const userRoot = path.resolve(config.workspaceDir, ws.userId);
    fs.mkdirSync(userRoot, { recursive: true, mode: 0o700 });
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
    const args = process.platform === 'win32' ? [] : ['--noprofile', '--norc'];
    const child = spawn(shell, args, {
      cwd: userRoot,
      env: shellEnvironment(userRoot),
      detached: process.platform !== 'win32',
      stdio: 'pipe'
    });
    ws.child = child;
    children.add(child);

    const resetIdle = () => {
      if (ws.idleTimer) clearTimeout(ws.idleTimer);
      ws.idleTimer = setTimeout(() => ws.close(4408, 'idle_timeout'), config.terminalIdleTimeoutMs);
      ws.idleTimer.unref();
    };
    resetIdle();
    ws.sessionTimer = setTimeout(() => ws.close(4408, 'session_limit'), config.terminalMaxSessionMs);
    ws.sessionTimer.unref();

    sendJson(ws, { type: 'session_started', userId: ws.userId });
    child.stdout.on('data', (data: Buffer) => sendJson(ws, { type: 'output', stream: 'stdout', data: data.toString('utf8') }));
    child.stderr.on('data', (data: Buffer) => sendJson(ws, { type: 'output', stream: 'stderr', data: data.toString('utf8') }));
    child.on('exit', (code, signal) => {
      children.delete(child);
      sendJson(ws, { type: 'process_exit', code, signal });
      ws.close(1000, 'process_exit');
    });

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw: RawData) => {
      resetIdle();
      const bytes = raw instanceof ArrayBuffer
        ? raw.byteLength
        : Array.isArray(raw)
          ? raw.reduce((total, chunk) => total + chunk.byteLength, 0)
          : raw.byteLength;
      if (bytes > config.terminalMaxInputBytes) {
        sendJson(ws, { type: 'error', code: 'input_too_large' });
        ws.close(4400, 'input_too_large');
        return;
      }
      try {
        const text = typeof raw === 'string' ? raw : raw.toString();
        const input = parseInput(inputSchema, JSON.parse(text), 'invalid_terminal_message');
        child.stdin.write(input.data);
      } catch {
        sendJson(ws, { type: 'error', code: 'invalid_terminal_message' });
      }
    });

    ws.on('close', () => {
      if (ws.idleTimer) clearTimeout(ws.idleTimer);
      if (ws.sessionTimer) clearTimeout(ws.sessionTimer);
      stopChild(child);
      children.delete(child);
      const count = connectionsByUser.get(ws.userId) ?? 1;
      if (count <= 1) connectionsByUser.delete(ws.userId);
      else connectionsByUser.set(ws.userId, count - 1);
    });
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const ws = client as TerminalSocket;
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);
  heartbeat.unref();

  return {
    activeConnections: () => wss.clients.size,
    close: async () => {
      clearInterval(heartbeat);
      server.off('upgrade', upgradeHandler);
      for (const child of children) stopChild(child);
      for (const client of wss.clients) client.close(1001, 'server_shutdown');
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
  };
}
