import { AppError } from './errors.js';
import type { AgentStep, LLMToolSpec, Msg } from './llm-types.js';
import { diagnosticToAppError } from './providers/diagnostics.js';
import { getProviderDefinition, normalizeProviderConfig, providerAdapterFor } from './providers/index.js';
import type { ModelDiscoveryResult, ProviderDiagnosticResult, ProviderProtocol, ProviderStreamEvent } from './providers/types.js';

export type { AgentStep, LLMImage, LLMToolCall, LLMToolSpec, Msg } from './llm-types.js';

export type Provider = {
  type: string;
  apiKey: string;
  baseUrl?: string;
  defaultModel: string;
  name: string;
  customHeaders?: Record<string, string>;
  protocol?: ProviderProtocol;
  userId?: string;
  providerId?: string;
  credentialVersion?: number;
};

export type ProviderProbeAttempt = {
  model: string;
  status: 'working' | 'failed';
  errorCode?: string;
  errorStage?: string;
};

export type ProviderProbeResult = {
  message: string;
  model: string;
  modelsSupported: boolean;
  models: string[];
  attempts: ProviderProbeAttempt[];
  diagnostic: ProviderDiagnosticResult;
  discovery: ModelDiscoveryResult;
};

export class LLMError extends AppError {
  constructor(code: string, status: number, message: string, details?: unknown) {
    super(code, status, message, details);
    this.name = 'LLMError';
  }
}

function normalized(provider: Provider, selectedModel?: string) {
  return normalizeProviderConfig({
    providerType: provider.type,
    protocol: provider.protocol,
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    selectedModel: selectedModel ?? provider.defaultModel,
    customHeaders: provider.customHeaders,
    userId: provider.userId,
    providerId: provider.providerId,
    credentialVersion: provider.credentialVersion
  });
}

function errorCode(error: unknown): string | undefined {
  return error instanceof AppError ? error.code : undefined;
}

function errorStage(error: unknown): string | undefined {
  if (!(error instanceof AppError) || error.details === null || typeof error.details !== 'object' || Array.isArray(error.details)) return undefined;
  const details = error.details as Record<string, unknown>;
  if (details.diagnostic && typeof details.diagnostic === 'object' && !Array.isArray(details.diagnostic)) {
    const status = (details.diagnostic as Record<string, unknown>).status;
    if (typeof status === 'string') return status;
  }
  return typeof details.stage === 'string' ? details.stage : undefined;
}

function diagnosticFromError(error: unknown): ProviderDiagnosticResult | undefined {
  if (!(error instanceof AppError) || error.details === null || typeof error.details !== 'object' || Array.isArray(error.details)) return undefined;
  const diagnostic = (error.details as Record<string, unknown>).diagnostic;
  if (diagnostic === null || typeof diagnostic !== 'object' || Array.isArray(diagnostic)) return undefined;
  return diagnostic as ProviderDiagnosticResult;
}

function outputText(value: string): string {
  const text = value.trim();
  if (!text) throw new LLMError('provider_empty_response', 502, 'The provider returned an empty response.');
  return text;
}

function retryDelayMs(diagnostic: ProviderDiagnosticResult, retryIndex: number): number {
  if (diagnostic.retryAfterSeconds !== undefined) {
    return Math.min(Math.max(0, diagnostic.retryAfterSeconds * 1000), 30_000);
  }
  const exponential = Math.min(500 * 2 ** retryIndex, 5_000);
  return Math.round(exponential * (0.75 + Math.random() * 0.5));
}

function retryableInference(diagnostic: ProviderDiagnosticResult | undefined): diagnostic is ProviderDiagnosticResult {
  return Boolean(diagnostic?.retryable && [
    'rate_limited', 'provider_unavailable', 'timeout', 'network_error'
  ].includes(diagnostic.status));
}

async function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Request aborted.');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error('Request aborted.'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    timer.unref?.();
  });
}

export function isExecutableProviderModel(providerType: string, value: string | undefined | null): value is string {
  const model = value?.trim() ?? '';
  if (!model) return false;
  if (providerType.trim().toLowerCase() === 'omniroute' && /^auto(?:\/[A-Za-z0-9._:-]+)?$/i.test(model)) return true;
  return !/^(auto|default|free|latest)$/i.test(model);
}

