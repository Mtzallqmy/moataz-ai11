const SENSITIVE_KEY = /(?:api[_-]?key|token|authorization|password|secret|cookie|database[_-]?url|connection[_-]?string)/i;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const COMMON_SECRET = /\b(?:sk|sb_secret|ghp|github_pat|xox[baprs])-?[A-Za-z0-9_-]{12,}\b/g;

export function redactText(value: string): string {
  return value.replace(BEARER, 'Bearer [REDACTED]').replace(COMMON_SECRET, '[REDACTED]');
}

export function redactSecrets(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry, seen));

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSecrets(entry, seen);
  }
  return output;
}
