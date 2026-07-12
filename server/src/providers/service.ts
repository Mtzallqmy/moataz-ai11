import { AppError } from '../errors.js';
import type { AgentStep } from '../llm-types.js';
import { adapterForProtocol } from './adapters/index.js';
import { resolveProviderUrls } from './base-url.js';
import { diagnoseProviderError, providerDiagnosticError, readyProviderDiagnostic } from './diagnostics.js';
import { discoverProviderModels } from './model-discovery.js';
import { getProviderDefinition } from './registry.js';
import type {
  ModelDiscoveryResult,
  ProviderChatInput,
  ProviderDiagnosticResult,
  ProviderRuntimeConfig,
  ProviderStreamEvent
} from './types.js';

function concreteModel(value: string): boolean {
  const model = value.trim();
  return Boolean(model) && !/^(auto|default|free|latest)$/i.test(model);
}

function enforceBaseUrlPolicy(input: ProviderRuntimeConfig): void {
  const definition = getProviderDefinition(input.providerType);
  const supplied = input.rawBaseUrl ?? input.normalizedBaseUrl;
  if (!supplied || definition.allowsCustomBaseUrl || !definition.defaultBaseUrl) return;
  const suppliedUrl = resolveProviderUrls(definition.id, supplied).normalizedBaseUrl;
  const defaultUrl = resolveProviderUrls(definition.id, definition.defaultBaseUrl).normalizedBaseUrl;
  if (suppliedUrl !== defaultUrl) {
    throw new AppError('provider_custom_base_url_forbidden', 422, 'This native provider adapter does not accept a custom Base URL.', {
      providerType: definition.id,
      retryable: false
    });
  }
}

export function normalizeProviderConfig(input: ProviderRuntimeConfig): ProviderRuntimeConfig {
  const definition = getProviderDefinition(input.providerType);
  enforceBaseUrlPolicy(input);
  const adapter = adapterForProtocol(definition.protocol);
  return adapter.normalizeConfig({
    ...input,
    providerType: definition.id,
    displayName: input.displayName || definition.displayName
  });
}

export async function discoverModels(
  input: ProviderRuntimeConfig,
  options: { signal?: AbortSignal | undefined; force?: boolean | undefined } = {}
): Promise<ModelDiscoveryResult> {
  try {
    return await discoverProviderModels(normalizeProviderConfig(input), options);
  } catch (error) {
    const endpoint = input.normalizedBaseUrl ?? input.rawBaseUrl;
    const diagnostic = diagnoseProviderError(error, {
      ...(endpoint ? { endpoint } : {}),
      providerReachableHint: null,
      keyValidHint: null
    });
    throw providerDiagnosticError(diagnostic);
  }
}

function testedEndpoint(input: ProviderRuntimeConfig): string | undefined {
  const definition = getProviderDefinition(input.providerType);
  if (definition.protocol !== 'openai-compatible') return input.normalizedBaseUrl;
  return resolveProviderUrls(input.providerType, input.normalizedBaseUrl ?? input.rawBaseUrl).resolvedChatUrl ?? undefined;
}

