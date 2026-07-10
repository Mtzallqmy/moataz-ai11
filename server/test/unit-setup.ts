import { rmSync } from 'node:fs';

rmSync('./workspace/unit-tests', { recursive: true, force: true });
