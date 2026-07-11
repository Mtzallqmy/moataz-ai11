from pathlib import Path


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    file = Path(path)
    text = file.read_text()
    actual = text.count(old)
    if actual < count:
        raise SystemExit(f'{path}: expected at least {count} matches, found {actual}: {old!r}')
    file.write_text(text.replace(old, new, count))

replace(
    'server/src/llm.ts',
    "import type { AgentStep, LLMImage, LLMToolCall, LLMToolSpec, Msg } from './llm-types.js';",
    "import type { AgentStep, LLMToolSpec, Msg } from './llm-types.js';"
)
replace(
    'server/src/providers/index.ts',
    "import type { NormalizedProviderConfig, ProviderAdapter, ProviderDefinition } from './types.js';",
    "import type { NormalizedProviderConfig, ProviderAdapter } from './types.js';"
)

for old, new in [
    ('requestId?: string;', 'requestId?: string | undefined;'),
    ('testedEndpoint?: string;', 'testedEndpoint?: string | undefined;'),
    ('testedModel?: string;', 'testedModel?: string | undefined;'),
    ('latencyMs?: number;', 'latencyMs?: number | undefined;'),
    ('discoverySucceeded?: boolean;', 'discoverySucceeded?: boolean | undefined;'),
    ('success?: boolean;', 'success?: boolean | undefined;'),
    ('httpStatus?: number;', 'httpStatus?: number | undefined;'),
    ('providerCode?: string;', 'providerCode?: string | undefined;'),
    ('upstreamRequestId?: string;', 'upstreamRequestId?: string | undefined;'),
]:
    replace('server/src/providers/diagnostics.ts', old, new)

replace('server/src/providers/http.ts', 'requestId?: string;', 'requestId?: string | undefined;')
replace('server/src/providers/http.ts', 'signal?: AbortSignal;', 'signal?: AbortSignal | undefined;')
replace('server/src/providers/http.ts', "        requestId: undefined\n", '')

replace('server/src/providers/adapters/anthropic.adapter.ts', 'const blocks: Anthropic.ContentBlockParam[] = [];', 'const blocks: Array<Record<string, unknown>> = [];', 2)
replace(
    'server/src/providers/adapters/anthropic.adapter.ts',
    "      return { role: 'assistant', content: blocks.length ? blocks : message.content };",
    "      return { role: 'assistant', content: (blocks.length ? blocks : message.content) as unknown as Anthropic.MessageParam['content'] };"
)
replace(
    'server/src/providers/adapters/anthropic.adapter.ts',
    "    return { role: 'user', content: blocks };",
    "    return { role: 'user', content: blocks as unknown as Anthropic.MessageParam['content'] };"
)
replace(
    'server/src/providers/adapters/anthropic.adapter.ts',
    '  async discoverModels(): Promise<ModelDiscoveryResult> {',
    '  async discoverModels(_config: NormalizedProviderConfig): Promise<ModelDiscoveryResult> {'
)
replace(
    'server/src/providers/adapters/anthropic.adapter.ts',
    "input_schema: tool.parameters as Anthropic.Tool.InputSchema",
    "input_schema: tool.parameters as unknown as Anthropic.Tool.InputSchema"
)

replace(
    'server/src/providers/adapters/gemini.adapter.ts',
    "      const declarations: FunctionDeclaration[] = (input.tools ?? []).map((tool) => ({\n        name: tool.name,\n        description: tool.description,\n        parameters: tool.parameters as FunctionDeclaration['parameters']\n      }));\n      const model = client.getGenerativeModel({\n        model: input.model.replace(/^models\\//, ''),\n        ...(systemText(input.messages) ? { systemInstruction: systemText(input.messages) } : {}),",
    "      const declarations: FunctionDeclaration[] = (input.tools ?? []).map((tool) => ({\n        name: tool.name,\n        description: tool.description,\n        parameters: tool.parameters as unknown as NonNullable<FunctionDeclaration['parameters']>\n      }));\n      const systemInstruction = systemText(input.messages);\n      const model = client.getGenerativeModel({\n        model: input.model.replace(/^models\\//, ''),\n        ...(systemInstruction ? { systemInstruction } : {}),"
)
replace(
    'server/src/providers/adapters/gemini.adapter.ts',
    "        const response = await model.generateContent({\n          contents,\n          generationConfig: {\n            temperature: input.temperature ?? 0.3,\n            ...(input.maxTokens !== undefined ? { maxOutputTokens: input.maxTokens } : {})\n          }\n        }, { signal: controller.signal });",
    "        const request = model.generateContent({\n          contents,\n          generationConfig: {\n            temperature: input.temperature ?? 0.3,\n            ...(input.maxTokens !== undefined ? { maxOutputTokens: input.maxTokens } : {})\n          }\n        });\n        const response = await Promise.race([\n          request,\n          new Promise<never>((_resolve, reject) => {\n            controller.signal.addEventListener('abort', () => reject(controller.signal.reason ?? new Error('provider_timeout')), { once: true });\n          })\n        ]);"
)
