from __future__ import annotations

import json
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one match in {path}, found {count}: {old[:100]!r}")
    file.write_text(text.replace(old, new, 1))


routes = "server/src/routes.ts"
replace_once(
    routes,
    "import { assertProviderCredentials, providerCatalog, resolveProviderBaseUrl } from './providers.js';\n",
    "import { assertProviderCredentials, providerCatalog, resolveProviderBaseUrl } from './providers.js';\nimport { providerErrorWithDiagnostic, successfulProviderDiagnostic } from './provider-diagnostics.js';\n",
)

replace_once(
    routes,
    """async function validateProvider(input: z.infer<typeof providerTestSchema>): Promise<{ message: string; model: string }> {
  return testProviderConnection(providerInput(input), input.model ?? '');
}
""",
    """async function validateProvider(input: z.infer<typeof providerTestSchema>): Promise<{ message: string; model: string; diagnostic: ReturnType<typeof successfulProviderDiagnostic> }> {
  const provider = providerInput(input);
  const result = await testProviderConnection(provider, input.model ?? '');
  let modelsSupported = false;
  let modelsFailed = false;
  let modelCount = 0;
  try {
    const discovery = await listProviderModels(provider);
    modelsSupported = discovery.supported;
    modelCount = discovery.models.length;
  } catch {
    modelsFailed = true;
  }
  return {
    ...result,
    diagnostic: successfulProviderDiagnostic({
      providerType: input.type,
      selectedModel: result.model,
      modelsSupported,
      modelsFailed,
      modelCount
    })
  };
}
""",
)

normalize_anchor = """function normalizeIntegrationMeta(type: IntegrationType, meta: Record<string, unknown>): Record<string, unknown> {
"""
normalize_helper = """function normalizeTelegramPreferences(value: unknown): Record<string, { providerId?: string; mode: 'chat' | 'agent' }> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([chatId, raw]) => {
    if (!/^-?\\d{1,24}$/.test(chatId) || raw === null || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const preference = raw as Record<string, unknown>;
    const providerId = typeof preference.providerId === 'string' && /^[0-9a-f-]{36}$/i.test(preference.providerId)
      ? preference.providerId
      : undefined;
    const mode: 'chat' | 'agent' = preference.mode === 'chat' ? 'chat' : 'agent';
    return [[chatId, { ...(providerId ? { providerId } : {}), mode }]];
  }).slice(0, 20));
}

function normalizeIntegrationMeta(type: IntegrationType, meta: Record<string, unknown>): Record<string, unknown> {
"""
replace_once(routes, normalize_anchor, normalize_helper)

replace_once(
    routes,
    """    allowAllChats: meta.allowAllChats === true,
    discoveredChats: normalizeDiscoveredChats(meta.discoveredChats),
    ...(meta.identity !== null && typeof meta.identity === 'object' && !Array.isArray(meta.identity) ? { identity: meta.identity } : {})
""",
    """    allowAllChats: meta.allowAllChats === true,
    discoveredChats: normalizeDiscoveredChats(meta.discoveredChats),
    chatPreferences: normalizeTelegramPreferences(meta.chatPreferences),
    ...(meta.identity !== null && typeof meta.identity === 'object' && !Array.isArray(meta.identity) ? { identity: meta.identity } : {})
""",
)

