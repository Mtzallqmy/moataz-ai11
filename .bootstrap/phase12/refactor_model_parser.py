from pathlib import Path
p=Path('server/src/providers/adapters/openai-compatible.adapter.ts')
s=p.read_text()
s=s.replace("import { z } from 'zod';\n", '')
s=s.replace("import type {\n  DiscoveredModel,\n  ModelDiscoveryResult,", "import type {\n  ModelDiscoveryResult,")
s=s.replace("import { getProviderDefinition } from '../registry.js';\n", "import { getProviderDefinition } from '../registry.js';\nimport { parseModelResponse } from '../model-response.js';\n")
start=s.index('const modelObjectSchema =')
end=s.index('const chatResponseSchema =')
s=s[:start]+s[end:]
start=s.index('function discoveredModel(')
end=s.index('function openAiMessages(', start)
s=s[:start]+s[end:]
s=s.replace("parseModels(response.payload, configValue.providerType === 'custom')", "parseModelResponse(response.payload, configValue.providerType === 'custom')")
p.write_text(s)
