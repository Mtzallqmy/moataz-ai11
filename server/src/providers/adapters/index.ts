import { AppError } from '../../errors.js';
import { AnthropicAdapter } from './anthropic.adapter.js';
import { GeminiAdapter } from './gemini.adapter.js';
import { OpenAiCompatibleAdapter } from './openai-compatible.adapter.js';
import type { ProviderAdapter, ProviderProtocol } from '../types.js';

const adapters: Readonly<Record<ProviderProtocol, ProviderAdapter>> = {
  'openai-compatible': new OpenAiCompatibleAdapter(),
  anthropic: new AnthropicAdapter(),
  gemini: new GeminiAdapter()
};

export function adapterForProtocol(protocol: ProviderProtocol): ProviderAdapter {
  const adapter = adapters[protocol];
  if (!adapter) throw new AppError('provider_protocol_unsupported', 422, `Unsupported provider protocol: ${protocol}`);
  return adapter;
}