old_status = """      const count = await get<{ count: number | string }>('SELECT COUNT(*) AS count FROM providers WHERE user_id = ? AND is_active = 1', [req.user!.id]);
      const sandboxCount = await get<{ count: number | string }>("SELECT COUNT(*) AS count FROM integrations WHERE user_id = ? AND type = 'sandbox' AND is_active = 1 AND validation_status = 'verified'", [req.user!.id]);
      const externalSandboxConfigured = Number(sandboxCount?.count ?? 0) > 0;
      const database = await ping();
      const telegram = runtimeStatus.telegram();
      const terminal = runtimeStatus.terminal();
      res.json({
        version: appVersion,
        database: database ? 'ready' : 'unavailable',
        shell: { enabled: config.shellAvailable || externalSandboxConfigured, sandboxMode: externalSandboxConfigured ? 'external' : config.shellSandboxMode, externalConfigured: externalSandboxConfigured },
        telegram,
        terminal: { enabled: terminal.enabled, activeConnections: terminal.activeConnections },
        uptimeSeconds: Math.floor(process.uptime()),
        providerCount: Number(count?.count ?? 0)
      });
"""
new_status = """      const providers = await query<{ validation_status: string }>('SELECT validation_status FROM providers WHERE user_id = ? AND is_active = 1', [req.user!.id]);
      const integrations = await query<{ type: string; validation_status: string }>('SELECT type, validation_status FROM integrations WHERE user_id = ? AND is_active = 1', [req.user!.id]);
      const verifiedProviderCount = providers.filter((provider) => provider.validation_status === 'verified').length;
      const verifiedIntegrations = integrations.filter((integration) => integration.validation_status === 'verified');
      const verifiedTypes = new Set(verifiedIntegrations.map((integration) => integration.type));
      const externalSandboxConfigured = verifiedTypes.has('sandbox');
      const database = await ping();
      const telegram = runtimeStatus.telegram();
      const terminal = runtimeStatus.terminal();
      res.json({
        version: appVersion,
        database: database ? 'ready' : 'unavailable',
        shell: { enabled: config.shellAvailable || externalSandboxConfigured, sandboxMode: externalSandboxConfigured ? 'external' : config.shellSandboxMode, externalConfigured: externalSandboxConfigured },
        telegram,
        terminal: { enabled: terminal.enabled, activeConnections: terminal.activeConnections },
        uptimeSeconds: Math.floor(process.uptime()),
        providerCount: providers.length,
        verifiedProviderCount,
        integrationCount: integrations.length,
        verifiedIntegrationCount: verifiedIntegrations.length,
        toolCount: toolCatalog.length,
        capabilities: {
          chat: verifiedProviderCount > 0,
          agent: verifiedProviderCount > 0,
          files: true,
          webFetch: true,
          webSearch: verifiedTypes.has('brave_search') || verifiedTypes.has('tavily'),
          github: verifiedTypes.has('github'),
          telegram: telegram.enabled,
          sandbox: externalSandboxConfigured,
          terminal: terminal.enabled || externalSandboxConfigured
        }
      });
"""
replace_once(routes, old_status, new_status)

old_draft_test = """  app.post('/api/providers/test', auth, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = parseInput(providerTestSchema, req.body);
      const result = await validateProvider({
        type: input.type,
        apiKey: input.apiKey ?? '',
        model: input.model ?? '',
        ...(typeof input.baseUrl === 'string' ? { baseUrl: input.baseUrl } : {})
      });
      res.json({
        ok: true,
        provider: input.type,
        model: result.model,
        responsePreview: result.message,
        stages: { url: 'passed', network: 'passed', authentication: 'passed', model: 'passed', completion: 'passed' }
      });
    } catch (error) {
      next(error);
    }
  });
"""
new_draft_test = """  app.post('/api/providers/test', auth, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    let providerType = 'provider';
    try {
      const input = parseInput(providerTestSchema, req.body);
      providerType = input.type;
      const result = await validateProvider({
        type: input.type,
        apiKey: input.apiKey ?? '',
        model: input.model ?? '',
        ...(typeof input.baseUrl === 'string' ? { baseUrl: input.baseUrl } : {})
      });
      res.json({
        ok: true,
        provider: input.type,
        model: result.model,
        responsePreview: result.message,
        diagnostic: result.diagnostic,
        stages: { url: 'passed', network: 'passed', authentication: 'passed', model: 'passed', completion: 'passed' }
      });
    } catch (error) {
      next(providerErrorWithDiagnostic(providerType, error));
    }
  });
"""
replace_once(routes, old_draft_test, new_draft_test)

