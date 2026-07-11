from pathlib import Path

path = Path('server/src/routes.ts')
text = path.read_text()


def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected one match, found {count}: {old[:120]!r}')
    text = text.replace(old, new, 1)

replace_once(
    "import { providerErrorWithDiagnostic, successfulProviderDiagnostic } from './provider-diagnostics.js';",
    "import { providerErrorWithDiagnostic } from './provider-diagnostics.js';\nimport { getProviderDefinition, normalizeProviderUrls } from './providers/index.js';\nimport type { ProviderDiagnosticResult } from './providers/types.js';"
)

replace_once(
"""async function validateProvider(input: z.infer<typeof providerTestSchema>): Promise<{
  message: string;
  model: string;
  models: string[];
  diagnostic: ReturnType<typeof successfulProviderDiagnostic>;
}> {
  const provider = providerInput(input);
  const preferredModel = input.model ?? 'auto';
  const result = await diagnoseProviderConnection(provider, preferredModel);
  return {
    message: result.message,
    model: result.model,
    models: result.models,
    diagnostic: successfulProviderDiagnostic({
      providerType: input.type,
      selectedModel: result.model,
      preferredModel,
      modelsSupported: result.modelsSupported,
      modelCount: result.models.length,
      attempts: result.attempts
    })
  };
}
""",
"""async function validateProvider(input: z.infer<typeof providerTestSchema>): Promise<{
  message: string;
  model: string;
  models: string[];
  diagnostic: ProviderDiagnosticResult;
}> {
  const provider = providerInput(input);
  const preferredModel = input.model ?? 'auto';
  const result = await diagnoseProviderConnection(provider, preferredModel);
  return {
    message: result.message,
    model: result.model,
    models: result.models,
    diagnostic: result.diagnostic
  };
}
"""
)

replace_once(
"""  app.get('/api/provider-catalog', auth, (_req, res) => {
    res.json({ providers: providerCatalog });
  });
""",
"""  app.get('/api/provider-catalog', auth, (_req, res) => {
    res.json({ providers: providerCatalog });
  });

  app.post('/api/providers/normalize-url', auth, (req: AuthRequest, res: Response, next: NextFunction): void => {
    try {
      const input = parseInput(z.object({
        type: providerTypeSchema,
        baseUrl: z.string().trim().min(1).max(2048)
      }).strict(), req.body);
      const definition = getProviderDefinition(input.type);
      const urls = normalizeProviderUrls(definition, input.baseUrl);
      res.json({ success: true, provider: definition.id, ...urls });
    } catch (error) {
      next(error);
    }
  });
"""
)

replace_once(
"""  app.post('/api/providers/models', auth, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = parseInput(providerModelsSchema, req.body);
      const result = await listProviderModels(modelDiscoveryProvider({ type: input.type, apiKey: input.apiKey, baseUrl: input.baseUrl }));
      const recommendedModel = result.models.find((model) => model.toLowerCase().includes(':free')) ?? result.models[0] ?? null;
      res.json({ ...result, recommendedModel });
    } catch (error) {
      next(error);
    }
  });
""",
"""  const discoverModelsHandler = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = parseInput(providerModelsSchema, req.body);
      const result = await listProviderModels(modelDiscoveryProvider({ type: input.type, apiKey: input.apiKey, baseUrl: input.baseUrl }));
      res.json({ success: true, ...result, recommendedModel: null });
    } catch (error) {
      next(error);
    }
  };

  app.post('/api/providers/discover-models', auth, discoverModelsHandler);
  app.post('/api/providers/models', auth, discoverModelsHandler);
"""
)

replace_once(
"""      const result = await listProviderModels(providerFromRow(row));
      const recommendedModel = result.models.find((model) => model.toLowerCase().includes(':free')) ?? result.models[0] ?? null;
      res.json({ ...result, recommendedModel });
""",
"""      const result = await listProviderModels(providerFromRow(row));
      res.json({ success: true, ...result, recommendedModel: null });
"""
)

old = """  app.post('/api/providers/:id/test', auth, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const id = (() => {
      try { return routeId(req); } catch (error) { next(error); return undefined; }
    })();
    if (!id) return;
    let providerType = 'provider';
    try {
      const row = await providerRowForUser(req.user!.id, id);
      if (!row) throw new AppError('provider_not_found', 404);
      providerType = row.type;
      const result = await validateProvider({
        type: row.type,
        apiKey: decrypt(row.api_key_enc),
        model: row.default_model,
        ...(row.base_url ? { baseUrl: row.base_url } : {})
      });
      await transaction([
        {
          sql: `UPDATE providers SET default_model = ?, validation_status = 'verified', validation_error_code = NULL,
                validated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
          params: [result.model, id, req.user!.id]
        },
        {
          sql: 'UPDATE chats SET model = ?, updated_at = CURRENT_TIMESTAMP WHERE provider_id = ? AND user_id = ?',
          params: [result.model, id, req.user!.id]
        }
      ]);
      res.json({ ok: true, id, model: result.model, models: result.models, responsePreview: result.message, diagnostic: result.diagnostic, validation_status: 'verified' });
    } catch (error) {
      const code = errorCode(error);
      await run(
        `UPDATE providers SET validation_status = 'failed', validation_error_code = ?,
         validated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
        [code, id, req.user!.id]
      ).catch(() => undefined);
      next(providerErrorWithDiagnostic(providerType, error));
    }
  });
"""
new = """  const retestProviderHandler = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const id = (() => {
      try { return routeId(req); } catch (error) { next(error); return undefined; }
    })();
    if (!id) return;
    let providerType = 'provider';
    try {
      const row = await providerRowForUser(req.user!.id, id);
      if (!row) throw new AppError('provider_not_found', 404);
      providerType = row.type;
      const result = await validateProvider({
        type: row.type,
        apiKey: decrypt(row.api_key_enc),
        model: row.default_model,
        ...(row.base_url ? { baseUrl: row.base_url } : {})
      });
      await transaction([
        {
          sql: `UPDATE providers SET default_model = ?, validation_status = 'verified', validation_error_code = NULL,
                validated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
          params: [result.model, id, req.user!.id]
        },
        {
          sql: 'UPDATE chats SET model = ?, updated_at = CURRENT_TIMESTAMP WHERE provider_id = ? AND user_id = ?',
          params: [result.model, id, req.user!.id]
        }
      ]);
      res.json({ ok: true, id, model: result.model, models: result.models, responsePreview: result.message, diagnostic: result.diagnostic, validation_status: 'verified' });
    } catch (error) {
      const code = errorCode(error);
      await run(
        `UPDATE providers SET validation_status = 'failed', validation_error_code = ?,
         validated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
        [code, id, req.user!.id]
      ).catch(() => undefined);
      next(providerErrorWithDiagnostic(providerType, error));
    }
  };

  app.post('/api/providers/:id/retest', auth, retestProviderHandler);
  app.post('/api/providers/:id/test', auth, retestProviderHandler);
"""
replace_once(old, new)

path.write_text(text)
