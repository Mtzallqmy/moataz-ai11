import crypto from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { parse as parseCookie, serialize as serializeCookie } from 'cookie';
import { z } from 'zod';
import { config } from './config.js';
import { cryptoId, sha256 } from './database/ids.js';
import { AppError } from './errors.js';
import { sessionsRepository, type RefreshUserRecord } from './repositories/sessions.repository.js';
import { usersRepository, type UserRecord } from './repositories/users.repository.js';
import { parseInput, uuidSchema } from './validation.js';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  isActive: boolean;
};

export interface AuthRequest extends Request {
  user?: AuthUser;
  accessToken?: string;
}

type AccessTokenPayload = JwtPayload & {
  sub: string;
  email: string;
  role: 'admin' | 'user';
  type: 'access';
};

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128)
}).strict();

const createUserSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
  name: z.string().trim().min(1).max(100).optional()
}).strict();

const REFRESH_COOKIE = 'moataz_refresh';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeRole(role: string): 'admin' | 'user' {
  return role === 'admin' ? 'admin' : 'user';
}

function toAuthUser(row: Pick<UserRecord | RefreshUserRecord, 'id' | 'email' | 'name' | 'role' | 'is_active'>): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: normalizeRole(row.role),
    isActive: row.is_active
  };
}

export function signAccessToken(user: AuthUser): string {
  return jwt.sign(
    { email: user.email, role: user.role, type: 'access' },
    config.jwtSecret,
    { subject: user.id, expiresIn: config.jwtAccessTtlSeconds, issuer: 'moataz-ai', audience: 'moataz-ai-web' }
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, config.jwtSecret, {
    issuer: 'moataz-ai',
    audience: 'moataz-ai-web'
  });
  if (
    typeof decoded === 'string'
    || typeof decoded.sub !== 'string'
    || typeof decoded.email !== 'string'
    || (decoded.role !== 'admin' && decoded.role !== 'user')
    || decoded.type !== 'access'
  ) throw new AppError('invalid_token', 401);
  return decoded as AccessTokenPayload;
}

function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  return /^Bearer\s+(.+)$/i.exec(header)?.[1];
}

export async function auth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const payload = verifyAccessToken(token);
    const row = await usersRepository.findById(payload.sub);
    if (!row?.is_active) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    req.user = toAuthUser(row);
    req.accessToken = token;
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
}

function refreshCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict' as const,
    path: '/api/auth',
    maxAge: maxAgeSeconds
  };
}

function setRefreshCookie(res: Response, token: string): void {
  res.setHeader('Set-Cookie', serializeCookie(REFRESH_COOKIE, token, refreshCookieOptions(config.refreshTokenTtlSeconds)));
}

function clearRefreshCookie(res: Response): void {
  res.setHeader('Set-Cookie', serializeCookie(REFRESH_COOKIE, '', refreshCookieOptions(0)));
}

function readRefreshToken(req: Request): string | undefined {
  return parseCookie(req.headers.cookie ?? '')[REFRESH_COOKIE];
}

function createRefreshToken(): { id: string; raw: string; hash: string; expiresAt: string } {
  const raw = crypto.randomBytes(32).toString('base64url');
  return {
    id: cryptoId(),
    raw,
    hash: sha256(raw),
    expiresAt: new Date(Date.now() + config.refreshTokenTtlSeconds * 1000).toISOString()
  };
}

function requestFingerprint(req: Request): { userAgent: string | null; ipHash: string | null } {
  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 500) : null;
  const ipHash = req.ip ? sha256(`${config.jwtSecret}:${req.ip}`) : null;
  return { userAgent, ipHash };
}

async function persistRefreshToken(userId: string, req: Request): Promise<string> {
  const token = createRefreshToken();
  const fingerprint = requestFingerprint(req);
  await sessionsRepository.create({
    id: token.id,
    userId,
    tokenHash: token.hash,
    expiresAt: token.expiresAt,
    userAgent: fingerprint.userAgent,
    ipHash: fingerprint.ipHash
  });
  return token.raw;
}

async function issueSession(user: AuthUser, req: Request, res: Response): Promise<void> {
  const refreshToken = await persistRefreshToken(user.id, req);
  setRefreshCookie(res, refreshToken);
  const accessToken = signAccessToken(user);
  res.json({
    accessToken,
    token: accessToken,
    expiresIn: config.jwtAccessTtlSeconds,
    user: { id: user.id, email: user.email, name: user.name, role: user.role }
  });
}