old_saved_test = """  app.post('/api/providers/:id/test', auth, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const id = (() => {
      try { return routeId(req); } catch (error) { next(error); return undefined; }
    })();
    if (!id) return;
    try {
      const row = await providerRowForUser(req.user!.id, id);
      if (!row) throw new AppError('provider_not_found', 404);
      const result = await testProviderConnection(providerFromRow(row), row.default_model);
      await run(
        `UPDATE providers SET validation_status = 'verified', validation_error_code = NULL,
         validated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
        [id, req.user!.id]
      );
      res.json({ ok: true, id, model: result.model, responsePreview: result.message, validation_status: 'verified' });
    } catch (error) {
      const code = errorCode(error);
      await run(
        `UPDATE providers SET validation_status = 'failed', validation_error_code = ?,
         validated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
        [code, id, req.user!.id]
      ).catch(() => undefined);
      next(error);
    }
  });
"""
new_saved_test = """  app.post('/api/providers/:id/test', auth, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
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
      await run(
        `UPDATE providers SET validation_status = 'verified', validation_error_code = NULL,
         validated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
        [id, req.user!.id]
      );
      res.json({ ok: true, id, model: result.model, responsePreview: result.message, diagnostic: result.diagnostic, validation_status: 'verified' });
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
replace_once(routes, old_saved_test, new_saved_test)

replace_once(
    "client/src/pages/IntegrationsPage.tsx",
    "GitHub وTelegram والبحث على الويب وSandbox خارجي، مع فحص فعلي وحفظ مشفّر.",
    "GitHub وTelegram والبحث وSandbox خارجي. بعد السماح بالمحادثة يعرض البوت /menu بأزرار للمزوّدات والتشخيص والملفات والويب والأدوات والحالة.",
)

css_path = Path("client/src/styles/app.css")
css = css_path.read_text()
marker = "/* v1.4 capability dashboard and provider diagnostics */"
if marker not in css:
    css += """

/* v1.4 capability dashboard and provider diagnostics */
.capability-section { display: grid; gap: 14px; }
.capability-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.capability-card {
  min-height: 150px;
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: 1fr auto;
  align-items: start;
  gap: 12px 14px;
  padding: 18px;
  color: var(--text);
  text-align: start;
  background: linear-gradient(145deg, rgba(255,255,255,.055), rgba(255,255,255,.018));
  border: 1px solid var(--border);
  border-radius: 20px;
  box-shadow: none;
}
.capability-card:hover:not(:disabled) { border-color: rgba(18,191,244,.48); box-shadow: 0 18px 40px rgba(0,0,0,.16); }
.capability-card.ready { border-color: rgba(45,212,168,.34); }
.capability-card.needs-setup { border-color: rgba(246,184,75,.3); }
.capability-icon { width: 46px; height: 46px; display: grid; place-items: center; border-radius: 15px; background: rgba(124,92,255,.13); font-size: 1.35rem; }
.capability-copy { display: grid; gap: 7px; }
.capability-copy strong { font-size: 1.02rem; }
.capability-copy small { color: var(--muted); line-height: 1.65; font-weight: 500; }
.capability-state { grid-column: 1 / -1; justify-self: start; padding: .32rem .62rem; border-radius: 999px; font-size: .74rem; font-weight: 800; }
.capability-state.ready { color: var(--success); background: rgba(45,212,168,.1); }
.capability-state.needs-setup { color: var(--warning); background: rgba(246,184,75,.1); }

.provider-editor { overflow: hidden; position: relative; }
.provider-editor::before { content: ''; position: absolute; inset-inline-end: -80px; inset-block-start: -100px; width: 260px; height: 260px; border-radius: 50%; background: rgba(124,92,255,.11); filter: blur(35px); pointer-events: none; }
.provider-editor > * { position: relative; }
.provider-diagnostic { display: grid; gap: 18px; padding: clamp(18px, 2.6vw, 28px); border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--panel); box-shadow: var(--shadow); }
.provider-diagnostic.ok { border-color: rgba(45,212,168,.45); background: linear-gradient(145deg, rgba(45,212,168,.09), var(--panel)); }
.provider-diagnostic.failed { border-color: rgba(251,113,133,.46); background: linear-gradient(145deg, rgba(251,113,133,.08), var(--panel)); }
.diagnostic-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.diagnostic-heading h3 { margin: 0; font-size: 1.25rem; }
.diagnostic-signal { padding: .42rem .72rem; border-radius: 999px; font-size: .78rem; font-weight: 850; white-space: nowrap; }
.diagnostic-signal.available { color: var(--success); background: rgba(45,212,168,.12); }
.diagnostic-signal.limited { color: var(--warning); background: rgba(246,184,75,.12); }
.diagnostic-signal.unavailable { color: var(--danger); background: rgba(251,113,133,.12); }
.diagnostic-signal.unknown { color: var(--muted); background: rgba(148,163,184,.12); }
.diagnostic-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.diagnostic-grid > div { min-height: 92px; display: grid; align-content: center; gap: 7px; padding: 14px; border: 1px solid var(--border); border-radius: 14px; background: rgba(255,255,255,.025); }
.diagnostic-grid small { color: var(--muted); }
.diagnostic-grid strong { overflow-wrap: anywhere; }
.provider-diagnostic > p { margin: 0; color: var(--muted); line-height: 1.8; }
.diagnostic-evidence { display: flex; flex-wrap: wrap; gap: 7px; }
.diagnostic-evidence span { padding: .3rem .55rem; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); font-size: .73rem; }
.provider-resource { position: relative; overflow: hidden; }
.provider-resource::before { content: ''; position: absolute; inset-block: 0; inset-inline-start: 0; width: 3px; background: var(--warning); }
.provider-resource.verified::before { background: var(--success); }
.provider-resource.failed::before { background: var(--danger); }

