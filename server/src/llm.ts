import { AppError } from './errors.js';
import type { AgentStep, LLMToolSpec, Msg } from './llm-types.js';
import { diagnosticToAppError } from './providers/diagnostics.js';
import { getProviderDefinition, normalizeProviderConfig, providerAdapterFor } from './providers/index.js';
import type { ModelDiscoveryResult, ProviderDiagnosticResult } from './providers/types.js';

export type { AgentStep, LLMImage, LLMToolCall, LLMToolSpec, Msg } from './llm-types.js';

export type Provider = {
  type: string;
  apiKey: string;
  baseUrl?: string;
  defaultModel: string;
  name: string;
  customHeaders?: Record<string, string>;
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
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    selectedModel: selectedModel ?? provider.defaultModel,
    customHeaders: provider.customHeaders
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

export async function completeAgentStep(
  provider: Provider,
  messages: readonly Msg[],
  model?: string,
  tools: readonly LLMToolSpec[] = [],
  externalSignal?: AbortSignal
): Promise<AgentStep> {
  const selectedModel = (model || provider.defaultModel).trim();
  if (!selectedModel || /^(auto|default|free)$/i.test(selectedModel)) {
    throw new LLMError('provider_model_required', 422, 'A concrete model ID is required. Discover models or diagnose the provider first.');
  }
  try {
    const adapter = providerAdapterFor(provider.type);
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
      ...(result.requestId ? { requestId: result.requestId } : {}),
      ...(result.usage ? { usage: result.usage } : {})
    };
  } catch (error) {
    if (error instanceof LLMError) throw error;
    if (error instanceof AppError) throw new LLMError(error.code, error.status, error.message, error.details);
    throw new LLMError('provider_unknown_error', 502, error instanceof Error ? error.message : 'Provider request failed.');
  }
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
  const adapter = providerAdapterFor(provider.type);
  return adapter.discoverModels(normalized(provider), options);
}

export async function listProviderModels(provider: Provider): Promise<{ supported: boolean; models: string[]; discovery?: ModelDiscoveryResult }> {
  const discovery = await discoverProviderModels(provider);
  return {
    supported: discovery.status === 'supported',
    models: discovery.models.map((model) => model.id),
    discovery
  };
}

function concreteModel(value: string | undefined | null): value is string {
  return Boolean(value?.trim()) && !/^(auto|default|free|latest)$/i.test(value!.trim());
}

function shouldProbeNext(diagnostic: ProviderDiagnosticResult): boolean {
  return [
    'model_not_found',
    'model_unavailable',
    'forbidden',
    'invalid_request',
    'billing_required',
    'insufficient_quota'
  ].includes(diagnostic.status);
}

export async function diagnoseProviderConnection(provider: Provider, preferredModel?: string): Promise<ProviderProbeResult> {
  const adapter = providerAdapterFor(provider.type);
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

  const discoveredIds = discovery.models.map((model) => model.id).filter(concreteModel);
  const examples = getProviderDefinition(provider.type).modelExamples.filter(concreteModel);
  const preferred = concreteModel(preferredModel)
    ? preferredModel.trim()
    : concreteModel(provider.defaultModel)
      ? provider.defaultModel.trim()
      : undefined;
  const candidates = [...new Set([
    ...(preferred ? [preferred] : []),
    ...discoveredIds,
    ...examples
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
        models: discoveredIds.length ? discoveredIds : examples,
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

  const diagnostic = lastDiagnostic ?? {
    success: false,
    status: 'unknown_error' as const,
    keyValid: null,
    providerReachable: null,
    modelAvailable: null,
    retryable: false,
    message: 'No model passed provider diagnostics.',
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
  const adapter = providerAdapterFor(provider.type);
  const diagnostic = await adapter.testConnection(normalized(provider, selectedModel), selectedModel);
  if (!diagnostic.success) {
    const appError = diagnosticToAppError(diagnostic);
    throw new LLMError(appError.code, appError.status, appError.message, appError.details);
  }
  return { message: 'OK', model: diagnostic.testedModel || selectedModel, diagnostic };
}

export function providerFailureCode(error: unknown): string {
  return errorCode(error) ?? `provider_${errorStage(error) ?? 'unknown_error'}`;
}