function databaseCode(error: unknown): string | undefined {
  return error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

export function authRoutes(app: Express): void {
  const handleLogin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = parseInput(loginSchema, req.body);
      const email = normalizeEmail(input.email);
      const row = await usersRepository.findByEmail(email);
      const passwordMatches = row ? await bcrypt.compare(input.password, row.password_hash) : false;
      if (!row || !passwordMatches || !row.is_active) {
        res.status(401).json({ error: 'bad_credentials' });
        return;
      }
      const user = toAuthUser(row);
      await usersRepository.markLogin(user.id);
      await issueSession(user, req, res);
    } catch (error) { next(error); }
  };

  app.post('/api/auth/login', handleLogin);
  app.post('/api/login', handleLogin);

  app.post('/api/auth/refresh', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = readRefreshToken(req);
      if (!raw) throw new AppError('unauthorized', 401);
      const row = await sessionsRepository.findValidByHash(sha256(raw));
      if (!row?.is_active) throw new AppError('unauthorized', 401);
      const nextToken = createRefreshToken();
      const fingerprint = requestFingerprint(req);
      await sessionsRepository.rotate({
        oldId: row.refresh_id,
        nextId: nextToken.id,
        userId: row.id,
        tokenHash: nextToken.hash,
        expiresAt: nextToken.expiresAt,
        userAgent: fingerprint.userAgent,
        ipHash: fingerprint.ipHash
      });
      setRefreshCookie(res, nextToken.raw);
      const user = toAuthUser(row);
      const accessToken = signAccessToken(user);
      res.json({ accessToken, token: accessToken, expiresIn: config.jwtAccessTtlSeconds });
    } catch (error) {
      clearRefreshCookie(res);
      next(error instanceof AppError ? error : new AppError('unauthorized', 401));
    }
  });

  app.post('/api/auth/logout', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = readRefreshToken(req);
      if (raw) await sessionsRepository.revokeByHash(sha256(raw));
      clearRefreshCookie(res);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.get('/api/auth/me', auth, (req: AuthRequest, res: Response): void => {
    const user = req.user!;
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  });

  app.get('/api/auth/sessions', auth, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = readRefreshToken(req);
      const currentHash = raw ? sha256(raw) : '';
      const rows = await sessionsRepository.listActive(req.user!.id);
      res.json({ sessions: rows.map((row) => ({
        id: row.id,
        created_at: row.created_at,
        expires_at: row.expires_at,
        last_used_at: row.last_used_at,
        user_agent: row.user_agent,
        current: row.token_hash === currentHash
      })) });
    } catch (error) { next(error); }
  });

  app.delete('/api/auth/sessions/others', auth, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = readRefreshToken(req);
      await sessionsRepository.revokeOthers(req.user!.id, raw ? sha256(raw) : '');
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.delete('/api/auth/sessions/:id', auth, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = parseInput(uuidSchema, req.params.id, 'invalid_session_id');
      const row = await sessionsRepository.findOwnedActive(req.user!.id, id);
      if (!row) throw new AppError('session_not_found', 404);
      await sessionsRepository.revokeOwned(req.user!.id, id);
      const raw = readRefreshToken(req);
      const current = Boolean(raw && sha256(raw) === row.token_hash);
      if (current) clearRefreshCookie(res);
      res.json({ ok: true, current });
    } catch (error) { next(error); }
  });

  app.post('/api/auth/sessions/revoke-all', auth, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      await sessionsRepository.revokeAll(req.user!.id);
      clearRefreshCookie(res);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.post('/api/auth/create-user', auth, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = parseInput(createUserSchema, req.body);
      const email = normalizeEmail(input.email);
      const id = cryptoId();
      const passwordHash = await bcrypt.hash(input.password, 12);
      await usersRepository.create({
        id,
        email,
        passwordHash,
        name: input.name ?? email,
        role: 'user',
        isActive: true
      });
      res.status(201).json({ id, email, name: input.name ?? email, role: 'user' });
    } catch (error) {
      next(databaseCode(error) === '23505' ? new AppError('user_exists', 409) : error);
    }
  });
}
