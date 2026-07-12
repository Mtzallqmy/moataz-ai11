import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { database } from '../database/client.js';
import { messages } from '../database/schema.js';

export type MessageRecord = {
  id: string;
  chat_id: string;
  user_id: string | null;
  sequence: number;
  role: string;
  content: string;
  tool_calls: unknown[];
  idempotency_key: string | null;
  created_at: string;
};

function record(row: typeof messages.$inferSelect): MessageRecord {
  return {
    id: row.id,
    chat_id: row.chatId,
    user_id: row.userId,
    sequence: row.sequence,
    role: row.role,
    content: row.content,
    tool_calls: Array.isArray(row.toolCalls) ? row.toolCalls : [],
    idempotency_key: row.idempotencyKey,
    created_at: row.createdAt
  };
}

async function nextSequence(tx: typeof database, chatId: string): Promise<number> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${chatId}))`);
  const [row] = await tx.select({ next: sql<number>`COALESCE(MAX(${messages.sequence}), 0)::bigint + 1` })
    .from(messages).where(eq(messages.chatId, chatId));
  return Number(row?.next ?? 1);
}

export const messagesRepository = {
  async listForChat(chatId: string): Promise<MessageRecord[]> {
    const rows = await database.select().from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(asc(messages.sequence), asc(messages.createdAt));
    return rows.map(record);
  },

  async context(chatId: string, limit: number): Promise<Array<{ role: string; content: string }>> {
    const rows = await database.select({ role: messages.role, content: messages.content }).from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(desc(messages.sequence))
      .limit(limit);
    return rows.reverse();
  },

  async findByIdempotency(chatId: string, key: string, role: 'user' | 'assistant'): Promise<MessageRecord | undefined> {
    const [row] = await database.select().from(messages)
      .where(and(eq(messages.chatId, chatId), eq(messages.idempotencyKey, key), eq(messages.role, role)))
      .limit(1);
    return row ? record(row) : undefined;
  },

  async insert(input: {
    id: string;
    chatId: string;
    userId: string | null;
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    toolCalls?: unknown[];
    idempotencyKey?: string | null;
  }): Promise<MessageRecord> {
    return database.transaction(async (tx) => {
      const sequence = await nextSequence(tx as typeof database, input.chatId);
      const [row] = await tx.insert(messages).values({
        id: input.id,
        chatId: input.chatId,
        userId: input.userId,
        sequence,
        role: input.role,
        content: input.content,
        toolCalls: input.toolCalls ?? [],
        legacyToolCalls: JSON.stringify(input.toolCalls ?? []),
        idempotencyKey: input.idempotencyKey ?? null
      }).returning();
      return record(row!);
    });
  },

  async deleteOwnedUserMessage(input: { id: string; chatId: string; userId: string }): Promise<void> {
    await database.delete(messages).where(and(
      eq(messages.id, input.id),
      eq(messages.chatId, input.chatId),
      eq(messages.userId, input.userId),
      eq(messages.role, 'user')
    ));
  },

  async nextSequenceInTransaction(tx: typeof database, chatId: string): Promise<number> {
    return nextSequence(tx, chatId);
  }
};
