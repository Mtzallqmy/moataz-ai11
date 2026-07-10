import path from 'node:path';
import fs from 'node:fs/promises';
import { beforeEach, describe, expect, it } from 'vitest';
import { getUserRoot, resolveExistingPath, runTool } from './tools.js';

const context = { userId: 'user-a', role: 'user' as const, confirmed: false, integrations: [] };

beforeEach(async () => {
  await fs.rm('./workspace/unit-tests', { recursive: true, force: true });
});

describe('workspace file tools', () => {
  it('creates and updates a new file atomically', async () => {
    await runTool('write_file', { path: 'src/new.txt', content: 'one' }, context);
    await runTool('write_file', { path: 'src/new.txt', content: 'two' }, context);
    const result = await runTool('read_file', { path: 'src/new.txt' }, context) as { content: string };
    expect(result.content).toBe('two');
  });

  it('creates nested directories and allows package.json', async () => {
    await runTool('create_directory', { path: 'a/b/c' }, context);
    await runTool('write_file', { path: 'package.json', content: '{}' }, context);
    const root = await getUserRoot('user-a');
    await expect(fs.stat(path.join(root, 'a/b/c'))).resolves.toBeDefined();
    await expect(resolveExistingPath(root, 'package.json')).resolves.toContain('package.json');
  });

  it('rejects traversal, absolute paths, and protected files', async () => {
    await expect(runTool('write_file', { path: '../escape.txt', content: 'x' }, context)).rejects.toMatchObject({ code: 'path_traversal' });
    await expect(runTool('write_file', { path: '/tmp/escape.txt', content: 'x' }, context)).rejects.toMatchObject({ code: 'absolute_path_not_allowed' });
    await expect(runTool('write_file', { path: '.env', content: 'x' }, context)).rejects.toMatchObject({ code: 'protected_path' });
  });

  it('rejects symlink escapes', async () => {
    const root = await getUserRoot('user-a');
    const outside = path.resolve('./workspace/outside');
    await fs.mkdir(outside, { recursive: true });
    await fs.symlink(outside, path.join(root, 'link'));
    await expect(runTool('write_file', { path: 'link/escape.txt', content: 'x' }, context)).rejects.toMatchObject({ code: 'symlink_not_allowed' });
  });

  it('rejects files larger than the configured limit', async () => {
    await expect(runTool('write_file', { path: 'large.txt', content: 'x'.repeat(65) }, context)).rejects.toMatchObject({ code: 'file_too_large' });
  });

  it('isolates workspaces by user', async () => {
    await runTool('write_file', { path: 'private.txt', content: 'secret' }, context);
    const other = { ...context, userId: 'user-b' };
    await expect(runTool('read_file', { path: 'private.txt' }, other)).rejects.toBeDefined();
  });

  it('keeps shell unavailable without an external sandbox', async () => {
    await expect(runTool('shell', { command: 'pwd' }, { ...context, role: 'admin', confirmed: true })).rejects.toMatchObject({ code: 'shell_unavailable' });
  });
});
