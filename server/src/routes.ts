import type { Express } from 'express';
import { diagnoseProviderError } from './providers/diagnostics.js';
import { chatRoutes } from './routes/chats.routes.js';
import { integrationRoutes } from './routes/integrations.routes.js';
import { providerRoutes } from './routes/providers.routes.js';
import { systemRoutes, type RuntimeStatus } from './routes/system.routes.js';

export type { RuntimeStatus } from './routes/system.routes.js';
export { buildAgentMessages, parseLegacyToolCall } from './routes/chats.routes.js';
export { normalizeIntegrationToken } from './services/integrations.service.js';

export function categorizeProviderError(message: string): { stage: string; suggestion: string } {
  const diagnostic = diagnoseProviderError(new Error(message));
  return {
    stage: diagnostic.status,
    suggestion: diagnostic.userMessageAr
  };
}

export function routes(app: Express, runtimeStatus: RuntimeStatus): void {
  systemRoutes(app, runtimeStatus);
  providerRoutes(app);
  integrationRoutes(app, runtimeStatus.reloadTelegram);
  chatRoutes(app);
}
