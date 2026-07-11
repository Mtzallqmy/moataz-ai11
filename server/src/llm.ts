import type OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from './config.js';
import { AppError } from './errors.js';
import { assertSafeOutboundUrl } from './network.js';
import { assertProviderCredentials, providerAdapter, providerDefinition } from './providers.js';
import { upstreamAppError } from './upstream-errors.js';

export type Provider = { type: string; apiKey: string; baseUrl?: string; defaultModel: string; name: string };
export type LLMToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
export type LLMToolCall = { id: string; name: string; arguments: Record<string, unknown> };
export type LLMImage = { mimeType: string; dataBase64: string; name?: string };
export type Msg =
  | { role: 'system' | 'user'; content: string; images?: readonly LLMImage[] }
  | { role: 'assistant'; content: string; toolCalls?: readonly LLMToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; name: string };
export type AgentStep = { text: string; toolCalls: LLMToolCall[]; model: string };
export type ProviderProbeAttempt = { model: string; status: 'working' | 'failed'; errorCode?: string; errorStage?: string };
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

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
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

function openAiHeaders(provider: Provider): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
  if (provider.apiKey.trim()) headers.Authorization = `Bearer ${provider.apiKey.trim()}`;
  const isOpenRouter = provider.type === 'openrouter' || /openrouter\.ai/i.test(provider.baseUrl ?? '');
  if (isOpenRouter) {
    headers['HTTP-Referer'] = config.appUrl;
    headers['X-Title'] = 'Moataz AI';
  }
  return headers;
}

async function validateProviderEndpoint(provider: Provider): Promise<void> {
  assertProviderCredentials(provider.type, provider.apiKey, provider.baseUrl);
  if (!provider.baseUrl) return;
  await assertSafeOutboundUrl(provider.baseUrl, !config.isProduction && provider.type === 'ollama');
}

function providerApiBase(provider: Provider): string {
  const raw = provider.baseUrl?.trim() || 'https://api.openai.com/v1';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LLMError('provider_invalid_request', 422, 'The provider Base URL is invalid.', {
      domain: 'provider', service: provider.type, stage: 'invalid_request', providerMessage: 'Invalid Base URL', retryable: false
    });
  }
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

function providerApiUrl(provider: Provider, resource: 'models' | 'chat/completions'): string {
  const base = providerApiBase(provider);
  try {
    return new URL(resource, `${base}/`).toString();
  } catch {
    throw new LLMError('provider_invalid_request', 422, 'The provider endpoint could not be constructed.', {
      domain: 'provider', service: provider.type, stage: 'invalid_request', providerMessage: 'Invalid URL', retryable: false
    });
  }
}

function payloadMessage(payload: unknown, fallback: string): string {
  const root = record(payload);
  const nested = record(root.error);
  const candidates = [nested.message, nested.detail, root.message, root.detail, root.error_description, root.error];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 1200);
  }
  return fallback;
}

