import http from 'node:http';
import { config } from './config.js';
import { migrate, close as closeDatabase } from './db.js';
import { createApp } from './app.js';
import { attachTerminal, type TerminalController } from './terminal.js';
import { startTelegramPolling, type TelegramController } from './telegram.js';
import { logger } from './logger.js';

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

async function main(): Promise<void> {
  await migrate();

  let telegram: TelegramController = { enabled: false, botCount: 0, close: async () => undefined };
  const terminalHolder: { current?: TerminalController } = {};
  const app = createApp({
    telegram: () => ({ enabled: telegram.enabled, botCount: telegram.botCount }),
    terminal: () => ({ enabled: config.shellAvailable, activeConnections: terminalHolder.current?.activeConnections() ?? 0 })
  });
  const server = http.createServer(app);
  terminalHolder.current = attachTerminal(server);

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
      closeDatabase()
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
  if (config.telegramPolling) telegram = await startTelegramPolling();
  if (config.allowShellRequested && !config.shellAvailable) {
    logger.warn('shell_disabled', { reason: 'production_or_missing_external_sandbox' });
  }
  logger.info('server_started', { port: config.port, nodeEnv: config.nodeEnv, shellEnabled: config.shellAvailable });
}

main().catch(async (error: unknown) => {
  logger.error('startup_failed', { error: error instanceof Error ? error.message : String(error) });
  await closeDatabase().catch(() => undefined);
  process.exitCode = 1;
});
