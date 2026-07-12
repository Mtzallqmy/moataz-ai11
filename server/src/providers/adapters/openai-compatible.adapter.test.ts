import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../errors.js';
import { diagnosticToAppError, diagnoseProviderError } from '../diagnostics.js';

const mocks = vi.hoisted(() => ({
  constructorOptions: [] as Array<Record<string, unknown>>,
  modelsList: vi.fn(),
  createCompletion: vi.fn(),
  providerHttpJson: vi.fn(),
  providerHttpStream: vi.fn(),
  assertSafeOutboundUrl: vi.fn(async (url: string) => new URL(url))
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    models = { list: mocks.modelsList };
    chat = { completions: { create: mocks.createCompletion } };
    constructor(options: Record<string, unknown>) { mocks.constructorOptions.push(options); }
  }
}));

vi.mock('../../network.js', () => ({
  assertSafeOutboundUrl: mocks.assertSafeOutboundUrl
}));

vi.mock('../http.js', () => ({
  providerHttpJson: mocks.providerHttpJson,
  providerHttpStream: mocks.providerHttpStream
}));

import { OpenAICompatibleAdapter } from './openai-compatible.adapter.js';
import { getProviderDefinition } from '../registry.js';

describe('OpenAI-compatible adapter', () => {
  beforeEach(() => {
    mocks.constructorOptions.length = 0;
    mocks.modelsList.mockReset();
    mocks.createCompletion.mockReset();
    mocks.providerHttpJson.mockReset();
    mocks.providerHttpStream.mockReset();
    mocks.assertSafeOutboundUrl.mockClear();
  });

  it('uses NaraRouter exact base URL, Bearer auth, and actual model IDs', async () => {
    mocks.modelsList.mockResolvedValue({ data: [{ id: 'nara/actual-model', owned_by: 'nara' }] });
    mocks.createCompletion.mockResolvedValue({
      model: 'nara/actual-model',
      choices: [{ message: { content: 'OK', tool_calls: [] } }],
      usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 }
    });
    const adapter = new OpenAICompatibleAdapter(getProviderDefinition('nararouter'));
    const config = adapter.normalizeConfig({
      apiKey: '  "secret-nara-key"  ',
      baseUrl: 'https://router.bynara.id/v1/chat/completions',
      selectedModel: 'nara/actual-model',
      userId: 'user-a', providerId: 'provider-a', credentialVersion: 2
    });

    const discovery = await adapter.discoverModels(config, { force: true });
    expect(discovery.models.map((model) => model.id)).toEqual(['nara/actual-model']);
    const result = await adapter.createChatCompletion({
      config,
      model: 'nara/actual-model',
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      temperature: 0,
      maxTokens: 64
    });

    expect(mocks.constructorOptions.at(-1)).toMatchObject({
      apiKey: 'secret-nara-key',
      baseURL: 'https://router.bynara.id/v1',
      maxRetries: 0,
      defaultHeaders: expect.objectContaining({ Authorization: 'Bearer secret-nara-key' })
    });
    expect(mocks.createCompletion).toHaveBeenCalledWith(expect.objectContaining({
      model: 'nara/actual-model', stream: false, max_tokens: 64,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }]
    }), expect.any(Object));
    expect(result.text).toBe('OK');
    expect(result.model).toBe('nara/actual-model');
  });

  it('falls back from SDK model discovery to direct GET /models and parses a direct list', async () => {
    mocks.modelsList.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
    mocks.providerHttpJson.mockResolvedValue({
      payload: [{ id: 'direct/model-a' }, 'direct/model-b'], status: 200,
      headers: new Headers(), latencyMs: 3, url: 'https://router.bynara.id/v1/models'
    });
    const adapter = new OpenAICompatibleAdapter(getProviderDefinition('nararouter'));
    const config = adapter.normalizeConfig({ apiKey: 'key', baseUrl: 'https://router.bynara.id/v1' });
    const discovery = await adapter.discoverModels(config, { force: true });
    expect(discovery.method).toBe('fetch');
    expect(discovery.models.map((model) => model.id)).toEqual(['direct/model-a', 'direct/model-b']);
    expect(mocks.providerHttpJson).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET', url: 'https://router.bynara.id/v1/models'
    }));
  });

  it('treats 404/405 model discovery as unsupported instead of an invalid key', async () => {
    mocks.modelsList.mockRejectedValue(Object.assign(new Error('Method not allowed'), { status: 405 }));
    mocks.providerHttpJson.mockRejectedValue(diagnosticToAppError(diagnoseProviderError(
      Object.assign(new Error('Method not allowed'), { response: { status: 405, data: { error: { message: 'Method not allowed' } }, headers: {} } }),
      { stage: 'model_discovery', testedEndpoint: 'https://router.bynara.id/v1/models' }
    )));
    const adapter = new OpenAICompatibleAdapter(getProviderDefinition('nararouter'));
    const config = adapter.normalizeConfig({ apiKey: 'key', baseUrl: 'https://router.bynara.id/v1' });
    const discovery = await adapter.discoverModels(config, { force: true });
    expect(discovery.status).toBe('unsupported');
    expect(discovery.method).toBe('manual');
  });

  it('does not silently accept an empty completion', async () => {
    mocks.createCompletion.mockResolvedValue({ model: 'model-a', choices: [{ message: { content: '', tool_calls: [] } }] });
    const adapter = new OpenAICompatibleAdapter(getProviderDefinition('nararouter'));
    const config = adapter.normalizeConfig({ apiKey: 'key', baseUrl: 'https://router.bynara.id/v1' });
    await expect(adapter.createChatCompletion({ config, model: 'model-a', messages: [{ role: 'user', content: 'hello' }] }))
      .rejects.toMatchObject({ code: 'provider_empty_response' } satisfies Partial<AppError>);
  });

  it('returns a structured error after a mid-stream provider error without false completion', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"model":"m","choices":[{"delta":{"content":"partial"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"error":{"code":"upstream_error","message":"provider failed"}}\n\n'));
        controller.close();
      }
    });
    mocks.providerHttpStream.mockResolvedValue({
      response: new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      latencyMs: 2,
      url: 'https://router.bynara.id/v1/chat/completions',
      dispose: vi.fn()
    });
    const adapter = new OpenAICompatibleAdapter(getProviderDefinition('nararouter'));
    const config = adapter.normalizeConfig({ apiKey: 'key', baseUrl: 'https://router.bynara.id/v1' });
    const events = [];
    for await (const event of adapter.streamChatCompletion({ config, model: 'm', messages: [{ role: 'user', content: 'hello' }] })) events.push(event);
    expect(events).toContainEqual({ type: 'text_delta', text: 'partial' });
    expect(events.at(-1)).toMatchObject({ type: 'error', diagnostic: { ok: false, stage: 'streaming' } });
    expect(events.some((event) => event.type === 'completed')).toBe(false);
  });

  it('rejects a stream that closes before [DONE]', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
        controller.close();
      }
    });
    mocks.providerHttpStream.mockResolvedValue({
      response: new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      latencyMs: 2,
      url: 'https://router.bynara.id/v1/chat/completions',
      dispose: vi.fn()
    });
    const adapter = new OpenAICompatibleAdapter(getProviderDefinition('nararouter'));
    const config = adapter.normalizeConfig({ apiKey: 'key', baseUrl: 'https://router.bynara.id/v1' });
    const events = [];
    for await (const event of adapter.streamChatCompletion({ config, model: 'm', messages: [{ role: 'user', content: 'hello' }] })) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: 'error', diagnostic: { ok: false, stage: 'streaming' } });
    expect(events.some((event) => event.type === 'completed')).toBe(false);
  });

  it('does not expose internal reasoning when no final answer is returned', async () => {
    mocks.createCompletion.mockResolvedValue({
      model: 'deepseek-reasoner',
      choices: [{ message: { content: '', reasoning_content: 'private chain of thought', tool_calls: [] } }]
    });
    const adapter = new OpenAICompatibleAdapter(getProviderDefinition('nararouter'));
    const config = adapter.normalizeConfig({ apiKey: 'key', baseUrl: 'https://router.bynara.id/v1' });
    await expect(adapter.createChatCompletion({
      config,
      model: 'deepseek-reasoner',
      messages: [{ role: 'user', content: 'hello' }]
    })).rejects.toSatisfy((error: unknown) => {
      const serialized = JSON.stringify(error);
      return serialized.includes('provider_reasoning_without_final_answer') && !serialized.includes('private chain of thought');
    });
  });

});
