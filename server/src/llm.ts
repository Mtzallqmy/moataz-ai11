import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from './config.js';
import { AppError } from './errors.js';
import { assertSafeOutboundUrl } from './network.js';
import { assertProviderCredentials, providerAdapter } from './providers.js';
import { upstreamAppError } from './upstream-errors.js';

export type Provider = { type: string; apiKey: string; baseUrl?: string; defaultModel: string; name: string };
export type LLMToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
export type LLMToolCall = { id: string; name: string; arguments: Record<string, unknown> };
export type Msg =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: readonly LLMToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; name: string };
export type AgentStep = { text: string; toolCalls: LLMToolCall[]; model: string };

export class LLMError extends AppError {
  constructor(code: string, status: number, message: string, details?: unknown) {
    super(code, status, message, details);
    this.name = 'LLMError';
  }
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

function safeError(provider: Provider, error: unknown): LLMError {
  if (error instanceof LLMError) return error;
  if (error instanceof AppError) return new LLMError(error.code, error.status, error.message, error.details);
  const mapped = upstreamAppError('provider', provider.type, error);
  return new LLMError(mapped.code, mapped.status, mapped.message, mapped.details);
}

function openAiHeaders(provider: Provider): Record<string, string> | undefined {
  const isOpenRouter = provider.type === 'openrouter' || /openrouter\.ai/i.test(provider.baseUrl ?? '');
  if (!isOpenRouter) return undefined;
  return {
    'HTTP-Referer': config.appUrl,
    'X-Title': 'Moataz AI'
  };
}

async function validateProviderEndpoint(provider: Provider): Promise<void> {
  assertProviderCredentials(provider.type, provider.apiKey, provider.baseUrl);
  if (!provider.baseUrl) return;
  await assertSafeOutboundUrl(provider.baseUrl, !config.isProduction && provider.type === 'ollama');
}

function openAiClient(provider: Provider): OpenAI {
  const headers = openAiHeaders(provider);
  return new OpenAI({
    apiKey: provider.apiKey.trim() || 'not-required',
    ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {}),
    ...(headers ? { defaultHeaders: headers } : {}),
    maxRetries: 1
  });
}

function assertOutput(provider: Provider, output: string): string {
  const value = output.trim();
  if (!value) {
    throw new LLMError('provider_empty_response', 502, 'The provider returned an empty response.', {
      domain: 'provider', service: provider.type, stage: 'unknown', providerMessage: 'Empty response', retryable: true
    });
  }
  return value;
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    throw new LLMError('provider_invalid_tool_arguments', 422, 'The provider returned invalid tool arguments.');
  }
}

function anthropicMessages(messages: readonly Msg[]): Anthropic.MessageParam[] {
  return messages
    .filter((message) => message.role !== 'system')
    .map((message): Anthropic.MessageParam => {
      if (message.role === 'assistant') {
        const toolText = message.toolCalls?.length
          ? `\nRequested tools: ${JSON.stringify(message.toolCalls.map((call) => ({ name: call.name, arguments: call.arguments })))}.`
          : '';
        return { role: 'assistant', content: `${message.content}${toolText}` };
      }
      if (message.role === 'tool') {
        return { role: 'user', content: `Untrusted tool result for ${message.name}:\n${message.content}` };
      }
      return { role: 'user', content: message.content };
    });
}

function openAiMessages(messages: readonly Msg[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((message): OpenAI.Chat.Completions.ChatCompletionMessageParam => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.name, arguments: JSON.stringify(call.arguments) }
        }))
      };
    }
    return { role: message.role, content: message.content };
  });
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
    await validateProviderEndpoint(provider);
    const adapter = providerAdapter(provider.type);
    if (adapter === 'anthropic') {
      const client = new Anthropic({ apiKey: provider.apiKey, ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {}) });
      const system = messages.find((message) => message.role === 'system')?.content ?? 'You are Moataz AI.';
      const output = await client.messages.create(
        { model: selectedModel, max_tokens: 3000, system, messages: anthropicMessages(messages) },
        { signal }
      );
      const text = output.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n').trim();
      return { text, toolCalls: [], model: selectedModel };
    }

    if (adapter === 'gemini') {
      const modelClient = new GoogleGenerativeAI(provider.apiKey).getGenerativeModel({ model: selectedModel });
      const prompt = messages.map((message) => {
        if (message.role === 'tool') return `tool (${message.name}, untrusted output): ${message.content}`;
        return `${message.role}: ${message.content}`;
      }).join('\n\n');
      const generate = modelClient.generateContent.bind(modelClient) as (input: string, options?: { signal?: AbortSignal }) => ReturnType<typeof modelClient.generateContent>;
      const result = await generate(prompt, { signal });
      return { text: result.response.text().trim(), toolCalls: [], model: selectedModel };
    }

    const openAiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters }
    }));
    const response = await openAiClient(provider).chat.completions.create(
      {
        model: selectedModel,
        messages: openAiMessages(messages),
        temperature: 0.3,
        ...(openAiTools.length > 0 ? { tools: openAiTools, tool_choice: 'auto' } : {})
      },
      { signal }
    );
    const message = response.choices[0]?.message;
    const toolCalls = (message?.tool_calls ?? []).flatMap((call): LLMToolCall[] => {
      if (call.type !== 'function' || !call.function.name) return [];
      return [{ id: call.id, name: call.function.name, arguments: parseArguments(call.function.arguments) }];
    });
    return { text: message?.content?.trim() ?? '', toolCalls, model: response.model || selectedModel };
  } catch (error) {
    throw safeError(provider, error);
  } finally {
    dispose();
  }
}

export async function complete(provider: Provider, messages: readonly Msg[], model?: string, externalSignal?: AbortSignal): Promise<string> {
  const step = await completeAgentStep(provider, messages, model, [], externalSignal);
  return assertOutput(provider, step.text);
}

export async function listProviderModels(provider: Provider): Promise<{ supported: boolean; models: string[] }> {
  if (providerAdapter(provider.type) !== 'openai-compatible') return { supported: false, models: [] };
  const { signal, dispose } = combinedSignal();
  try {
    await validateProviderEndpoint(provider);
    const page = await openAiClient(provider).models.list({ signal });
    const models = [...new Set(page.data.map((entry) => entry.id).filter(Boolean))].sort().slice(0, 300);
    return { supported: true, models };
  } catch (error) {
    throw safeError(provider, error);
  } finally {
    dispose();
  }
}

export async function testProviderConnection(provider: Provider, model?: string): Promise<{ message: string; model: string }> {
  const selectedModel = (model || provider.defaultModel).trim();
  const message = await complete(
    provider,
    [
      { role: 'system', content: 'Return exactly OK.' },
      { role: 'user', content: 'Connection test.' }
    ],
    selectedModel
  );
  return { message: message.slice(0, 120), model: selectedModel };
}
