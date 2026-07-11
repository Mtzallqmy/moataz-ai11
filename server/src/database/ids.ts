import crypto from 'node:crypto';

export function cryptoId(): string {
  return crypto.randomUUID();
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
