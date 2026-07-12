import type { Express, NextFunction, Response } from 'express';
import { auth, type AuthRequest } from '../auth.js';
import { config } from '../config.js';
import { pingDatabase } from '../database/client.js';
import { migrationStatus } from '../database/migrate.js';
import { integrationsRepository } from '../repositories/integrations.repository.js';
import { providersRepository } from '../repositories/providers.repository.js';
import { toolCatalog } from '../tools.js';
import type { TelegramStatus } from '../telegram.js';
import { appVersion } from '../version.js';

export type RuntimeStatus = {
  telegram: () => TelegramStatus;
  terminal: () => { enabled: boolean; activeConnections: number };
  reloadTelegram?: () => Promise<TelegramStatus>;
};

export function systemRoutes(app: Express, runtimeStatus: RuntimeStatus): void {
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, status: 'alive' });
  });

  app.get('/api/ready', async (_req, res, next): Promise<void> => {
    try {
      const database = await pingDatabase();
      const migrations = database ? await migrationStatus() : { ready: false, applied: [], pending: ['database_unavailable'] };
      const ready = database && migrations.ready;
      res.status(ready ? 200 : 503).json({ ready, database, migrations });
    } catch (error) { next(error); }
  });

  app.get('/api/system/status', auth, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const [providerCounts, integrationCounts, verifiedIntegrations, database] = await Promise.all([
        providersRepository.countForUser(req.user!.id),
        integrationsRepository.countForUser(req.user!.id),
        integrationsRepository.listVerified(req.user!.id),
        pingDatabase()
      ]);
      const verifiedTypes = new Set(verifiedIntegrations.map((integration) => integration.type));
      const externalSandboxConfigured = verifiedTypes.has('sandbox');
      const telegram = runtimeStatus.telegram();
      const terminal = runtimeStatus.terminal();
      res.json({
        version: appVersion,
        database: database ? 'ready' : 'unavailable',
        shell: {
          enabled: config.shellAvailable || externalSandboxConfigured,
          sandboxMode: externalSandboxConfigured ? 'external' : config.shellSandboxMode,
          externalConfigured: externalSandboxConfigured
        },
        telegram,
        terminal: { enabled: terminal.enabled || externalSandboxConfigured, activeConnections: terminal.activeConnections },
        uptimeSeconds: Math.floor(process.uptime()),
        providerCount: providerCounts.total,
        verifiedProviderCount: providerCounts.ready,
        integrationCount: integrationCounts.total,
        verifiedIntegrationCount: integrationCounts.verified,
        toolCount: toolCatalog.length,
        capabilities: {
          chat: providerCounts.ready > 0,
          agent: providerCounts.ready > 0,
          files: true,
          webFetch: true,
          webSearch: verifiedTypes.has('brave_search') || verifiedTypes.has('tavily'),
          github: verifiedTypes.has('github'),
          telegram: telegram.enabled,
          sandbox: externalSandboxConfigured,
          terminal: terminal.enabled || externalSandboxConfigured
        }
      });
    } catch (error) { next(error); }
  });
}
