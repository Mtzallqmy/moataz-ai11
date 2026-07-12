import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { database } from '../database/client.js';
import { attachments } from '../database/schema.js';

export type AttachmentRecord = {
  id: string;
  chat_id: string;
  user_id: string;
  message_id: string | null;
  name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  sha256: string;
  created_at: string;
};

function record(row: typeof attachments.$inferSelect): AttachmentRecord {
  return {
    id: row.id,
    chat_id: row.chatId,
    user_id: row.userId,
    message_id: row.messageId,
    name: row.name,
    mime_type: row.mimeType,
    size_bytes: row.sizeBytes,
    storage_path: row.storagePath,
    sha256: row.sha256,
    created_at: row.createdAt
  };
}

export const attachmentsRepository = {
  async create(input: {
    id: string;
    chatId: string;
    userId: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    storagePath: string;
    sha256: string;
  }): Promise<AttachmentRecord> {
    const [row] = await database.insert(attachments).values({
      id: input.id,
      chatId: input.chatId,
      userId: input.userId,
      name: input.name,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storagePath: input.storagePath,
      sha256: input.sha256
    }).returning();
    return record(row!);
  },

  async listForChat(chatId: string, userId: string): Promise<AttachmentRecord[]> {
    const rows = await database.select().from(attachments)
      .where(and(eq(attachments.chatId, chatId), eq(attachments.userId, userId)))
      .orderBy(asc(attachments.createdAt));
    return rows.map(record);
  },

  async pending(ids: readonly string[], chatId: string, userId: string): Promise<AttachmentRecord[]> {
    if (ids.length === 0) return [];
    const rows = await database.select().from(attachments).where(and(
      inArray(attachments.id, [...ids]),
      eq(attachments.chatId, chatId),
      eq(attachments.userId, userId),
      isNull(attachments.messageId)
    ));
    const mapped = rows.map(record);
    return ids.map((id) => mapped.find((row) => row.id === id)).filter((row): row is AttachmentRecord => row !== undefined);
  },

  async bind(ids: readonly string[], messageId: string, chatId: string, userId: string): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await database.update(attachments).set({ messageId }).where(and(
      inArray(attachments.id, [...ids]),
      eq(attachments.chatId, chatId),
      eq(attachments.userId, userId),
      isNull(attachments.messageId)
    )).returning({ id: attachments.id });
    return rows.length;
  },

  async unbindMessage(messageId: string, chatId: string, userId: string): Promise<void> {
    await database.update(attachments).set({ messageId: null }).where(and(
      eq(attachments.messageId, messageId),
      eq(attachments.chatId, chatId),
      eq(attachments.userId, userId)
    ));
  },

  async deletePending(id: string, chatId: string, userId: string): Promise<AttachmentRecord | undefined> {
    const [row] = await database.delete(attachments).where(and(
      eq(attachments.id, id),
      eq(attachments.chatId, chatId),
      eq(attachments.userId, userId),
      isNull(attachments.messageId)
    )).returning();
    return row ? record(row) : undefined;
  }
};