export async function completeAgentStep(
  provider: Provider,
  messages: readonly Msg[],
  model?: string,
  tools: readonly LLMToolSpec[] = [],
  externalSignal?: AbortSignal
): Promise<AgentStep> {
  const selectedModel = (model || provider.defaultModel).trim();
  if (!isExecutableProviderModel(provider.type, selectedModel)) {
    throw new LLMError('provider_model_required', 422, 'A concrete model ID is required. OmniRoute also supports its documented auto/* virtual model IDs.');
  }
  const adapter = providerAdapterFor(provider.type, provider.protocol);
  const maxRetries = 2;
  let retryCount = 0;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (externalSignal?.aborted) throw externalSignal.reason instanceof Error ? externalSignal.reason : new Error('Request aborted.');
    try {
      const result = await adapter.createChatCompletion({
        config: normalized(provider, selectedModel),
        messages,
        model: selectedModel,
        tools,
        signal: externalSignal
      });
      return {
        text: result.text,
        toolCalls: result.toolCalls,
        model: result.model,
        retryCount,
        ...(result.requestId ? { requestId: result.requestId } : {}),
        ...(result.usage ? { usage: result.usage } : {})
      };
    } catch (error) {
      lastError = error;
      const diagnostic = diagnosticFromError(error);
      if (attempt >= maxRetries || !retryableInference(diagnostic)) break;
      await waitForRetry(retryDelayMs(diagnostic, attempt), externalSignal);
      retryCount += 1;
    }
  }

  if (lastError instanceof LLMError) throw lastError;
  if (lastError instanceof AppError) throw new LLMError(lastError.code, lastError.status, lastError.message, lastError.details);
  throw new LLMError('provider_unknown_error', 502, lastError instanceof Error ? lastError.message : 'Provider request failed.');
}

export async function complete(
  provider: Provider,
  messages: readonly Msg[],
  model?: string,
  externalSignal?: AbortSignal
): Promise<string> {
  return outputText((await completeAgentStep(provider, messages, model, [], externalSignal)).text);
}

export async function discoverProviderModels(
  provider: Provider,
  options: { force?: boolean; signal?: AbortSignal } = {}
): Promise<ModelDiscoveryResult> {
  const adapter = providerAdapterFor(provider.type, provider.protocol);
  return adapter.discoverModels(normalized(provider), options);
}

export async function listProviderModels(provider: Provider): Promise<{ supported: boolean; models: string[]; discovery?: ModelDiscoveryResult }> {
  const discovery = await discoverProviderModels(provider);
  const discovered = discovery.models.map((model) => model.id).filter((model) => isExecutableProviderModel(provider.type, model));
  const virtualModels = provider.type.trim().toLowerCase() === 'omniroute'
    ? getProviderDefinition('omniroute').modelExamples
    : [];
  return {
    supported: discovery.status === 'supported',
    models: [...new Set([...virtualModels, ...discovered])],
    discovery
  };
}

function shouldProbeNext(diagnostic: ProviderDiagnosticResult): boolean {
  return ['model_not_found', 'model_unavailable'].includes(diagnostic.status);
}

