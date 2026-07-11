import type { Express, NextFunction, Response } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../auth.js';
import { auth } from '../auth.js';
import { getProviderDefinition, providerRegistry, resolveProviderUrls } from '../providers/index.js';
import { providersService, publicProvider } from '../services/providers.service.js';
import { parseInput, uuidSchema } from '../validation.js';

const providerTypeSchema = z.string().trim().min(1).max(60);
const baseUrlSchema = z.string().trim().url().max(2048);
const modelSchema = z.string().trim().min(1).max(500);

const normalizeUrlSchema = z.object({
  type: providerTypeSchema,
  baseUrl: baseUrlSchema
}).strict();

const draftSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: providerTypeSchema,
  apiKey: z.string().max(20_000).default(''),
  baseUrl: baseUrlSchema.optional(),
  selectedModel: modelSchema.nullable().optional(),
  defaultModel: modelSchema.optional(),
  model: modelSchema.optional()
}).strict();

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  type: providerTypeSchema.optional(),
  apiKey: z.string().max(20_000).optional(),
  baseUrl: baseUrlSchema.nullable().optional(),
  selectedModel: modelSchema.nullable().optional(),
  defaultModel: modelSchema.optional(),
  model: modelSchema.optional()
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

const discoverySchema = draftSchema.extend({ force: z.boolean().optional().default(false) });

function id(req: AuthRequest): string {
  return parseInput(uuidSchema, req.params.id, 'invalid_provider_id');
}

function selectedModel(input: { selectedModel?: string | null; defaultModel?: string; model?: string }): string | null | undefined {
  return input.selectedModel ?? input.defaultModel ?? input.model;
}

function requestId(res: Response): string | undefined {
  return typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined;
}

export function providerRoutes(app: Express): void {
  app.get('/api/provider-catalog', auth, (_req, res) => {
    res.json({ providers: providerRegistry.map((definition) => ({
      id: definition.id,
      label: definition.displayName,
      displayName: definition.displayName,
      adapter: definition.protocol,
      protocol: definition.protocol,
      defaultBaseUrl: definition.defaultBaseUrl,
      baseUrlRequired: definition.defaultBaseUrl === null,
      apiKeyRequired: definition.apiKeyRequired,
      modelExamples: definition.modelExamples,
      endpoints: definition.endpoints,
      capabilities: definition.capabilities,
      allowsCustomBaseUrl: definition.allowsCustomBaseUrl,
      localConnection: definition.localConnection
    })) });
  });

  app.post('/api/providers/normalize-url', auth, (req: AuthRequest, res, next) => {
    try {
      const input = parseInput(normalizeUrlSchema, req.body);
      const resolved = resolveProviderUrls(input.type, input.baseUrl);
      res.json({
        success: true,
        provider: getProviderDefinition(input.type).id,
        ...resolved
      });
    } catch (error) { next(error); }
  });

  const discoverDraft = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = parseInput(discoverySchema, req.body);
      const result = await providersService.discoverDraft({
        name: input.name,
        type: input.type,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        selectedModel: selectedModel(input)
      }, input.force);
      res.json({ success: true, ...result, models: result.models });
    } catch (error) { next(error); }
  };
  app.post('/api/providers/discover-models', auth, discoverDraft);
  app.post('/api/providers/models', auth, discoverDraft);

  app.post('/api/providers/test', auth, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = parseInput(draftSchema, req.body);
      const result = await providersService.testDraft({
        name: input.name,
        type: input.type,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        selectedModel: selectedModel(input)
      }, requestId(res));
      res.json({
        success: true,
        ok: true,
        provider: input.type,
        model: result.model,
        responsePreview: result.responsePreview,
        diagnostic: result.diagnostic,
        discovery: result.discovery,
        models: result.discovery.models
      });
    } catch (error) { next(error); }
  });

  app.get('/api/providers', auth, async (req: AuthRequest, res, next): Promise<void> => {
    try {
      res.json({ providers: await providersService.list(req.user!.id) });
    } catch (error) { next(error); }
  });

  app.post('/api/providers', auth, async (req: AuthRequest, res, next): Promise<void> => {
    try {
      const input = parseInput(draftSchema, req.body);
      const row = await providersService.createDraft(req.user!.id, {
        name: input.name,
        type: input.type,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        selectedModel: selectedModel(input)
      });
      res.status(201).json({ success: true, provider: publicProvider(row) });
    } catch (error) { next(error); }
  });

  app.patch('/api/providers/:id', auth, async (req: AuthRequest, res, next): Promise<void> => {
    try {
      const input = parseInput(updateSchema, req.body);
      const row = await providersService.updateDraft(req.user!.id, id(req), {
        ...input,
        baseUrl: input.baseUrl === null ? undefined : input.baseUrl,
        selectedModel: selectedModel(input)
      });
      res.json({ success: true, provider: publicProvider(row) });
    } catch (error) { next(error); }
  });

  const discoverSaved = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await providersService.discoverSaved(req.user!.id, id(req), req.query.force === 'true');
      res.json({ success: true, ...result, models: result.models });
    } catch (error) { next(error); }
  };
  app.get('/api/providers/:id/models', auth, discoverSaved);
  app.post('/api/providers/:id/discover-models', auth, discoverSaved);

  const retest = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await providersService.retest(req.user!.id, id(req), requestId(res));
      res.json({
        success: true,
        ok: true,
        provider: publicProvider(result.provider),
        model: result.provider.selected_model,
        responsePreview: result.responsePreview,
        diagnostic: result.diagnostic,
        validation_status: result.provider.validation_status
      });
    } catch (error) { next(error); }
  };
  app.post('/api/providers/:id/retest', auth, retest);
  app.post('/api/providers/:id/test', auth, retest);

  app.delete('/api/providers/:id', auth, async (req: AuthRequest, res, next): Promise<void> => {
    try {
      await providersService.disable(req.user!.id, id(req));
      res.json({ success: true, ok: true });
    } catch (error) { next(error); }
  });
}
