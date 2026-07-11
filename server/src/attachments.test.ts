import { describe, expect, it } from 'vitest';
import { summarizeAttachment, type AttachmentRow } from './attachments.js';

function row(name: string, mimeType: string): AttachmentRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    chat_id: '00000000-0000-4000-8000-000000000002',
    user_id: 'user-test',
    message_id: null,
    name,
    mime_type: mimeType,
    size_bytes: 123,
    storage_path: `_uploads/chat/${name}`,
    sha256: 'a'.repeat(64),
    created_at: '2026-07-11T00:00:00.000Z'
  };
}

describe('attachment summaries', () => {
  it('classifies supported image input', () => {
    expect(summarizeAttachment(row('photo.webp', 'image/webp'))).toMatchObject({ kind: 'image', size_bytes: 123 });
  });

  it('classifies ZIP archives without executing their contents', () => {
    expect(summarizeAttachment(row('project.zip', 'application/zip')).kind).toBe('archive');
  });

  it('classifies source and text files by extension or MIME type', () => {
    expect(summarizeAttachment(row('main.ts', 'application/octet-stream')).kind).toBe('text');
    expect(summarizeAttachment(row('notes.md', 'text/markdown')).kind).toBe('text');
  });
});