export async function diagnoseProviderConnection(provider: Provider, preferredModel?: string): Promise<ProviderProbeResult> {
  const adapter = providerAdapterFor(provider.type, provider.protocol);
  const config = normalized(provider, preferredModel ?? provider.defaultModel);
  let discovery: ModelDiscoveryResult;
  try {
    discovery = await adapter.discoverModels(config, { force: true });
  } catch (error) {
    const diagnostic = diagnosticFromError(error);
    if (!diagnostic || !['endpoint_not_found', 'model_discovery_unsupported'].includes(diagnostic.status)) throw error;
    discovery = {
      status: 'unsupported',
      models: getProviderDefinition(provider.type).modelExamples.map((id) => ({ id })),
      fromCache: false,
      message: diagnostic.message,
      ...(diagnostic.testedEndpoint ? { testedEndpoint: diagnostic.testedEndpoint } : {}),
      ...(diagnostic.httpStatus !== undefined ? { httpStatus: diagnostic.httpStatus } : {})
    };
  }

  const providerType = provider.type.trim().toLowerCase();
  const discoveredIds = discovery.models.map((model) => model.id).filter((model) => isExecutableProviderModel(providerType, model));
  const examples = getProviderDefinition(providerType).modelExamples.filter((model) => isExecutableProviderModel(providerType, model));
  const preferred = isExecutableProviderModel(providerType, preferredModel)
    ? preferredModel.trim()
    : isExecutableProviderModel(providerType, provider.defaultModel)
      ? provider.defaultModel.trim()
      : undefined;
  const fallbackExamples = providerType === 'omniroute'
    ? examples
    : discovery.status === 'unsupported' && !['custom', 'nararouter'].includes(providerType)
      ? examples
      : [];
  const candidates = [...new Set([
    ...(preferred ? [preferred] : []),
    ...(!preferred ? discoveredIds : []),
    ...(!preferred ? fallbackExamples : [])
  ])].slice(0, 8);

  if (candidates.length === 0) {
    throw new LLMError('provider_model_required', 422, 'No concrete model IDs were discovered. Enter a model ID manually.', {
      diagnostic: {
        success: false,
        status: 'model_discovery_unsupported',
        keyValid: null,
        providerReachable: discovery.status === 'supported' ? true : null,
        modelAvailable: null,
        retryable: false,
        message: 'No concrete model IDs were discovered.',
        userMessageAr: 'لم يتم اكتشاف معرف نموذج قابل للتنفيذ. أدخل معرف النموذج يدويًا.',
        userMessageEn: 'No executable model ID was discovered. Enter a model ID manually.',
        discovery
      }
    });
  }

  const attempts: ProviderProbeAttempt[] = [];
  let lastDiagnostic: ProviderDiagnosticResult | undefined;
  for (const candidate of candidates) {
    const diagnostic = await adapter.testConnection(normalized(provider, candidate), candidate);
    lastDiagnostic = { ...diagnostic, discovery };
    if (diagnostic.success) {
      attempts.push({ model: candidate, status: 'working' });
      return {
        message: 'OK',
        model: candidate,
        modelsSupported: discovery.status === 'supported',
        models: providerType === 'omniroute'
          ? [...new Set([...examples, ...discoveredIds])]
          : discoveredIds.length ? discoveredIds : fallbackExamples,
        attempts,
        diagnostic: { ...diagnostic, discovery },
        discovery
      };
    }
    attempts.push({
      model: candidate,
      status: 'failed',
      errorCode: `provider_${diagnostic.status}`,
      errorStage: diagnostic.status
    });
    if (!shouldProbeNext(diagnostic)) break;
  }

  const diagnostic: ProviderDiagnosticResult = lastDiagnostic ?? {
    success: false,
    ok: false,
    stage: 'inference',
    status: 'unknown_error',
    errorType: 'UNKNOWN_PROVIDER_ERROR',
    keyValid: null,
    providerReachable: null,
    modelAvailable: null,
    retryable: false,
    message: 'No model passed provider diagnostics.',
    userMessage: 'لم ينجح أي نموذج في فحص المزوّد.',
    userMessageAr: 'لم ينجح أي نموذج في فحص المزوّد.',
    userMessageEn: 'No model passed provider diagnostics.',
    discovery
  };
  const appError = diagnosticToAppError({ ...diagnostic, discovery });
  throw new LLMError(appError.code, appError.status, appError.message, {
    ...(appError.details && typeof appError.details === 'object' && !Array.isArray(appError.details) ? appError.details : {}),
    attempts
  });
}

export async function testProviderConnection(provider: Provider, model?: string): Promise<{ message: string; model: string; diagnostic: ProviderDiagnosticResult }> {
  const selectedModel = (model || provider.defaultModel).trim();
  const adapter = providerAdapterFor(provider.type, provider.protocol);
  const diagnostic = await adapter.testConnection(normalized(provider, selectedModel), selectedModel);
  if (!diagnostic.success) {
    const appError = diagnosticToAppError(diagnostic);
    throw new LLMError(appError.code, appError.status, appError.message, appError.details);
  }
  return { message: 'OK', model: diagnostic.testedModel || selectedModel, diagnostic };
}

export async function* streamProviderCompletion(
  provider: Provider,
  messages: readonly Msg[],
  model: string,
  externalSignal?: AbortSignal
): AsyncIterable<ProviderStreamEvent> {
  const selectedModel = model.trim();
  if (!isExecutableProviderModel(provider.type, selectedModel)) {
    throw new LLMError('provider_model_required', 422, 'A concrete model ID is required. OmniRoute also supports its documented auto/* virtual model IDs.');
  }
  const adapter = providerAdapterFor(provider.type, provider.protocol);
  if (!adapter.streamChatCompletion) {
    throw new LLMError('provider_unsupported_streaming', 422, 'Streaming is not supported by this provider adapter.');
  }
  yield* adapter.streamChatCompletion({
    config: normalized(provider, selectedModel),
    messages,
    model: selectedModel,
    signal: externalSignal
  });
}

export function providerFailureCode(error: unknown): string {
  return errorCode(error) ?? `provider_${errorStage(error) ?? 'unknown_error'}`;
}
