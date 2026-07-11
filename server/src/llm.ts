import { AppError } from './errors.js';
import type {
  AgentStep,
  LLMToolSpec,
  Msg
} from './llm-types.js';
import {
  createProviderChatCompletion,
  discoverModels,
  streamProviderChatCompletion,
  testProviderConnection as runProviderTest,
  type ProviderRuntimeConfig,
  type ProviderStreamEvent
} from './providers/index.js';

export type { AgentStep, LLMImage, LLMToolCall, LLMToolSpec, Msg } from './llm-types.js';

export type Provider = {
  type: string;
  apiKey: string;
  baseUrl?: string;
  defaultModel: string;
  name: string;
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
};

export class LLMError extends AppError {
  constructor(code: string, status: number, message: string, details?: unknown) {
    super(code, status, message, details);
    this.name = 'LLMError';
  }
}

function runtimeConfig(provider: Provider, model?: string): ProviderRuntimeConfig {
  return {
    providerType: provider.type,
    displayName: provider.name,
    apiKey: provider.apiKey,
    model: (model ?? provider.defaultModel).trim(),
    ...(provider.baseUrl ? { rawBaseUrl: provider.baseUrl } : {})
  };
}

function llmError(error: unknown): LLMError {
  if (error instanceof LLMError) return error;
  if (error instanceof AppError) return new LLMError(error.code, error.status, error.message, error.details);
  return new LLMError('provider_unknown_error', 502, error instanceof Error ? error.message : String(error));
}

function output(provider: Provider, value: string): string {
  const text = value.trim();
  if (!text) {
    throw new LLMError('provider_invalid_response', 502, 'The provider returned an empty response.', {
      providerType: provider.type,
      retryable: true
    });
  }
  return text;
}

export async function completeAgentStep(
  provider: Provider,
  messages: readonly Msg[],
  model?: string,
  tools: readonly LLMToolSpec[] = [],
  signal?: AbortSignal
): Promise<AgentStep> {
  try {
    return await createProviderChatCompletion({
      config: runtimeConfig(provider, model),
      messages,
      tools,
      signal
    });
  } catch (error) {
    throw llmError(error);
  }
}

export async function complete(
  provider: Provider,
  messages: readonly Msg[],
  model?: string,
  signal?: AbortSignal
): Promise<string> {
  const step = await completeAgentStep(provider, messages, model, [], signal);
  return output(provider, step.text);
}

export async function* streamComplete(
  provider: Provider,
  messages: readonly Msg[],
  model?: string,
  tools: readonly LLMToolSpec[] = [],
  signal?: AbortSignal
): AsyncIterable<ProviderStreamEvent> {
  try {
    yield* streamProviderChatCompletion({
      config: runtimeConfig(provider, model),
      messages,
      tools,
      signal
    });
  } catch (error) {
    throw llmError(error);
  }
}

export async function listProviderModels(provider: Provider): Promise<{ supported: boolean; models: string[] }> {
  try {
    const result = await discoverModels(runtimeConfig(provider), { force: false });
    return {
      supported: result.status === 'supported',
      models: result.models.map((model) => model.id)
    };
  } catch (error) {
    throw llmError(error);
  }
}

export async function diagnoseProviderConnection(provider: Provider, preferredModel?: string): Promise<ProviderProbeResult> {
  const selectedModel = (preferredModel ?? provider.defaultModel).trim();
  const attempts: ProviderProbeAttempt[] = [];
  try {
    const result = await runProviderTest({ config: runtimeConfig(provider, selectedModel) });
    attempts.push({ model: result.model, status: 'working' });
    return {
      message: result.responsePreview,
      model: result.model,
      modelsSupported: result.discovery.status === 'supported',
      models: result.discovery.models.map((model) => model.id),
      attempts
    };
  } catch (error) {
    const mapped = llmError(error);
    const details = mapped.details !== null && typeof mapped.details === 'object' && !Array.isArray(mapped.details)
      ? mapped.details as Record<string, unknown>
      : {};
    attempts.push({
      model: selectedModel,
      status: 'failed',
      errorCode: mapped.code,
      ...(typeof details.status === 'string' ? { errorStage: details.status } : {})
    });
    throw new LLMError(mapped.code, mapped.status, mapped.message, { ...details, attempts });
  }
}

export async function testProviderConnection(provider: Provider, model?: string): Promise<{ message: string; model: string }> {
  try {
    const result = await runProviderTest({ config: runtimeConfig(provider, model) });
    return { message: result.responsePreview, model: result.model };
  } catch (error) {
    throw llmError(error);
  }
}
