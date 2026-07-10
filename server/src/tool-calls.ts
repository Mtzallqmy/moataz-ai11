import { redactSecrets, redactText } from './redaction.js';

export type ToolCallStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export type ToolCallRecord = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: ToolCallStatus;
  result?: unknown;
  error?: { code: string; message: string };
  startedAt?: string;
  finishedAt?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function status(value: unknown): ToolCallStatus {
  return value === 'pending' || value === 'running' || value === 'failed' || value === 'succeeded' ? value : 'succeeded';
}

function normalizeRecord(value: unknown, index: number): ToolCallRecord | undefined {
  if (!isRecord(value)) return undefined;

  if (isRecord(value.tool)) {
    const name = typeof value.tool.name === 'string' ? value.tool.name : undefined;
    if (!name) return undefined;
    const args = isRecord(value.tool.args) ? value.tool.args : {};
    return {
      id: `legacy-${index}`,
      name,
      arguments: redactSecrets(args) as Record<string, unknown>,
      status: value.error ? 'failed' : 'succeeded',
      ...(value.result !== undefined ? { result: redactSecrets(value.result) } : {}),
      ...(value.error !== undefined ? { error: { code: 'tool_failed', message: redactText(String(value.error)) } } : {})
    };
  }

  const name = typeof value.name === 'string' ? value.name : undefined;
  if (!name) return undefined;
  const args = isRecord(value.arguments) ? value.arguments : isRecord(value.args) ? value.args : {};
  const normalized: ToolCallRecord = {
    id: typeof value.id === 'string' ? value.id : `tool-${index}`,
    name,
    arguments: redactSecrets(args) as Record<string, unknown>,
    status: status(value.status)
  };
  if (value.result !== undefined) normalized.result = redactSecrets(value.result);
  if (isRecord(value.error)) {
    normalized.error = {
      code: typeof value.error.code === 'string' ? value.error.code : 'tool_failed',
      message: redactText(typeof value.error.message === 'string' ? value.error.message : 'Tool execution failed')
    };
  }
  if (typeof value.startedAt === 'string') normalized.startedAt = value.startedAt;
  if (typeof value.finishedAt === 'string') normalized.finishedAt = value.finishedAt;
  return normalized;
}

export function parseToolCalls(value: unknown): ToolCallRecord[] {
  if (value === null || value === undefined || value === '') return [];
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  const values = Array.isArray(parsed) ? parsed : [parsed];
  return values.map(normalizeRecord).filter((entry): entry is ToolCallRecord => entry !== undefined);
}

export function serializeToolCalls(value: readonly ToolCallRecord[]): string | null {
  return value.length > 0 ? JSON.stringify(value.map((entry) => redactSecrets(entry))) : null;
}
