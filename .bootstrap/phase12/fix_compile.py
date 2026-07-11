from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f'missing match in {path}: {old!r}')
    file.write_text(text.replace(old, new, 1))

replace(
    'server/src/routes/chats.routes.ts',
    "import { completeAgentStep, LLMError, type LLMToolSpec, type Msg, type Provider } from '../llm.js';",
    "import { completeAgentStep, LLMError, type Msg, type Provider } from '../llm.js';"
)
replace(
    'server/src/routes/integrations.routes.ts',
    "  publicIntegration,\n  validateIntegration,\n  type IntegrationType\n",
    "  publicIntegration,\n  validateIntegration\n"
)

path = Path('server/src/telegram.ts')
text = path.read_text()
text = text.replace("  ].join('\n');", "  ].join('\\n');")
text = text.replace(".map((provider) => `• ${provider.name}: ${provider.last_check_code}`).join('\n');", ".map((provider) => `• ${provider.name}: ${provider.last_check_code}`).join('\\n');")
text = text.replace("`لا يوجد مزوّد اجتاز فحص inference حقيقي.${failures ? `\n${failures}` : ''}`", "`لا يوجد مزوّد اجتاز فحص inference حقيقي.${failures ? `\\n${failures}` : ''}`")
text = text.replace("    ].join('\n'), true);", "    ].join('\\n'), true);")
path.write_text(text)
