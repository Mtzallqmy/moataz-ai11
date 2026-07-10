import crypto from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { parse as parseCookie, serialize as serializeCookie } from 'cookie';
import { z } from 'zod';
import { config } from './config.js';
import { cryptoId, get, run, sha256, transaction } from './db.js';
import { AppError } from './errors.js';
import { parseInput } from './validation.js';

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

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: string;
  is_active: number | boolean;
};

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

function toAuthUser(row: Pick<UserRow, 'id' | 'email' | 'name' | 'role' | 'is_active'>): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: normalizeRole(row.role),
    isActive: row.is_active === true || row.is_active === 1
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
  ) {
    throw new AppError('invalid_token', 401);
  }
  return decoded as AccessTokenPayload;
}

function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1];
}

export async function auth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    const row = await get<UserRow>(
      'SELECT id, email, password_hash, name, role, is_active FROM users WHERE id = ?',
      [payload.sub]
    );
    if (!row || !(row.is_active === true || row.is_active === 1)) {
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
  const parsed = parseCookie(req.headers.cookie ?? '');
  return parsed[REFRESH_COOKIE];
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
  await run(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, user_agent, ip_hash) VALUES (?, ?, ?, ?, ?, ?)',
    [token.id, userId, token.hash, token.expiresAt, fingerprint.userAgent, fingerprint.ipHash]
  );
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

export function authRoutes(app: Express): void {
  const handleLogin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = parseInput(loginSchema, req.body);
      const email = normalizeEmail(input.email);
      const row = await get<UserRow>('SELECT id, email, password_hash, name, role, is_active FROM users WHERE email = ?', [email]);
      const passwordMatches = row ? await bcrypt.compare(input.password, row.password_hash) : false;
      const active = row && (row.is_active === true || row.is_active === 1);
      if (!row || !passwordMatches || !active) {
        res.status(401).json({ error: 'bad_credentials' });
        return;
      }
      const user = toAuthUser(row);
      await run('UPDATE users SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
      await issueSession(user, req, res);
    } catch (error) {
      next(error);
    }
  };

  app.post('/api/auth/login', handleLogin);
  app.post('/api/login', handleLogin);

  app.post('/api/auth/refresh', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = readRefreshToken(req);
      if (!raw) throw new AppError('unauthorized', 401);
      const hash = sha256(raw);
      const row = await get<UserRow & { refresh_id: string }>(
        `SELECT u.id, u.email, u.password_hash, u.name, u.role, u.is_active, r.id AS refresh_id
         FROM refresh_tokens r
         JOIN users u ON u.id = r.user_id
         WHERE r.token_hash = ? AND r.revoked_at IS NULL AND r.expires_at > CURRENT_TIMESTAMP`,
        [hash]
      );
      if (!row || !(row.is_active === true || row.is_active === 1)) throw new AppError('unauthorized', 401);

      const nextToken = createRefreshToken();
      const fingerprint = requestFingerprint(req);
      await transaction([
        { sql: 'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL', params: [row.refresh_id] },
        {
          sql: 'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, user_agent, ip_hash) VALUES (?, ?, ?, ?, ?, ?)',
          params: [nextToken.id, row.id, nextToken.hash, nextToken.expiresAt, fingerprint.userAgent, fingerprint.ipHash]
        }
      ]);
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
      if (raw) await run('UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND revoked_at IS NULL', [sha256(raw)]);
      clearRefreshCookie(res);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/auth/me', auth, (req: AuthRequest, res: Response): void => {
    const user = req.user!;
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  });

  app.post('/api/auth/create-user', auth, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = parseInput(createUserSchema, req.body);
      const email = normalizeEmail(input.email);
      const id = cryptoId();
      const passwordHash = await bcrypt.hash(input.password, 12);
      await run(
        'INSERT INTO users (id, email, password_hash, name, role, is_active) VALUES (?, ?, ?, ?, ?, ?)',
        [id, email, passwordHash, input.name ?? email, 'user', 1]
      );
      res.status(201).json({ id, email, name: input.name ?? email, role: 'user' });
    } catch (error) {
      next(error);
    }
  });
}