async function providerJson(
  provider: Provider,
  resource: 'models' | 'chat/completions',
  init: { method: 'GET' | 'POST'; body?: unknown },
  signal: AbortSignal
): Promise<unknown> {
  const rawUrl = providerApiUrl(provider, resource);
  const url = await assertSafeOutboundUrl(rawUrl, !config.isProduction && provider.type === 'ollama');
  const response = await fetch(url, {
    method: init.method,
    headers: openAiHeaders(provider),
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal,
    redirect: 'manual'
  });
  if (response.status >= 300 && response.status < 400) {
    throw Object.assign(new Error('Provider redirects are not accepted for API requests.'), {
      status: response.status,
      response: { status: response.status, data: { message: 'Unexpected provider redirect.' } }
    });
  }
  const raw = await response.text();
  let payload: unknown = {};
  if (raw.trim()) {
    try { payload = JSON.parse(raw) as unknown; }
    catch {
      payload = { message: raw.slice(0, 1200) };
    }
  }
  if (!response.ok) {
    const message = payloadMessage(payload, `${provider.name || provider.type} returned HTTP ${response.status}.`);
    throw Object.assign(new Error(message), {
      status: response.status,
      response: { status: response.status, data: payload }
    });
  }
  return payload;
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
      if (message.images?.length) {
        const content: Anthropic.ContentBlockParam[] = [
          ...message.images.map((image): Anthropic.ImageBlockParam => ({
            type: 'image',
            source: { type: 'base64', media_type: image.mimeType as Anthropic.Base64ImageSource['media_type'], data: image.dataBase64 }
          })),
          { type: 'text', text: message.content }
        ];
        return { role: 'user', content };
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
    if (message.role === 'user' && message.images?.length) {
      return {
        role: 'user',
        content: [
          { type: 'text', text: message.content },
          ...message.images.map((image) => ({
            type: 'image_url' as const,
            image_url: { url: `data:${image.mimeType};base64,${image.dataBase64}`, detail: 'auto' as const }
          }))
        ]
      };
    }
    return { role: message.role, content: message.content };
  });
}

function textFromOpenAiContent(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.flatMap((part): string[] => {
    if (typeof part === 'string') return [part];
    const item = record(part);
    return typeof item.text === 'string' ? [item.text] : [];
  }).join('\n').trim();
}

