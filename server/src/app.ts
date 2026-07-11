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

export function createApp(runtimeStatus: RuntimeStatus = defaultRuntimeStatus) {
  const app = express();

  // This must be configured before any middleware reads req.ip. Railway always
  // places the service behind one trusted reverse-proxy hop.
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
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600
  }));

  app.use(compression());
  app.use(express.json({ limit: '1mb', strict: true }));

  // Limit API traffic only. Railway health/readiness probes must not consume a
  // user's quota or trigger IP validation during platform health checks.
  app.use('/api', rateLimit({
    windowMs: 60_000,
    limit: 240,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: isProbeRequest,
    message: { error: 'rate_limited' }
  }));
  app.use(['/api/auth/login', '/api/login'], rateLimit({
    windowMs: 15 * 60_000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'login_rate_limited' }
  }));
  app.use('/api/auth/refresh', rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'rate_limited' }
  }));
  app.use('/api/chats', rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'rate_limited' }
  }));

  authRoutes(app);
  terminalRoutes(app);
  routes(app, runtimeStatus);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'api_not_found' });
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
    if (error instanceof AppError) {
      logger.warn('request_failed', { requestId: requestIdValue, code: error.code, status: error.status });
      const details = error.details !== null && typeof error.details === 'object' && !Array.isArray(error.details)
        ? error.details as Record<string, unknown>
        : undefined;
      const diagnostic = details?.diagnostic !== null && typeof details?.diagnostic === 'object' && !Array.isArray(details?.diagnostic)
        ? details.diagnostic as Record<string, unknown>
        : undefined;
      if (error.code.startsWith('provider_') && diagnostic) {
        res.status(error.status).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
            messageAr: diagnostic.userMessageAr,
            retryable: diagnostic.retryable === true,
            httpStatus: diagnostic.httpStatus ?? error.status,
            requestId: requestIdValue,
            ...(typeof diagnostic.upstreamRequestId === 'string' ? { providerRequestId: diagnostic.upstreamRequestId } : {})
          },
          details: { diagnostic },
          requestId: requestIdValue
        });
        return;
      }
      res.status(error.status).json({ error: error.code, ...(error.details !== undefined ? { details: error.details } : {}), requestId: requestIdValue });
      return;
    }
    logger.error('request_failed', {
      requestId: requestIdValue,
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({ error: 'internal_error', requestId: requestIdValue });
  });

  return app;
}