@media (max-width: 1050px) {
  .capability-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .diagnostic-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 680px) {
  .capability-grid, .diagnostic-grid { grid-template-columns: 1fr; }
  .capability-card { min-height: 128px; }
  .diagnostic-heading { align-items: stretch; flex-direction: column; }
  .diagnostic-signal { align-self: flex-start; }
  .provider-actions { display: grid; grid-template-columns: 1fr; width: 100%; }
  .provider-actions button { width: 100%; }
}
"""
    css_path.write_text(css)

package_path = Path("package.json")
package = json.loads(package_path.read_text())
package["version"] = "1.4.0"
package_path.write_text(json.dumps(package, indent=2, ensure_ascii=False) + "\n")

lock_path = Path("package-lock.json")
lock = json.loads(lock_path.read_text())
lock["version"] = "1.4.0"
lock.setdefault("packages", {}).setdefault("", {})["version"] = "1.4.0"
lock_path.write_text(json.dumps(lock, indent=2, ensure_ascii=False) + "\n")

changelog = Path("CHANGELOG.md")
text = changelog.read_text()
heading = "## [1.4.0] — 2026-07-11"
if heading not in text:
    insert_at = text.find("## [1.3.0]")
    if insert_at < 0:
        raise SystemExit("CHANGELOG 1.3 heading not found")
    section = """## [1.4.0] — 2026-07-11

### Telegram console and provider diagnostics

- Added a Telegram inline control panel, registered bot commands, provider selection, chat/agent mode, status, diagnostics, workspace file listing/reading, web search/fetch, GitHub repository inspection, tool confirmation, and direct links into the web dashboard.
- Persisted per-Chat-ID Telegram provider and mode preferences in encrypted integration metadata while keeping conversation context bounded in memory.
- Added explicit API diagnostics for authentication, authorization, model access, billing/credits, rate limits, network, timeout, service availability, and model-list support.
- Added honest free/paid reporting: successful requests prove current access but do not guess the plan when the provider does not expose it; explicit billing errors are shown as credits/payment required.
- Changed provider setup to Save & verify so valid keys become usable immediately and failed keys remain saved with actionable diagnostics.
- Added capability status to the dashboard and direct `?page=` navigation used by Telegram buttons.
- Improved provider cards, diagnostics, capability cards, mobile actions, typography, spacing, status colors, and responsive layouts.

"""
    changelog.write_text(text[:insert_at] + section + text[insert_at:])

readme = Path("README.md")
readme_text = readme.read_text()
needle = "> **حالة المشروع:**"
if "Telegram control panel" not in readme_text:
    position = readme_text.find(needle)
    if position >= 0:
        end = readme_text.find("\n", position)
        addition = "\n\n> **الإصدار 1.4.0:** أضيفت لوحة تحكم Telegram بأزرار وأوامر، اختيار المزوّد والوضع، فحص المفتاح والرصيد، أدوات الويب والملفات وGitHub، وتشخيص صريح للفوترة والأخطاء. Telegram control panel and provider diagnostics are now integrated with the same verified credentials used by the site."
        readme_text = readme_text[:end] + addition + readme_text[end:]
        readme.write_text(readme_text)
