from pathlib import Path


def replace(path: str, old: str, new: str, required: bool = True) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        if required:
            raise SystemExit(f'missing match in {path}: {old[:120]!r}')
        return
    file.write_text(text.replace(old, new, 1))

replace(
    'server/src/app.ts',
    "  requestId?: string;\n  details?: unknown;\n  fallbackMessage?: string;",
    "  requestId?: string | undefined;\n  details?: unknown;\n  fallbackMessage?: string | undefined;"
)
replace(
    'server/src/telegram.ts',
    "  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;",
    "  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;"
)
replace(
    'server/src/routes/chats.routes.ts',
    "        mode: input.mode\n",
    "        mode: input.mode ?? 'agent'\n"
)
replace(
    'server/src/routes/chats.routes.ts',
    "      const attachmentRows = await pendingAttachments(input.attachmentIds, chatId, req.user!.id);",
    "      const attachmentIds = input.attachmentIds ?? [];\n      const attachmentRows = await pendingAttachments(attachmentIds, chatId, req.user!.id);"
)
replace(
    'server/src/routes/chats.routes.ts',
    "        attachmentIds: input.attachmentIds\n",
    "        attachmentIds\n"
)
replace(
    'server/src/routes/chats.routes.ts',
    "      const lastMessage = messages[messages.length - 1];\n      if (lastMessage?.role === 'user' && attachmentData.images.length > 0) lastMessage.images = attachmentData.images;",
    "      const lastIndex = messages.length - 1;\n      const lastMessage = messages[lastIndex];\n      if (lastMessage?.role === 'user' && attachmentData.images.length > 0) {\n        messages[lastIndex] = { ...lastMessage, images: attachmentData.images };\n      }"
)
replace(
    'server/src/routes/chats.routes.ts',
    "        inputTokens: usage?.inputTokens,\n        outputTokens: usage?.outputTokens,\n        totalTokens: usage?.totalTokens\n",
    "        ...(usage?.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),\n        ...(usage?.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),\n        ...(usage?.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {})\n"
)
replace(
    'server/src/services/integrations.service.ts',
    "  async update(userId: string, id: string, input: { name?: string; token?: string; meta?: Record<string, unknown> }): Promise<IntegrationRecord> {",
    "  async update(userId: string, id: string, input: { name?: string | undefined; token?: string | undefined; meta?: Record<string, unknown> | undefined }): Promise<IntegrationRecord> {"
)
replace(
    'server/src/services/integrations.service.ts',
    "    }, { timeoutMs: config.webFetchTimeoutMs, maxRedirects: 0 });",
    "    }, { timeoutMs: config.webFetchTimeoutMs, maxRedirects: 0, allowPrivate: false });",
    required=False
)

page = Path('client/src/pages/ProvidersPage.tsx')
text = page.read_text()
text = text.replace(
    "  const save = async (event: React.FormEvent, verify: boolean) => {\n    event.preventDefault();",
    "  const save = async (verify: boolean) => {"
)
text = text.replace(
    "<form className=\"form-grid provider-form\" onSubmit={(event) => { void save(event, false); }}>",
    "<form className=\"form-grid provider-form\" onSubmit={(event) => { event.preventDefault(); void save(false); }}>"
)
text = text.replace(
    "onClick={(event) => { void save(event as unknown as React.FormEvent, true); }}",
    "onClick={() => { void save(true); }}"
)
page.write_text(text)