function openAiStepFromPayload(payload: unknown, selectedModel: string): AgentStep {
  const root = record(payload);
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const first = record(choices[0]);
  const message = record(first.message);
  const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolCalls = rawCalls.flatMap((rawCall): LLMToolCall[] => {
    const call = record(rawCall);
    const fn = record(call.function);
    if (typeof fn.name !== 'string' || !fn.name) return [];
    const rawArguments = typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {});
    return [{
      id: typeof call.id === 'string' && call.id ? call.id : `tool-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: fn.name,
      arguments: parseArguments(rawArguments)
    }];
  });
  return {
    text: textFromOpenAiContent(message.content),
    toolCalls,
    model: typeof root.model === 'string' && root.model ? root.model : selectedModel
  };
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
    throw new LLMError('provider_model_required', 422, 'A concrete model ID is required. Discover models or use automatic provider diagnosis first.');
  }
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
      const images = messages.flatMap((message) => message.role === 'user' ? [...(message.images ?? [])] : []);
      const input = images.length > 0
        ? [{ text: prompt }, ...images.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.dataBase64 } }))]
        : prompt;
      const result = await modelClient.generateContent(input);
      return { text: result.response.text().trim(), toolCalls: [], model: selectedModel };
    }

    const openAiTools = tools.map((tool) => ({
      type: 'function' as const,
      function: { name: tool.name, description: tool.description, parameters: tool.parameters }
    }));
    const payload = await providerJson(provider, 'chat/completions', {
      method: 'POST',
      body: {
        model: selectedModel,
        messages: openAiMessages(messages),
        temperature: 0.3,
        ...(openAiTools.length > 0 ? { tools: openAiTools, tool_choice: 'auto' } : {})
      }
    }, signal);
    return openAiStepFromPayload(payload, selectedModel);
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

function modelIds(payload: unknown): string[] {
  const root = record(payload);
  const sources = [root.data, root.models, root.items];
  const output: string[] = [];
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const entry of source) {
      if (typeof entry === 'string') output.push(entry);
      else {
        const item = record(entry);
        const id = item.id ?? item.name ?? item.model;
        if (typeof id === 'string') output.push(id.replace(/^models\//, ''));
      }
    }
  }
  return [...new Set(output.map((item) => item.trim()).filter(Boolean))].sort().slice(0, 500);
}

export async function listProviderModels(provider: Provider): Promise<{ supported: boolean; models: string[] }> {
  if (providerAdapter(provider.type) !== 'openai-compatible') {
    return { supported: false, models: [...providerDefinition(provider.type).modelExamples] };
  }
  const { signal, dispose } = combinedSignal();
  try {
    await validateProviderEndpoint(provider);
    const payload = await providerJson(provider, 'models', { method: 'GET' }, signal);
    return { supported: true, models: modelIds(payload) };
  } catch (error) {
    const mapped = safeError(provider, error);
    const details = record(mapped.details);
    const upstreamStatus = typeof details.upstreamStatus === 'number' ? details.upstreamStatus : undefined;
    if (upstreamStatus === 404 || upstreamStatus === 405 || mapped.code === 'provider_model_not_found') {
      return { supported: false, models: [...providerDefinition(provider.type).modelExamples] };
    }
    throw mapped;
  } finally {
    dispose();
  }
}

function modelScore(model: string): number {
  const value = model.toLowerCase();
  let score = 0;
  if (value.includes(':free') || /(^|[/_-])free($|[/_-])/.test(value)) score -= 10_000;
  if (/flash|mini|lite|small|instant|fast/.test(value)) score -= 1_000;
  if (/instruct|chat|assistant/.test(value)) score -= 250;
  if (/latest/.test(value)) score -= 50;
  if (/embed|embedding|rerank|moderation|whisper|audio|speech|tts|image|vision-only/.test(value)) score += 20_000;
  score += Math.min(model.length, 200);
  return score;
}

function isConcreteModel(value: string | undefined): value is string {
  return Boolean(value?.trim()) && !/^(auto|default|free|latest)$/i.test(value!.trim());
}

function failureStage(error: unknown): string | undefined {
  if (!(error instanceof AppError)) return undefined;
  const details = record(error.details);
  return typeof details.stage === 'string' ? details.stage : undefined;
}

function shouldTryAnotherModel(error: unknown): boolean {
  if (!(error instanceof AppError)) return true;
  return [
    'provider_model_not_found',
    'provider_authorization',
    'provider_billing',
    'provider_invalid_request',
    'provider_empty_response'
  ].includes(error.code);
}

export async function diagnoseProviderConnection(provider: Provider, preferredModel?: string): Promise<ProviderProbeResult> {
  const discovery = await listProviderModels(provider);
  const discovered = discovery.models.filter((model) => isConcreteModel(model));
  const examples = [...providerDefinition(provider.type).modelExamples].filter((model) => isConcreteModel(model));
  const preferred = isConcreteModel(preferredModel) ? preferredModel.trim() : isConcreteModel(provider.defaultModel) ? provider.defaultModel.trim() : undefined;
  const candidates = [...new Set([
    ...(preferred && (discovered.length === 0 || discovered.includes(preferred)) ? [preferred] : []),
    ...discovered.slice().sort((a, b) => modelScore(a) - modelScore(b)).slice(0, 12),
    ...examples
  ])].slice(0, 8);
  if (candidates.length === 0) {
    throw new LLMError('provider_model_required', 422, 'No concrete model IDs were discovered. Enter a model ID manually.', {
      domain: 'provider', service: provider.type, stage: 'model_not_found', providerMessage: 'No models discovered', retryable: false
    });
  }

  const attempts: ProviderProbeAttempt[] = [];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const result = await testProviderConnection(provider, candidate);
      attempts.push({ model: candidate, status: 'working' });
      return {
        ...result,
        modelsSupported: discovery.supported,
        models: discovered.length > 0 ? discovered : examples,
        attempts
      };
    } catch (error) {
      lastError = error;
      attempts.push({
        model: candidate,
        status: 'failed',
        ...(error instanceof AppError ? { errorCode: error.code } : {}),
        ...(failureStage(error) ? { errorStage: failureStage(error) } : {})
      });
      if (!shouldTryAnotherModel(error)) break;
    }
  }

  if (lastError instanceof AppError) {
    const details = record(lastError.details);
    throw new LLMError(lastError.code, lastError.status, lastError.message, { ...details, attempts });
  }
  throw safeError(provider, lastError ?? new Error('No model passed provider diagnostics.'));
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
