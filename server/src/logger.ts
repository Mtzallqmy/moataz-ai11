import { config } from './config.js';
import { redactSecrets } from './redaction.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const rank: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function write(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  if (rank[level] < rank[config.logLevel]) return;
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...redactSecrets(fields) as Record<string, unknown>
  });
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${payload}\n`);
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => write('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields)
};
