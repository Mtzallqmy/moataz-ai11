import { AppError } from './errors.js';
import { config } from './config.js';
import {
  createChatCompletion,
  discoverModels,
  testProvider,
  type ProviderMessage,
  type ProviderRuntimeInput,
  type ProviderToolCall,
  type ProviderToolSpec
} from './providers/index.js';
import { diagnosticToAppError } from './providers/diagnostics.js';

export type Provider = ProviderRuntimeInput;
export type LLMToolSpec = ProviderToolSpec;
export type LLMToolCall = ProviderToolCall;
export type Msg =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: readonly LLMToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; name: string };
export type AgentStep = {
  text: string;
  toolCalls: LLMToolCall[];
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export class LLMError extends AppError {
  constructor(code: string, status: number, message: string, details?: unknown) {
    super(code, status, message, details);
    this.name = 'LLMError';
  }
}

function providerMessages(messages: readonly Msg[]): ProviderMessage[] {
  return messages.map((message): ProviderMessage => {
    if (message.role === 'tool') return { role: 'tool', content: message.content, toolCallId: message.toolCallId, name: message.name };
    if (message.role === 'assistant') return { role: 'assistant', content: message.content, ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}) };
    return { role: message.role, content: message.content };
  });
}

function combinedSignal(external?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('llm_timeout')), config.llmTimeoutMs);
  timer.unref();
  const onAbort = () => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) onAbort();
    else external.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    }
  };
}

function toLlmError(error: unknown): LLMError {
  if (error instanceof LLMError) return error;
  if (error instanceof AppError) return new LLMError(error.code, error.status, error.message, error.details);
  return new LLMError('provider_unknown_error', 502, error instanceof Error ? error.message : String(error));
}

export async function completeAgentStep(
  provider: Provider,
  messages: readonly Msg[],
  model?: string,
  tools: readonly LLMToolSpec[] = [],
  externalSignal?: AbortSignal
): Promise<AgentStep> {
  const selectedModel = (model || provider.defaultModel).trim();
  if (!selectedModel) throw new LLMError('provider_model_required', 422, 'A model is required.');
  const { signal, dispose } = combinedSignal(externalSignal);
  try {
    const result = await createChatCompletion({
      provider,
      messages: providerMessages(messages),
      model: selectedModel,
      tools,
      signal
    });
    return {
      text: result.text,
      toolCalls: result.toolCalls,
      model: result.model,
      ...(result.inputTokens !== undefined ? { inputTokens: result.inputTokens } : {}),
      ...(result.outputTokens !== undefined ? { outputTokens: result.outputTokens } : {}),
      ...(result.totalTokens !== undefined ? { totalTokens: result.totalTokens } : {})
    };
  } catch (error) {
    throw toLlmError(error);
  } finally {
    dispose();
  }
}

export async function complete(provider: Provider, messages: readonly Msg[], model?: string, externalSignal?: AbortSignal): Promise<string> {
  const result = await completeAgentStep(provider, messages, model, [], externalSignal);
  const text = result.text.trim();
  if (!text) throw new LLMError('provider_empty_response', 502, 'The provider returned an empty response.');
  return text;
}

export async function listProviderModels(provider: Provider): Promise<{ supported: boolean; models: string[]; result: Awaited<ReturnType<typeof discoverModels>> }> {
  const result = await discoverModels(provider);
  return { supported: result.supported, models: result.models.map((model) => model.id), result };
}

export async function testProviderConnection(provider: Provider, model?: string): Promise<{ message: string; model: string; diagnostic: Awaited<ReturnType<typeof testProvider>> }> {
  const diagnostic = await testProvider({ provider, ...(model ? { model } : {}) });
  if (!diagnostic.success) throw diagnosticToAppError(diagnostic);
  return { message: 'OK', model: diagnostic.testedModel ?? model ?? provider.defaultModel, diagnostic };
}
