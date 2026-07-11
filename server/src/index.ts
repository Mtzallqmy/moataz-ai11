import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from './config.js';
import { logger } from './logger.js';
import type { TerminalController } from './terminal.js';
import type { TelegramController, TelegramStatus } from './telegram.js';

async function listen(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(config.port, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(payload);
}

function configurationRequiredServer(): http.Server {
  return http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const details = {
      configured: false,
      requiredVariables: config.requiredVariables,
      problems: config.configurationProblems
    };

    if (pathname === '/api/health') {
      writeJson(res, 200, { ok: true, status: 'configuration_required' });
      return;
    }
    if (pathname === '/api/ready' || pathname === '/api/config/status') {
      writeJson(res, 503, { ready: false, configuration: details });
      return;
    }
    writeJson(res, 503, { error: 'configuration_required', ...details });
  });
}

function installBasicShutdown(server: http.Server): void {
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown_started', { signal });
    server.close(() => {
      logger.info('shutdown_completed', { signal });
      process.exitCode = 0;
    });
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

async function startConfigurationMode(): Promise<void> {
  const server = configurationRequiredServer();
  installBasicShutdown(server);
  await listen(server);
  logger.warn('configuration_required', {
    requiredVariables: config.requiredVariables,
    problems: config.configurationProblems
  });
  logger.info('server_started', {
    port: config.port,
    mode: 'configuration_required',
    deploymentPlatform: config.deploymentPlatform,
    nodeEnv: config.nodeEnv,
    trustProxy: config.trustProxy
  });
}

async function startApplication(): Promise<void> {
  const [databaseModule, appModule, terminalModule, telegramModule] = await Promise.all([
    import('./db.js'),
    import('./app.js'),
    import('./terminal.js'),
    import('./telegram.js')
  ]);

  await databaseModule.migrate();

  let telegram: TelegramController = { enabled: false, botCount: 0, configuredCount: 0, discoveryOnlyCount: 0, close: async () => undefined };
  let telegramReload: Promise<TelegramStatus> | undefined;
  const reloadTelegram = async (): Promise<TelegramStatus> => {
    if (!config.telegramPolling) return { enabled: false, botCount: 0, configuredCount: 0, discoveryOnlyCount: 0 };
    if (!telegramReload) {
      telegramReload = (async () => {
        await telegram.close();
        telegram = await telegramModule.startTelegramPolling();
        return { enabled: telegram.enabled, botCount: telegram.botCount, configuredCount: telegram.configuredCount, discoveryOnlyCount: telegram.discoveryOnlyCount };
      })().finally(() => { telegramReload = undefined; });
    }
    return telegramReload;
  };

  const terminalHolder: { current?: TerminalController } = {};
  const app = appModule.createApp({
    telegram: () => ({ enabled: telegram.enabled, botCount: telegram.botCount, configuredCount: telegram.configuredCount, discoveryOnlyCount: telegram.discoveryOnlyCount }),
    terminal: () => ({ enabled: config.shellAvailable, activeConnections: terminalHolder.current?.activeConnections() ?? 0 }),
    reloadTelegram
  });
  const server = http.createServer(app);
  terminalHolder.current = terminalModule.attachTerminal(server);

  let shuttingDown = false;
  const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown_started', { signal });
    const force = setTimeout(() => {
      logger.error('shutdown_timeout');
      process.exit(1);
    }, 10_000);
    force.unref();

    server.closeIdleConnections?.();
    await Promise.allSettled([
      new Promise<void>((resolve) => server.close(() => resolve())),
      terminalHolder.current?.close() ?? Promise.resolve(),
      telegram.close(),
      databaseModule.close()
    ]);
    clearTimeout(force);
    logger.info('shutdown_completed', { signal });
    process.exitCode = exitCode;
  };

  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('unhandledRejection', (reason) => {
    logger.error('unhandled_rejection', { error: reason instanceof Error ? reason.message : String(reason) });
    void shutdown('unhandledRejection', 1);
  });
  process.once('uncaughtException', (error) => {
    logger.error('uncaught_exception', { error: error.message });
    void shutdown('uncaughtException', 1);
  });

  await listen(server);
  for (const code of config.configurationWarnings) {
    logger.warn('configuration_warning', { code });
  }
  if (config.telegramPolling) await reloadTelegram();
  if (config.allowShellRequested && !config.shellAvailable) {
    logger.warn('shell_disabled', { reason: 'production_or_missing_external_sandbox' });
  }
  logger.info('server_started', {
    port: config.port,
    mode: 'application',
    nodeEnv: config.nodeEnv,
    configuredNodeEnv: config.configuredNodeEnv,
    deploymentPlatform: config.deploymentPlatform,
    appOrigin: config.appOrigin,
    trustProxy: config.trustProxy,
    databaseKind: config.databaseKind,
    shellEnabled: config.shellAvailable,
    telegramEnabled: telegram.enabled,
    telegramBotCount: telegram.botCount,
    telegramDiscoveryOnlyCount: telegram.discoveryOnlyCount
  });
}

async function main(): Promise<void> {
  if (!config.isConfigured) {
    await startConfigurationMode();
    return;
  }
  await startApplication();
}

main().catch((error: unknown) => {
  logger.error('startup_failed', { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
