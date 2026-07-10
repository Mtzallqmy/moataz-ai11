import { mkdir } from 'node:fs/promises';

await Promise.all([
  mkdir('workspace', { recursive: true }),
  mkdir('data', { recursive: true })
]);