export async function testProviderConnection(input: {
  config: ProviderRuntimeConfig;
  requestId?: string | undefined;
  signal?: AbortSignal | undefined;
}): Promise<{
  diagnostic: ProviderDiagnosticResult;
  discovery: ModelDiscoveryResult;
  responsePreview: string;
  model: string;
}> {
  const runtime = normalizeProviderConfig(input.config);
  if (!concreteModel(runtime.model)) {
    throw providerDiagnosticError({
      success: false,
      status: 'invalid_request',
      keyValid: null,
      providerReachable: null,
      modelAvailable: null,
      retryable: false,
      message: 'A concrete model ID is required for the inference probe.',
      userMessageAr: 'اختر Model ID محددًا قبل فحص التنفيذ. اكتشاف النماذج لا يختار نموذجًا تلقائيًا نيابة عنك.',
      userMessageEn: 'Choose a concrete model ID before the inference probe. Model discovery does not select a model automatically.',
      ...(input.requestId ? { requestId: input.requestId } : {}),
      testedModel: runtime.model
    });
  }

  let discovery: ModelDiscoveryResult;
  try {
    discovery = await discoverProviderModels(runtime, {
      ...(input.signal ? { signal: input.signal } : {})
    });
  } catch (error) {
    const discoveryDiagnostic = diagnoseProviderError(error, {
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(runtime.normalizedBaseUrl ? { endpoint: runtime.normalizedBaseUrl } : {}),
      model: runtime.model
    });
    if (discoveryDiagnostic.status === 'invalid_api_key' || discoveryDiagnostic.status === 'forbidden') {
      throw providerDiagnosticError(discoveryDiagnostic);
    }
    discovery = {
      status: discoveryDiagnostic.status === 'endpoint_not_found' ? 'unsupported' : 'failed',
      models: [],
      testedEndpoints: discoveryDiagnostic.testedEndpoint ? [discoveryDiagnostic.testedEndpoint] : [],
      latencyMs: discoveryDiagnostic.latencyMs ?? 0,
      cached: false,
      message: discoveryDiagnostic.userMessageEn
    };
  }

  const adapter = adapterForProtocol(getProviderDefinition(runtime.providerType).protocol);
  const started = performance.now();
  try {
    const result = await adapter.createChatCompletion({
      config: runtime,
      messages: [
        { role: 'system', content: 'Reply with exactly: OK' },
        { role: 'user', content: 'Reply with exactly: OK' }
      ],
      maxOutputTokens: 5,
      temperature: 0,
      ...(input.signal ? { signal: input.signal } : {})
    });
    const response = result.text.trim();
    if (!/^OK[.!]?$/i.test(response)) {
      throw new AppError('provider_invalid_response', 502, 'The inference probe returned an unexpected response.', {
        responsePreview: response.slice(0, 120),
        retryable: false
      });
    }
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    const endpoint = testedEndpoint(runtime);
    const diagnostic = readyProviderDiagnostic({
      ...(endpoint ? { endpoint } : {}),
      model: result.model || runtime.model,
      latencyMs,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(result.upstreamRequestId ? { upstreamRequestId: result.upstreamRequestId } : {}),
      discovery
    });
    return {
      diagnostic,
      discovery,
      responsePreview: response.slice(0, 120),
      model: result.model || runtime.model
    };
  } catch (error) {
    const endpoint = testedEndpoint(runtime);
    const diagnostic = diagnoseProviderError(error, {
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(endpoint ? { endpoint } : {}),
      model: runtime.model,
      discovery,
      keyValidHint: discovery.status === 'supported' ? true : null,
      providerReachableHint: discovery.status === 'supported' ? true : null,
      latencyMs: Math.max(0, Math.round(performance.now() - started))
    });
    throw providerDiagnosticError(diagnostic);
  }
}

export async function createProviderChatCompletion(input: ProviderChatInput): Promise<AgentStep> {
  const runtime = normalizeProviderConfig(input.config);
  if (!concreteModel(runtime.model)) throw new AppError('provider_model_required', 422, 'A concrete model ID is required.');
  const adapter = adapterForProtocol(getProviderDefinition(runtime.providerType).protocol);
  try {
    const result = await adapter.createChatCompletion({ ...input, config: runtime });
    return {
      text: result.text,
      toolCalls: result.toolCalls,
      model: result.model,
      ...(result.usage ? { usage: result.usage } : {}),
      ...(result.upstreamRequestId ? { upstreamRequestId: result.upstreamRequestId } : {})
    };
  } catch (error) {
    const endpoint = testedEndpoint(runtime);
    const diagnostic = diagnoseProviderError(error, {
      ...(endpoint ? { endpoint } : {}),
      model: runtime.model
    });
    throw providerDiagnosticError(diagnostic);
  }
}

export async function* streamProviderChatCompletion(input: ProviderChatInput): AsyncIterable<ProviderStreamEvent> {
  const runtime = normalizeProviderConfig(input.config);
  if (!concreteModel(runtime.model)) throw new AppError('provider_model_required', 422, 'A concrete model ID is required.');
  const adapter = adapterForProtocol(getProviderDefinition(runtime.providerType).protocol);
  if (!adapter.streamChatCompletion) throw new AppError('provider_streaming_unsupported', 422, 'This provider adapter does not support streaming.');
  try {
    yield* adapter.streamChatCompletion({ ...input, config: runtime });
  } catch (error) {
    const endpoint = testedEndpoint(runtime);
    throw providerDiagnosticError(diagnoseProviderError(error, {
      ...(endpoint ? { endpoint } : {}),
      model: runtime.model
    }));
  }
}
