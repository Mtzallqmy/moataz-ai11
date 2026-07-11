import crypto from 'node:crypto';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { authRoutes } from './auth.js';
import { routes, type RuntimeStatus } from './routes.js';
import { terminalRoutes } from './terminal.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';
import { redactSecrets } from './redaction.js';

const defaultRuntimeStatus: RuntimeStatus = {
  telegram: () => ({ enabled: false, botCount: 0, configuredCount: 0, discoveryOnlyCount: 0 }),
  terminal: () => ({ enabled: config.shellAvailable, activeConnections: 0 })
};

function requestId(req: Request): string {
  const supplied = req.header('X-Request-Id');
  return supplied && /^[A-Za-z0-9._:-]{8,128}$/.test(supplied) ? supplied : crypto.randomUUID();
}

function isProbeRequest(req: Request): boolean {
  return req.path === '/health' || req.path === '/ready';
}

function isAttachmentUpload(req: Request): boolean {
  return req.method === 'POST' && /^\/api\/chats\/[0-9a-f-]{36}\/attachments$/i.test(req.path);
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function errorEnvelope(input: {
  code: string;
  status: number;
  requestId?: string;
  details?: unknown;
  fallbackMessage?: string;
}) {
  const details = objectRecord(redactSecrets(input.details));
  const message = typeof details.message === 'string'
    ? details.message
    : typeof details.providerMessage === 'string'
      ? details.providerMessage
      : input.fallbackMessage ?? input.code;
  const messageAr = typeof details.userMessageAr === 'string'
    ? details.userMessageAr
    : typeof details.messageAr === 'string'
      ? details.messageAr
      : undefined;
  const retryable = details.retryable === true;
  const providerRequestId = typeof details.upstreamRequestId === 'string'
    ? details.upstreamRequestId
    : typeof details.providerRequestId === 'string'
      ? details.providerRequestId
      : undefined;
  const payload = {
    code: input.code,
    message,
    ...(messageAr ? { messageAr } : {}),
    retryable,
    httpStatus: input.status,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(providerRequestId ? { providerRequestId } : {})
  };
  return {
    success: false,
    error: payload,
    code: input.code,
    message,
    ...(Object.keys(details).length > 0 ? { details } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {})
  };
}

export function createApp(runtimeStatus: RuntimeStatus = defaultRuntimeStatus) {
  const app = express();

  app.set('trust proxy', config.trustProxy);
  if (config.isRailway && (app.get('trust proxy') === false || app.get('trust proxy') === 0)) {
    throw new Error('Invalid runtime configuration: Railway requires trust proxy to be enabled');
  }
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    const id = requestId(req);
    const startedAt = process.hrtime.bigint();
    res.locals.requestId = id;
    res.setHeader('X-Request-Id', id);
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logger.info('http_request', {
        requestId: id,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100
      });
    });
    next();
  });

  app.use(helmet({
    contentSecurityPolicy: config.isProduction ? {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", config.appOrigin, config.appOrigin.replace(/^http/, 'ws')],
        formAction: ["'self'"],
        upgradeInsecureRequests: []
      }
    } : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' }
  }));

  app.use(cors({
    credentials: true,
    origin: (origin, callback) => {
      if (!config.isProduction) {
        callback(null, true);
        return;
      }
      if (!origin) {
        callback(null, true);
        return;
      }
      try {
        const normalized = new URL(origin).origin;
        const allowed = config.corsOrigins.includes(normalized);
        callback(allowed ? null : new AppError('origin_not_allowed', 403), allowed);
      } catch {
        callback(new AppError('origin_not_allowed', 403));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id', 'X-File-Name'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600
  }));

  app.use(compression());
  const jsonParser = express.json({ limit: '1mb', strict: true });
  app.use((req, res, next) => {
    if (isAttachmentUpload(req)) {
      next();
      return;
    }
    jsonParser(req, res, next);
  });

  app.use('/api', rateLimit({
    windowMs: 60_000,
    limit: 240,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: isProbeRequest,
    message: { success: false, error: { code: 'rate_limited', message: 'Too many requests.', retryable: true, httpStatus: 429 } }
  }));
  app.use(['/api/auth/login', '/api/login'], rateLimit({
    windowMs: 15 * 60_000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { success: false, error: { code: 'login_rate_limited', message: 'Too many login attempts.', retryable: true, httpStatus: 429 } }
  }));
  app.use('/api/auth/refresh', rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, error: { code: 'rate_limited', message: 'Too many requests.', retryable: true, httpStatus: 429 } }
  }));
  app.use('/api/chats', rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, error: { code: 'rate_limited', message: 'Too many requests.', retryable: true, httpStatus: 429 } }
  }));

  authRoutes(app);
  terminalRoutes(app);
  routes(app, runtimeStatus);

  app.use('/api', (_req, res) => {
    const id = typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined;
    res.status(404).json(errorEnvelope({ code: 'api_not_found', status: 404, requestId: id }));
  });

  const clientDist = path.resolve('dist/client');
  app.use(express.static(clientDist, { index: false, maxAge: config.isProduction ? '1h' : 0 }));
  app.get('*', (req, res, next) => {
    if (!req.accepts('html')) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'), (error) => {
      if (error) next(new AppError('frontend_not_built', 404));
    });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const requestIdValue = typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined;
    const parserError = objectRecord(error);
    if (parserError.type === 'entity.too.large') {
      res.status(413).json(errorEnvelope({ code: 'request_too_large', status: 413, requestId: requestIdValue }));
      return;
    }
    if (error instanceof AppError) {
      logger.warn('request_failed', { requestId: requestIdValue, code: error.code, status: error.status });
      res.status(error.status).json(errorEnvelope({
        code: error.code,
        status: error.status,
        requestId: requestIdValue,
        details: error.details,
        fallbackMessage: error.message
      }));
      return;
    }
    logger.error('request_failed', {
      requestId: requestIdValue,
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json(errorEnvelope({ code: 'internal_error', status: 500, requestId: requestIdValue }));
  });

  return app;
}
