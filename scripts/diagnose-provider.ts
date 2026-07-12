import { completeAgentStep, listProviderModels, streamProviderCompletion, type Provider } from '../server/src/llm.js';
import { providerFailureCode } from '../server/src/llm.js';
import { AppError } from '../server/src/errors.js';
import { getProviderDefinition, normalizeProviderConfig } from '../server/src/providers/index.js';
import type { ProviderProtocol } from '../server/src/providers/types.js';

function required(name: string): string {
  const value = process.env[name]?.trim() ?? '';
  if (!value) throw new AppError('provider_invalid_configuration', 422, `${name} is required.`);
  return value;
}

function safeLine(label: string, value: string | number): void {
  process.stdout.write(`${label}: ${value}\n`);
}

async function main(): Promise<void> {
  const baseUrl = required('PROVIDER_BASE_URL');
  const apiKey = required('PROVIDER_API_KEY');
  const providerType = process.env.PROVIDER_TYPE?.trim() || (baseUrl.includes('router.bynara.id') ? 'nararouter' : 'custom');
  const definition = getProviderDefinition(providerType);
  const protocol = (process.env.PROVIDER_PROTOCOL?.trim() || definition.protocol) as ProviderProtocol;
  const configuredModel = process.env.PROVIDER_MODEL?.trim() || '';
  const provider: Provider = {
    type: providerType,
    protocol,
    apiKey,
    baseUrl,
    defaultModel: configuredModel,
    name: process.env.PROVIDER_NAME?.trim() || providerType,
    userId: 'diagnostic-user',
    providerId: 'diagnostic-provider',
    credentialVersion: 1
  };

  const normalized = normalizeProviderConfig({
    providerType,
    protocol,
    apiKey,
    baseUrl,
    selectedModel: configuredModel,
    userId: provider.userId,
    providerId: provider.providerId,
    credentialVersion: provider.credentialVersion
  });
  if (!normalized.normalizedBaseUrl) throw new Error('The provider Base URL could not be normalized.');
  safeLine('Base URL normalized', 'yes');
  const discovery = await listProviderModels(provider);
  safeLine('Models discovery', discovery.supported ? 'success' : discovery.discovery?.status ?? 'unsupported');
  safeLine('Models count', discovery.models.length);

  const selectedModel = configuredModel || discovery.models[0] || '';
  if (!selectedModel) throw new Error('No model ID was discovered. Set PROVIDER_MODEL to an actual model ID.');
  safeLine('Selected model', selectedModel);

  const step = await completeAgentStep(provider, [{ role: 'user', content: 'Reply with exactly: OK' }], selectedModel, []);
  if (!step.text.trim() && step.toolCalls.length === 0) throw new Error('The provider returned an empty non-streaming response.');
  safeLine('Authentication', 'success');
  safeLine('Non-streaming inference', 'success');

  let chunks = 0;
  let completed = false;
  let unsupported = false;
  try {
    for await (const event of streamProviderCompletion(provider, [{ role: 'user', content: 'Reply with exactly: OK' }], selectedModel)) {
      if (event.type === 'text_delta' && event.text) chunks += 1;
      if (event.type === 'completed') completed = true;
      if (event.type === 'error') {
        if (event.diagnostic.status === 'unsupported_streaming') unsupported = true;
        else throw new Error(`Streaming diagnostic: ${event.diagnostic.status}`);
      }
    }
  } catch (error) {
    if (providerFailureCode(error) === 'provider_unsupported_streaming') unsupported = true;
    else throw error;
  }
  safeLine('Streaming inference', unsupported ? 'unsupported' : completed && chunks > 0 ? 'success' : 'failed');
  safeLine('Streaming chunks', chunks);
  if (!unsupported && (!completed || chunks === 0)) process.exitCode = 2;
}

main().catch((error: unknown) => {
  const code = providerFailureCode(error);
  safeLine('Diagnostic result', 'failed');
  safeLine('Error code', code);
  process.exitCode = 1;
});
