import type { Express, NextFunction, Response } from 'express';
import { z } from 'zod';
import { auth, type AuthRequest } from '../auth.js';
import { AppError } from '../errors.js';
import { integrationsRepository } from '../repositories/integrations.repository.js';
import {
  integrationsService,
  normalizeIntegrationMeta,
  publicIntegration,
  validateIntegration
} from '../services/integrations.service.js';
import { parseInput, uuidSchema } from '../validation.js';

const integrationType = z.enum(['github', 'telegram', 'brave_search', 'tavily', 'sandbox']);
const metaSchema = z.record(z.unknown()).optional().default({});
const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: integrationType,
  token: z.string().trim().min(1).max(20_000),
  meta: metaSchema
}).strict();
const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  token: z.string().trim().min(1).max(20_000).optional(),
  meta: z.record(z.unknown()).optional()
}).strict().refine((value) => Object.keys(value).length > 0);
const testSchema = z.object({
  type: integrationType,
  token: z.string().trim().min(1).max(20_000),
  meta: metaSchema
}).strict();
const allowChatSchema = z.object({ chatId: z.union([z.string(), z.number()]) }).strict();

function routeId(req: AuthRequest): string {
  return parseInput(uuidSchema, req.params.id, 'invalid_integration_id');
}

export function integrationRoutes(app: Express, reloadTelegram?: () => Promise<unknown>): void {
  app.get('/api/integrations', auth, async (req: AuthRequest, res, next): Promise<void> => {
    try { res.json({ integrations: await integrationsService.list(req.user!.id) }); }
    catch (error) { next(error); }
  });

  app.post('/api/integrations/test', auth, async (req: AuthRequest, res, next): Promise<void> => {
    try {
      const input = parseInput(testSchema, req.body);
      const identity = await validateIntegration(input.type, input.token, input.meta);
      res.json({ success: true, ok: true, type: input.type, identity });
    } catch (error) { next(error); }
  });

  app.post('/api/integrations', auth, async (req: AuthRequest, res, next): Promise<void> => {
    try {
      const input = parseInput(createSchema, req.body);
      const row = await integrationsService.create(req.user!.id, input);
      res.status(201).json({ success: true, integration: publicIntegration(row) });
    } catch (error) { next(error); }
  });

  app.patch('/api/integrations/:id', auth, async (req: AuthRequest, res, next): Promise<void> => {
    try {
      const input = parseInput(updateSchema, req.body);
      const row = await integrationsService.update(req.user!.id, routeId(req), input);
      if (reloadTelegram && row.type === 'telegram') await reloadTelegram();
      res.json({ success: true, integration: publicIntegration(row) });
    } catch (error) { next(error); }
  });

  const retest = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const row = await integrationsService.retest(req.user!.id, routeId(req));
      if (reloadTelegram && row.type === 'telegram') await reloadTelegram();
      res.json({ success: true, ok: true, integration: publicIntegration(row) });
    } catch (error) { next(error); }
  };
  app.post('/api/integrations/:id/retest', auth, retest);
  app.post('/api/integrations/:id/test', auth, retest);

  app.post('/api/integrations/:id/allow-chat', auth, async (req: AuthRequest, res, next): Promise<void> => {
    try {
      const id = routeId(req);
      const input = parseInput(allowChatSchema, req.body);
      const chatId = String(input.chatId).trim();
      if (!/^-?\d{1,24}$/.test(chatId)) throw new AppError('telegram_chat_id_invalid', 422);
      const row = await integrationsRepository.findOwned(req.user!.id, id);
      if (!row || row.type !== 'telegram') throw new AppError('integration_not_found', 404);
      const allowed = Array.isArray(row.meta.allowedChatIds)
        ? row.meta.allowedChatIds.map(String).filter((value) => /^-?\d{1,24}$/.test(value))
        : [];
      const meta = normalizeIntegrationMeta('telegram', {
        ...row.meta,
        allowedChatIds: [...new Set([...allowed, chatId])]
      });
      await integrationsRepository.updateMeta(req.user!.id, id, meta);
      if (reloadTelegram) await reloadTelegram();
      res.json({ success: true, ok: true, allowedChatIds: meta.allowedChatIds });
    } catch (error) { next(error); }
  });

  app.delete('/api/integrations/:id', auth, async (req: AuthRequest, res, next): Promise<void> => {
    try {
      const existing = await integrationsRepository.findOwned(req.user!.id, routeId(req));
      if (!existing) throw new AppError('integration_not_found', 404);
      await integrationsService.disable(req.user!.id, existing.id);
      if (reloadTelegram && existing.type === 'telegram') await reloadTelegram();
      res.json({ success: true, ok: true });
    } catch (error) { next(error); }
  });
}
